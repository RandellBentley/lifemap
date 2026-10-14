from django.db.models import Count, Prefetch
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from journal.models import MediaAsset
from journal.serializers import UploadRequestSerializer
from journal.uploads import delete_media, issue_upload

from journal.views import parse_date

from .markers import goal_markers
from .models import Goal, Measurement, Metric, Milestone
from .serializers import GoalSerializer, MeasurementSerializer, MetricSerializer, MilestoneSerializer

METRICS = Metric.objects.prefetch_related("measurements")
READINGS = Measurement.objects.select_related("metric")

# Newest first, so a just-uploaded replacement wins until the old one is deleted.
MEDIA = (
    MediaAsset.objects.select_related("goal", "milestone__goal").prefetch_related("tags").order_by("-created_at")
)


def replace_single_media(request, owner_field, owner, existing):
    """POST: swap in a new photo/video (returns an upload ticket). DELETE: remove it."""
    if request.method == "DELETE":
        delete_media(existing)
        return Response(status=status.HTTP_204_NO_CONTENT)
    upload = UploadRequestSerializer(data=request.data)
    upload.is_valid(raise_exception=True)
    delete_media(existing)  # one photo per goal/milestone
    ticket = issue_upload(request.user, upload.validated_data, **{owner_field: owner})
    return Response(ticket, status=status.HTTP_201_CREATED)


class GoalViewSet(viewsets.ModelViewSet):
    """
    GET /api/goals/?status=active|achieved       all goals (unpaginated)
    POST|DELETE /api/goals/{id}/photo/          set (upload ticket) or remove the goal's photo
    GET|POST /api/goals/{id}/milestones/        list or add milestones
    """

    serializer_class = GoalSerializer
    pagination_class = None

    def get_queryset(self):
        qs = (
            Goal.objects.filter(user=self.request.user)
            .annotate(milestone_count=Count("milestones", distinct=True))
            .prefetch_related(Prefetch("photos", queryset=MEDIA), Prefetch("metrics", queryset=METRICS))
            # Explicit: Django ignores Meta.ordering on queries with aggregates (the Count above).
            .order_by("-created_at")
        )
        state = self.request.query_params.get("status")
        if state == "active":
            qs = qs.filter(achieved_on__isnull=True)
        elif state == "achieved":
            qs = qs.filter(achieved_on__isnull=False)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=["get"])
    def markers(self, request):
        """GET /api/goals/markers/?start=&end=&tag=&q= -> goal starts, dated milestones, achievements."""
        params = request.query_params
        start = parse_date(params["start"], "start") if params.get("start") else None
        end = parse_date(params["end"], "end") if params.get("end") else None
        return Response(goal_markers(request.user, start, end, tag=params.get("tag"), q=params.get("q")))

    def perform_destroy(self, goal):
        delete_media(MediaAsset.objects.filter(goal=goal) | MediaAsset.objects.filter(milestone__goal=goal))
        goal.delete()

    @action(detail=True, methods=["post", "delete"])
    def photo(self, request, pk=None):
        goal = self.get_object()
        return replace_single_media(request, "goal", goal, goal.photos.all())

    @action(detail=True, methods=["get", "post"])
    def milestones(self, request, pk=None):
        goal = self.get_object()
        context = self.get_serializer_context()
        if request.method == "POST":
            serializer = MilestoneSerializer(data=request.data, context={**context, "goal": goal})
            serializer.is_valid(raise_exception=True)
            serializer.save(user=request.user, goal=goal)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        milestones = goal.milestones.prefetch_related(
            Prefetch("media", queryset=MEDIA), Prefetch("measurements", queryset=READINGS)
        )
        return Response(MilestoneSerializer(milestones, many=True, context=context).data)

    @action(detail=True, methods=["get", "post"])
    def metrics(self, request, pk=None):
        """GET|POST /api/goals/{id}/metrics/ — list (with progress) or add a metric."""
        goal = self.get_object()
        if request.method == "POST":
            serializer = MetricSerializer(data=request.data, context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            serializer.save(user=request.user, goal=goal, position=goal.metrics.count())
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(MetricSerializer(goal.metrics.prefetch_related("measurements"), many=True).data)


class MilestoneViewSet(
    mixins.RetrieveModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """PATCH/DELETE /api/milestones/{id}/; POST|DELETE /api/milestones/{id}/media/ for its photo or video."""

    serializer_class = MilestoneSerializer

    def get_queryset(self):
        return Milestone.objects.filter(user=self.request.user).prefetch_related(
            Prefetch("media", queryset=MEDIA), Prefetch("measurements", queryset=READINGS)
        )

    def perform_destroy(self, milestone):
        delete_media(milestone.media.all())
        milestone.delete()

    @action(detail=True, methods=["post", "delete"])
    def media(self, request, pk=None):
        milestone = self.get_object()
        return replace_single_media(request, "milestone", milestone, milestone.media.all())


class MetricViewSet(
    mixins.RetrieveModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """PATCH/DELETE /api/metrics/{id}/; GET|POST /api/metrics/{id}/measurements/ to list or log readings."""

    serializer_class = MetricSerializer

    def get_queryset(self):
        return Metric.objects.filter(user=self.request.user).prefetch_related("measurements")

    @action(detail=True, methods=["get", "post"])
    def measurements(self, request, pk=None):
        metric = self.get_object()
        context = {**self.get_serializer_context(), "metric": metric}
        if request.method == "POST":
            serializer = MeasurementSerializer(data=request.data, context=context)
            serializer.is_valid(raise_exception=True)
            serializer.save(user=request.user, metric=metric)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        readings = metric.measurements.select_related("metric", "milestone")
        return Response(MeasurementSerializer(readings, many=True, context=context).data)


class MeasurementViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """PATCH/DELETE /api/measurements/{id}/"""

    serializer_class = MeasurementSerializer

    def get_queryset(self):
        return Measurement.objects.filter(user=self.request.user).select_related("metric", "milestone")

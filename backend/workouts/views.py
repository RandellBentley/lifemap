"""
Workout tracking API. Every view lists requires_feature("workouts") first, so where the flag is
off (the public demo) all of it answers 404, even to signed-out callers.
"""

from django.db.models import Count, Prefetch
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from config.features import requires_feature
from journal import storage
from journal.models import MediaAsset
from journal.serializers import UploadRequestSerializer
from journal.uploads import delete_media, issue_upload, replace_single_media

from .models import Exercise, PersonalRecord, ProgressReport, Workout, WorkoutExercise, WorkoutSet
from .serializers import ExerciseSerializer, PersonalRecordSerializer, ProgressReportSerializer, WorkoutSerializer

PERMISSIONS = [requires_feature("workouts"), IsAuthenticated]
UUID = r"[0-9a-f-]{36}"

MEDIA = MediaAsset.objects.select_related(
    "workout_set__workout_exercise__workout", "workout_set__workout_exercise__exercise", "progress_report"
).prefetch_related("tags")


class ExerciseViewSet(viewsets.ModelViewSet):
    """
    GET/POST /api/workouts/exercises/   the exercise library behind the dropdown.
    POSTing a name you already have (any capitalization) returns the existing exercise.
    DELETE refuses (409) once an exercise is used in a workout or a PR; rename it instead.
    GET /api/workouts/exercises/{id}/history/   one point per workout, for the progress chart.
    """

    serializer_class = ExerciseSerializer
    permission_classes = PERMISSIONS
    pagination_class = None
    lookup_value_regex = UUID

    def get_queryset(self):
        return (
            Exercise.objects.filter(user=self.request.user)
            .annotate(use_count=Count("uses", distinct=True))
            .order_by("name")
        )

    def create(self, request, *args, **kwargs):
        name = " ".join(str(request.data.get("name", "")).split())
        existing = self.get_queryset().filter(name__iexact=name).first() if name else None
        if existing:
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        exercise = self.get_object()
        if exercise.uses.exists() or exercise.records.exists():
            return Response(
                {"detail": "This exercise is used in past workouts or PRs. Rename it instead of deleting it."},
                status=status.HTTP_409_CONFLICT,
            )
        exercise.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True)
    def history(self, request, pk=None):
        """The heaviest made set of each workout, oldest first. Missed and unweighted sets don't count."""
        exercise = self.get_object()
        workout = "workout_exercise__workout"
        sets = (
            WorkoutSet.objects.filter(workout_exercise__exercise=exercise, made=True, weight_kg__isnull=False)
            .select_related(workout)
            .order_by(f"{workout}__performed_on", f"{workout}__created_at", "-weight_kg", "-reps")
        )
        best = {}
        for s in sets:  # each workout's sets come together, heaviest first
            w = s.workout_exercise.workout
            point = {"workout_id": w.id, "date": w.performed_on, "weight_kg": s.weight_kg, "reps": s.reps}
            best.setdefault(w.id, point)
        return Response(list(best.values()))


class WorkoutPagination(CursorPagination):
    ordering = ("-performed_on", "-created_at")
    page_size = 30


class WorkoutViewSet(viewsets.ModelViewSet):
    """GET/POST /api/workouts/ (newest first); GET/PUT/PATCH/DELETE /api/workouts/{id}/."""

    serializer_class = WorkoutSerializer
    permission_classes = PERMISSIONS
    pagination_class = WorkoutPagination
    lookup_value_regex = UUID

    def get_queryset(self):
        sets = WorkoutSet.objects.prefetch_related(Prefetch("media", queryset=MEDIA))
        exercises = WorkoutExercise.objects.select_related("exercise").prefetch_related(Prefetch("sets", queryset=sets))
        return Workout.objects.filter(user=self.request.user).prefetch_related(
            Prefetch("exercises", queryset=exercises),
            Prefetch("physique__photos", queryset=MEDIA.order_by("created_at")),
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, workout):
        # Its physique update, if any, stays on as a standalone one (with its photos).
        delete_media(MediaAsset.objects.filter(workout_set__workout_exercise__workout=workout))
        workout.delete()


class SetViewSet(viewsets.GenericViewSet):
    """POST|DELETE /api/workouts/sets/{id}/video/ — attach (upload ticket) or remove a set's video."""

    permission_classes = PERMISSIONS
    lookup_value_regex = UUID

    def get_queryset(self):
        return WorkoutSet.objects.filter(workout_exercise__workout__user=self.request.user)

    @action(detail=True, methods=["post", "delete"])
    def video(self, request, pk=None):
        workout_set = self.get_object()
        return replace_single_media(request, "workout_set", workout_set, workout_set.media.all(), kinds=("video",))


class PersonalRecordViewSet(viewsets.ModelViewSet):
    """
    GET/POST /api/workouts/records/ (newest first); GET/PUT/PATCH/DELETE /api/workouts/records/{id}/;
    POST|DELETE /api/workouts/records/{id}/video/ attaches (upload ticket) or removes its video.
    """

    serializer_class = PersonalRecordSerializer
    permission_classes = PERMISSIONS
    pagination_class = None
    lookup_value_regex = UUID

    def get_queryset(self):
        return (
            PersonalRecord.objects.filter(user=self.request.user)
            .select_related("exercise")
            .prefetch_related(Prefetch("media", queryset=MEDIA))
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, record):
        delete_media(record.media.all())
        record.delete()

    @action(detail=True, methods=["post", "delete"])
    def video(self, request, pk=None):
        record = self.get_object()
        return replace_single_media(request, "personal_record", record, record.media.all(), kinds=("video",))


class ProgressReportViewSet(viewsets.ModelViewSet):
    """
    GET/POST /api/workouts/progress/ (newest first); POST /api/workouts/progress/{id}/photos/
    adds a photo (upload ticket). Remove one photo with DELETE /api/media/{id}/.
    """

    serializer_class = ProgressReportSerializer
    permission_classes = PERMISSIONS
    pagination_class = None
    lookup_value_regex = UUID

    def get_queryset(self):
        return ProgressReport.objects.filter(user=self.request.user).prefetch_related(
            Prefetch("photos", queryset=MEDIA.order_by("created_at"))
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, report):
        delete_media(report.photos.all())
        report.delete()

    @action(detail=True, methods=["post"])
    def photos(self, request, pk=None):
        report = self.get_object()
        upload = UploadRequestSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        if storage.kind_for(upload.validated_data["content_type"]) != "image":
            return Response({"content_type": ["Progress reports take photos."]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(issue_upload(request.user, upload.validated_data, progress_report=report),
                        status=status.HTTP_201_CREATED)


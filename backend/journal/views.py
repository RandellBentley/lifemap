import datetime as dt
import logging
import secrets
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.db.models import Count, DateTimeField, F, Max, Min, OuterRef, Prefetch, Q, Subquery
from django.db.models.functions import Cast, Coalesce, TruncMonth
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import storage
from .models import Entry, Event, MediaAsset, Tag
from .serializers import (
    EntrySerializer,
    EventSerializer,
    EventSummarySerializer,
    EventUploadRequestSerializer,
    MediaAssetSerializer,
    ProcessedMediaSerializer,
    TagSerializer,
    UploadRequestSerializer,
    event_covers,
)
from .uploads import issue_upload

log = logging.getLogger(__name__)


def parse_instant(value, field):
    try:
        parsed = parse_datetime(value)
    except ValueError:
        parsed = None
    if parsed is None:
        raise ValidationError({field: "Expected an ISO 8601 timestamp."})
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed, dt.UTC)


def parse_date(value, field):
    try:
        return dt.date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({field: "Expected YYYY-MM-DD."}) from None


class TimelinePagination(CursorPagination):
    # Cursor (not offset) pagination: stable while new entries are added, and fast at depth.
    ordering = ("-occurred_at", "-id")
    page_size = 20
    max_page_size = 100
    page_size_query_param = "page_size"


class EntryViewSet(viewsets.ModelViewSet):
    """
    GET /api/entries/?tag=&q=&date=&start=&end=   newest first (cursor-paginated)
    GET /api/entries/window/?before=|after=        a slice either side of a moment (horizontal timeline)
    GET /api/entries/summary/                      date bounds + per-month counts (scrubber, calendar)
    POST /api/entries/{id}/media/                  request a presigned upload
    """

    serializer_class = EntrySerializer
    pagination_class = TimelinePagination

    def get_queryset(self):
        qs = (
            Entry.objects.filter(user=self.request.user)
            .select_related("event")
            .prefetch_related("tags", Prefetch("media", queryset=MediaAsset.objects.prefetch_related("tags")))
        )
        params = self.request.query_params
        if tag := params.get("tag"):
            # An entry matches through its own tags, its photos' tags, or its event's tags.
            slug = slugify(tag)
            qs = qs.filter(Q(tags__slug=slug) | Q(media__tags__slug=slug) | Q(event__tags__slug=slug)).distinct()
        if event := params.get("event"):
            qs = qs.filter(event_id=event)
        if q := params.get("q"):
            # Swap for Postgres full-text search (SearchVector + GIN index) once data grows.
            qs = qs.filter(Q(title__icontains=q) | Q(body__icontains=q))
        if date := params.get("date"):
            qs = qs.filter(occurred_on=parse_date(date, "date"))
        if start := params.get("start"):
            qs = qs.filter(occurred_on__gte=parse_date(start, "start"))
        if end := params.get("end"):
            qs = qs.filter(occurred_on__lte=parse_date(end, "end"))
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, entry):
        keys = [k for asset in entry.media.all() for k in [asset.s3_key, *asset.variants.values()]]
        entry.delete()
        storage.delete_objects(keys)

    @action(detail=False, methods=["get"])
    def window(self, request):
        """
        Keyset slice of the timeline, always returned oldest -> newest.
          ?before=<iso>[&before_id=<uuid>]  the `limit` entries just before that point (default: newest)
          ?after=<iso>[&after_id=<uuid>]    the `limit` entries from that point on
        The id breaks ties between entries at the same instant. Filters (tag, q, ...) apply.
        """
        params = request.query_params
        try:
            limit = max(1, min(int(params.get("limit", 30)), 100))
        except ValueError:
            raise ValidationError({"limit": "Expected an integer."}) from None

        qs = self.get_queryset()
        if "after" in params:
            at, after_id = parse_instant(params["after"], "after"), params.get("after_id")
            cond = Q(occurred_at__gt=at) | Q(occurred_at=at, id__gt=after_id) if after_id else Q(occurred_at__gte=at)
            rows = list(qs.filter(cond).order_by("occurred_at", "id")[: limit + 1])
        else:
            if "before" in params:
                at, before_id = parse_instant(params["before"], "before"), params.get("before_id")
                cond = (
                    Q(occurred_at__lt=at) | Q(occurred_at=at, id__lt=before_id) if before_id else Q(occurred_at__lt=at)
                )
                qs = qs.filter(cond)
            rows = list(qs.order_by("-occurred_at", "-id")[: limit + 1])

        has_more = len(rows) > limit
        rows = rows[:limit]
        if "after" not in params:
            rows.reverse()
        return Response({"results": self.get_serializer(rows, many=True).data, "has_more": has_more})

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self.get_queryset().order_by()
        bounds = qs.aggregate(first=Min("occurred_at"), last=Max("occurred_at"))
        months = (
            qs.annotate(month=TruncMonth("occurred_on"))
            .values("month")
            .annotate(count=Count("id", distinct=True))
            .order_by("month")
        )
        return Response(
            {
                "first": bounds["first"],
                "last": bounds["last"],
                "months": [{"month": m["month"].strftime("%Y-%m"), "count": m["count"]} for m in months],
            }
        )

    @action(detail=True, methods=["post"])
    def media(self, request, pk=None):
        entry = self.get_object()
        upload = UploadRequestSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        return Response(issue_upload(request.user, upload.validated_data, entry=entry), status=status.HTTP_201_CREATED)


def place_in_event(event, captured_at):
    """
    Which day of `event` a photo belongs to, and when (as an aware datetime) on that day.
    Naive times are EXIF wall-clock times, already local to wherever the photo was taken.
    Times outside the event are clamped to its nearest day; ongoing events have no end.
    Returns (day, moment, outside).
    """
    tz = ZoneInfo(event.timezone)
    moment = None
    if captured_at:
        try:
            moment = parse_datetime(captured_at)
        except ValueError:
            moment = None
        if moment is None:
            raise ValidationError({"captured_at": "Expected an ISO 8601 timestamp."})
        moment = moment.astimezone(tz) if timezone.is_aware(moment) else moment.replace(tzinfo=tz)
    else:
        moment = timezone.now().astimezone(tz)

    day = moment.date()
    clamped = max(event.starts_on, day)
    if event.ends_on:
        clamped = min(clamped, event.ends_on)
    if clamped != day:
        moment = dt.datetime.combine(clamped, dt.time(12), tzinfo=tz)
    return clamped, moment, clamped != day


def overlapping(qs, start, end):
    """Events whose span touches [start, end]; ongoing events (no end yet) run open-ended."""
    if end:
        qs = qs.filter(starts_on__lte=end)
    if start:
        qs = qs.filter(Q(ends_on__gte=start) | Q(ends_on__isnull=True))
    return qs


class EventViewSet(viewsets.ModelViewSet):
    """
    GET /api/events/?start=&end=&q=        events overlapping a date range (unpaginated)
    GET /api/events/{id}/entries/          the event's day entries, oldest first
    DELETE /api/events/{id}/?with_entries=true   also delete its entries (default: keep them)
    """

    serializer_class = EventSerializer
    pagination_class = None

    def get_queryset(self):
        qs = (
            Event.objects.filter(user=self.request.user)
            .prefetch_related("tags")
            .annotate(
                entry_count=Count("entries", distinct=True),
                media_count=Count("entries__media", distinct=True),
            )
            # Explicit: Django ignores Meta.ordering on queries with aggregates.
            .order_by("-starts_on", "-created_at")
        )
        params = self.request.query_params
        start = parse_date(params["start"], "start") if params.get("start") else None
        end = parse_date(params["end"], "end") if params.get("end") else None
        qs = overlapping(qs, start, end)
        if q := params.get("q"):
            qs = qs.filter(Q(title__icontains=q) | Q(description__icontains=q))
        return qs

    def list(self, request):
        events = list(self.get_queryset()[:1000])
        context = {**self.get_serializer_context(), "covers": event_covers(events)}
        return Response(EventSerializer(events, many=True, context=context).data)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, event):
        if self.request.query_params.get("with_entries") == "true":
            entries = Entry.objects.filter(event=event, user=self.request.user)
            keys = [k for a in MediaAsset.objects.filter(entry__in=entries) for k in [a.s3_key, *a.variants.values()]]
            entries.delete()
            storage.delete_objects(keys)
        event.delete()  # remaining entries are kept and simply detached (on_delete=SET_NULL)

    @action(detail=True, methods=["post"])
    def media(self, request, pk=None):
        """
        Upload a photo/video to the event; it lands on the day it was captured.
        Reuses that day's earliest entry in the event, or creates an untitled one.
        """
        upload = EventUploadRequestSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        data = upload.validated_data

        with transaction.atomic():
            # Lock the event so parallel uploads for a new day create one entry, not several.
            event = get_object_or_404(Event.objects.select_for_update(), pk=self.get_object().pk)
            day, moment, outside = place_in_event(event, data.get("captured_at"))
            entry = (
                Entry.objects.filter(user=request.user, event=event, occurred_on=day).order_by("occurred_at").first()
            )
            created = entry is None
            if created:
                entry = Entry.objects.create(
                    user=request.user, event=event, occurred_at=moment, timezone=event.timezone
                )
            ticket = issue_upload(request.user, data, entry=entry)

        ticket["placement"] = {
            "entry": str(entry.id),
            "date": day.isoformat(),
            "day": (day - event.starts_on).days + 1,
            "outside": outside,
            "created_entry": created,
        }
        return Response(ticket, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def entries(self, request, pk=None):
        event = self.get_object()
        entries = (
            Entry.objects.filter(user=request.user, event=event)
            .select_related("event")
            .prefetch_related("tags", Prefetch("media", queryset=MediaAsset.objects.prefetch_related("tags")))
            .order_by("occurred_at", "id")[:1000]
        )
        return Response(EntrySerializer(entries, many=True, context=self.get_serializer_context()).data)


class MediaPagination(CursorPagination):
    # Newest first by when it happened; `occurred_at` is annotated in get_queryset.
    ordering = ("-occurred_at", "position", "created_at")
    page_size = 60
    max_page_size = 200
    page_size_query_param = "page_size"


class MediaAssetViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    GET /api/media/?tag=&kind=image|video   every photo/video (journal, goals, milestones), newest first
    PATCH /api/media/{id}/ {"tags": [...]}  tag a photo or video
    """

    serializer_class = MediaAssetSerializer
    pagination_class = MediaPagination

    def get_queryset(self):
        qs = (
            MediaAsset.objects.filter(user=self.request.user)
            .select_related("entry", "goal", "milestone__goal")
            .prefetch_related("tags")
            .annotate(
                # When it happened: the entry's time, else the milestone's or goal's date, else upload time.
                occurred_at=Coalesce(
                    F("entry__occurred_at"),
                    Cast("milestone__occurred_on", DateTimeField()),
                    Cast("goal__starts_on", DateTimeField()),
                    F("created_at"),
                )
            )
        )
        if self.action == "list":
            qs = qs.exclude(status__in=[MediaAsset.Status.PENDING, MediaAsset.Status.FAILED])
            params = self.request.query_params
            if tag := params.get("tag"):
                qs = qs.filter(tags__slug=slugify(tag))
            if kind := params.get("kind"):
                qs = qs.filter(kind=kind)
        return qs

    def perform_destroy(self, asset):
        keys = [asset.s3_key, *asset.variants.values()]
        asset.delete()
        storage.delete_objects(keys)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Browser reports the S3 upload finished. Verify it actually landed."""
        asset = self.get_object()
        if asset.status == MediaAsset.Status.PENDING:
            size = storage.object_size(asset.s3_key)
            if size is None:
                return Response({"detail": "Upload not found in storage."}, status=status.HTTP_409_CONFLICT)
            if size > storage.max_bytes_for(asset.content_type):
                # S3 enforces the policy's size range, but don't trust it blindly.
                storage.delete_objects([asset.s3_key])
                asset.delete()
                return Response({"detail": "File is too large."}, status=status.HTTP_400_BAD_REQUEST)
            asset.size_bytes = size
            asset.status = (
                MediaAsset.Status.PROCESSING if settings.MEDIA_PROCESSING_ENABLED else MediaAsset.Status.READY
            )
            asset.save(update_fields=["size_bytes", "status"])
        return Response(self.get_serializer(asset).data)


class TagViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = TagSerializer

    def get_queryset(self):
        # Count entries tagged directly or through their media/event, matching the timeline filter.
        matching_entries = (
            Entry.objects.filter(Q(tags=OuterRef("pk")) | Q(media__tags=OuterRef("pk")) | Q(event__tags=OuterRef("pk")))
            .order_by()
            .values("user")
            .annotate(n=Count("id", distinct=True))
            .values("n")
        )
        return (
            Tag.objects.filter(user=self.request.user)
            .annotate(
                entry_count=Coalesce(Subquery(matching_entries), 0),
                media_count=Count("media", distinct=True),
            )
            .order_by("-entry_count", "name")
        )


@api_view(["GET"])
def calendar(request):
    """GET /api/calendar/?month=YYYY-MM -> per-day counts, cover thumbnails, and overlapping events."""
    try:
        year, month = (int(p) for p in request.query_params.get("month", "").split("-"))
        first = dt.date(year, month, 1)
    except ValueError:
        raise ValidationError({"month": "Expected YYYY-MM."}) from None
    last = (first + dt.timedelta(days=32)).replace(day=1) - dt.timedelta(days=1)

    entries = Entry.objects.filter(user=request.user, occurred_on__range=(first, last))
    counts = (
        entries.values("occurred_on")
        .annotate(entry_count=Count("id", distinct=True), media_count=Count("media", distinct=True))
        .order_by("occurred_on")
    )

    # First image of each day becomes the cell's cover.
    covers = {}
    images = (
        MediaAsset.objects.filter(entry__in=entries, kind=MediaAsset.Kind.IMAGE)
        .exclude(status__in=[MediaAsset.Status.PENDING, MediaAsset.Status.FAILED])
        .select_related("entry")
        .order_by("entry__occurred_at", "position")
    )
    for asset in images:
        covers.setdefault(asset.entry.occurred_on, asset)

    serializer = MediaAssetSerializer()
    days = []
    for row in counts:
        cover = covers.get(row["occurred_on"])
        days.append(
            {
                "date": row["occurred_on"].isoformat(),
                "entry_count": row["entry_count"],
                "media_count": row["media_count"],
                "cover_thumb": serializer.get_urls(cover)["thumb"] if cover else None,
            }
        )
    events = overlapping(Event.objects.filter(user=request.user), first, last).order_by("starts_on", "created_at")
    from goals.markers import goal_markers  # goals depends on journal; import lazily

    return Response(
        {
            "month": first.strftime("%Y-%m"),
            "days": days,
            "events": EventSummarySerializer(events, many=True).data,
            "goal_markers": goal_markers(request.user, first, last),
        }
    )


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def media_processed(request, asset_id):
    """Callback from the media-processing Lambda, authenticated with a shared secret."""
    token = request.headers.get("X-Internal-Token", "")
    if not settings.INTERNAL_API_TOKEN or not secrets.compare_digest(token, settings.INTERNAL_API_TOKEN):
        return Response(status=status.HTTP_403_FORBIDDEN)

    asset = get_object_or_404(MediaAsset, pk=asset_id)
    payload = ProcessedMediaSerializer(data=request.data)
    payload.is_valid(raise_exception=True)
    for field, value in payload.validated_data.items():
        setattr(asset, field, value)
    asset.save()
    log.info("Media %s processed: %s", asset.id, asset.status)
    return Response(status=status.HTTP_204_NO_CONTENT)

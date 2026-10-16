from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction
from rest_framework import serializers

from . import storage
from .models import Entry, Event, MediaAsset, Tag


def validate_timezone_name(value):
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise serializers.ValidationError("Unknown time zone.") from None
    return value


def _request_user(serializer):
    request = serializer.context.get("request")
    return request.user if request else None


class TagNamesField(serializers.Field):
    """Tags are read and written as a plain list of names."""

    def to_representation(self, manager):
        return [t.name for t in manager.all()]

    def to_internal_value(self, data):
        if not isinstance(data, list) or not all(isinstance(t, str) for t in data):
            raise serializers.ValidationError("Expected a list of tag names.")
        if len(data) > 30:
            raise serializers.ValidationError("At most 30 tags.")
        return [t.strip() for t in data if t.strip()]


class MediaAssetSerializer(serializers.ModelSerializer):
    tags = TagNamesField(required=False)
    # Writable so a photo can be moved to another of your entries (e.g. another day).
    entry = serializers.PrimaryKeyRelatedField(queryset=Entry.objects.none(), required=False)
    urls = serializers.SerializerMethodField()
    # When the entry happened; lets media-only views (Photos) show dates without loading entries.
    # Null for goal and milestone photos, which have no entry.
    entry_occurred_at = serializers.SerializerMethodField()
    # What it belongs to, for labels and links: an entry, a goal, or a milestone (with its goal).
    owner = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            "id", "entry", "entry_occurred_at", "owner", "kind", "status", "content_type", "original_filename",
            "width", "height", "duration_seconds", "taken_at", "tags", "urls", "created_at",
        ]
        read_only_fields = [f for f in fields if f not in ("tags", "entry")]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if user := _request_user(self):
            self.fields["entry"].queryset = Entry.objects.filter(user=user)

    def get_entry_occurred_at(self, asset):
        return serializers.DateTimeField().to_representation(asset.entry.occurred_at) if asset.entry_id else None

    def get_owner(self, asset):
        if asset.entry_id:
            return {"kind": "entry", "id": str(asset.entry_id)}
        if asset.goal_id:
            return {"kind": "goal", "id": str(asset.goal_id), "title": asset.goal.title, "goal_id": str(asset.goal_id),
                    "date": asset.goal.starts_on.isoformat() if asset.goal.starts_on else None}
        m = asset.milestone
        return {"kind": "milestone", "id": str(m.id), "title": m.title, "goal_id": str(m.goal_id),
                "goal_title": m.goal.title, "date": m.occurred_on.isoformat() if m.occurred_on else None}

    def get_urls(self, asset):
        v = asset.variants or {}
        original = storage.media_url(asset.s3_key) if asset.status != MediaAsset.Status.PENDING else None
        thumb = storage.media_url(v.get("thumb"))
        display = storage.media_url(v.get("display"))
        if asset.kind == MediaAsset.Kind.IMAGE:
            # Until the processor runs (or when it isn't deployed, e.g. locally), use the original.
            # Browsers can't render HEIC, so don't fall back for it.
            fallback = original if asset.content_type not in ("image/heic", "image/heif") else None
            thumb = thumb or fallback
            display = display or fallback
        return {"original": original, "thumb": thumb, "display": display, "poster": storage.media_url(v.get("poster"))}

    @transaction.atomic
    def update(self, instance, validated_data):
        tags = validated_data.pop("tags", None)
        if tags is not None:
            instance.tags.set(Tag.resolve(instance.user, tags))

        target = validated_data.pop("entry", None)
        if target is not None and instance.entry_id is None:
            raise serializers.ValidationError({"entry": "Only journal photos can be moved between entries."})
        if target is not None and target.pk != instance.entry_id:
            source = instance.entry
            instance.entry = target
            instance.position = target.media.count()
            instance.save(update_fields=["entry", "position"])
            # Day entries made by event uploads are just containers; drop one once it's empty.
            if not (source.title or source.body or source.media.exists() or source.tags.exists()):
                source.delete()
        return super().update(instance, validated_data)


class EventSummarySerializer(serializers.ModelSerializer):
    """Just enough to label an entry as part of an event and to draw its span."""

    class Meta:
        model = Event
        fields = ["id", "title", "starts_on", "ends_on"]


class EntrySerializer(serializers.ModelSerializer):
    tags = TagNamesField(required=False)
    media = MediaAssetSerializer(many=True, read_only=True)
    event = serializers.PrimaryKeyRelatedField(queryset=Event.objects.none(), allow_null=True, required=False)
    event_summary = EventSummarySerializer(source="event", read_only=True)

    class Meta:
        model = Entry
        fields = [
            "id", "title", "body", "occurred_at", "timezone", "occurred_on", "tags", "media",
            "event", "event_summary", "created_at", "updated_at",
        ]
        read_only_fields = ["occurred_on", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if user := _request_user(self):
            self.fields["event"].queryset = Event.objects.filter(user=user)  # can't attach to others' events

    def validate_timezone(self, value):
        return validate_timezone_name(value)

    @transaction.atomic
    def create(self, validated_data):
        tags = validated_data.pop("tags", [])
        entry = Entry.objects.create(**validated_data)
        entry.tags.set(Tag.resolve(entry.user, tags))
        return entry

    @transaction.atomic
    def update(self, instance, validated_data):
        tags = validated_data.pop("tags", None)
        entry = super().update(instance, validated_data)
        if tags is not None:
            entry.tags.set(Tag.resolve(entry.user, tags))
        return entry


def event_covers(events):
    """
    Cover photo per event: the chosen cover, else the first photo of its earliest entry.
    Batched so listing many events costs two queries, not one per event.
    """
    chosen = {e.id: e.cover_id for e in events if e.cover_id}
    assets = MediaAsset.objects.in_bulk(chosen.values())
    covers = {event_id: assets.get(asset_id) for event_id, asset_id in chosen.items()}

    missing = [e.id for e in events if e.id not in covers or covers[e.id] is None]
    if missing:
        candidates = (
            MediaAsset.objects.filter(entry__event_id__in=missing, kind=MediaAsset.Kind.IMAGE)
            .exclude(status__in=[MediaAsset.Status.PENDING, MediaAsset.Status.FAILED])
            .select_related("entry")
            .order_by("entry__occurred_at", "position")
        )
        for asset in candidates:
            if covers.get(asset.entry.event_id) is None:
                covers[asset.entry.event_id] = asset
    return covers


class EventSerializer(serializers.ModelSerializer):
    tags = TagNamesField(required=False)
    cover = serializers.PrimaryKeyRelatedField(queryset=MediaAsset.objects.none(), allow_null=True, required=False)
    cover_urls = serializers.SerializerMethodField()
    entry_count = serializers.SerializerMethodField()
    media_count = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id", "title", "description", "starts_on", "ends_on", "timezone", "tags",
            "cover", "cover_urls", "entry_count", "media_count", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if user := _request_user(self):
            self.fields["cover"].queryset = MediaAsset.objects.filter(user=user)

    def validate_timezone(self, value):
        return validate_timezone_name(value)

    def validate(self, data):
        starts_on = data.get("starts_on", getattr(self.instance, "starts_on", None))
        ends_on = data.get("ends_on", getattr(self.instance, "ends_on", None))
        if starts_on and ends_on and ends_on < starts_on:
            raise serializers.ValidationError({"ends_on": "The end date can't be before the start date."})
        return data

    def get_cover_urls(self, event):
        covers = self.context.get("covers")
        if covers is None:
            covers = event_covers([event])
        asset = covers.get(event.id)
        return MediaAssetSerializer().get_urls(asset) if asset else None

    # Counts come from list annotations when available; fall back to a query otherwise.
    def get_entry_count(self, event):
        count = getattr(event, "entry_count", None)
        return count if count is not None else event.entries.count()

    def get_media_count(self, event):
        count = getattr(event, "media_count", None)
        return count if count is not None else MediaAsset.objects.filter(entry__event=event).count()

    @transaction.atomic
    def create(self, validated_data):
        tags = validated_data.pop("tags", [])
        event = Event.objects.create(**validated_data)
        event.tags.set(Tag.resolve(event.user, tags))
        return event

    @transaction.atomic
    def update(self, instance, validated_data):
        tags = validated_data.pop("tags", None)
        event = super().update(instance, validated_data)
        if tags is not None:
            event.tags.set(Tag.resolve(event.user, tags))
        return event


class TagSerializer(serializers.ModelSerializer):
    # Entries that match the tag directly or through one of their photos/videos.
    entry_count = serializers.IntegerField(read_only=True)
    media_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Tag
        fields = ["id", "name", "slug", "entry_count", "media_count"]


class UploadRequestSerializer(serializers.Serializer):
    filename = serializers.CharField(max_length=255)
    content_type = serializers.ChoiceField(choices=list(storage.ALLOWED_TYPES))
    size = serializers.IntegerField(min_value=1)
    tags = TagNamesField(required=False)

    def validate(self, data):
        limit = storage.max_bytes_for(data["content_type"])
        if data["size"] > limit:
            raise serializers.ValidationError({"size": f"File is too large (max {limit // 1024**2} MB)."})
        return data


class EventUploadRequestSerializer(UploadRequestSerializer):
    # When the photo was taken, as the browser read it: a naive local wall-clock time from
    # EXIF ("2026-07-05T14:32:00"), or an ISO instant with offset (file timestamps).
    captured_at = serializers.CharField(required=False, allow_blank=True, max_length=40)


class ProcessedMediaSerializer(serializers.Serializer):
    """Payload the media-processing Lambda posts back."""

    status = serializers.ChoiceField(choices=[MediaAsset.Status.READY, MediaAsset.Status.FAILED])
    width = serializers.IntegerField(required=False, allow_null=True)
    height = serializers.IntegerField(required=False, allow_null=True)
    duration_seconds = serializers.FloatField(required=False, allow_null=True)
    taken_at = serializers.DateTimeField(required=False, allow_null=True)
    variants = serializers.DictField(child=serializers.CharField(), required=False)

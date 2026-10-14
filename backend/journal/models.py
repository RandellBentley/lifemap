import uuid
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import models
from django.utils.text import slugify


class Tag(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tags")
    name = models.CharField(max_length=64)
    slug = models.SlugField(max_length=64)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "slug"], name="unique_tag_per_user")]
        ordering = ["name"]

    def __str__(self):
        return self.name

    @classmethod
    def resolve(cls, user, names):
        """Map tag names to Tag rows, creating any that don't exist yet."""
        tags = []
        for name in names:
            slug = slugify(name)[:64]
            if slug:
                tag, _ = cls.objects.get_or_create(user=user, slug=slug, defaults={"name": name.strip()[:64]})
                tags.append(tag)
        return tags


class Event(models.Model):
    """
    A titled span of days (a trip, a festival) that groups the day entries inside it.
    Photos stay on the day entries, so the calendar and day views keep working unchanged.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="events")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    starts_on = models.DateField()
    ends_on = models.DateField(null=True, blank=True)  # null while the event is ongoing
    # Day boundaries (and "today" for ongoing events) follow the event's zone.
    timezone = models.CharField(max_length=64, default="UTC")
    tags = models.ManyToManyField(Tag, blank=True, related_name="events")
    cover = models.ForeignKey("MediaAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_on", "-created_at"]
        indexes = [models.Index(fields=["user", "starts_on"], name="event_user_start")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ends_on__isnull=True) | models.Q(ends_on__gte=models.F("starts_on")),
                name="event_ends_on_or_after_start",
            )
        ]

    def __str__(self):
        return self.title


class Entry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="entries")
    title = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)
    occurred_at = models.DateTimeField()
    # IANA zone the event happened in, e.g. "America/Denver".
    timezone = models.CharField(max_length=64, default="UTC")
    # Local calendar date of the event. Derived on save; the calendar groups by this
    # so an 11pm event doesn't land on the next day in UTC.
    occurred_on = models.DateField(editable=False, db_index=False)
    tags = models.ManyToManyField(Tag, blank=True, related_name="entries")
    # Optional: the multi-day event this day belongs to. Deleting the event keeps the entry.
    event = models.ForeignKey(Event, null=True, blank=True, on_delete=models.SET_NULL, related_name="entries")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-occurred_at"]
        verbose_name_plural = "entries"
        indexes = [
            models.Index(fields=["user", "-occurred_at"], name="entry_user_timeline"),
            models.Index(fields=["user", "occurred_on"], name="entry_user_day"),
        ]

    def __str__(self):
        return self.title or f"Entry {self.occurred_on}"

    def save(self, *args, **kwargs):
        self.occurred_on = self.occurred_at.astimezone(ZoneInfo(self.timezone)).date()
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = {*kwargs["update_fields"], "occurred_on"}
        super().save(*args, **kwargs)


class MediaAsset(models.Model):
    class Kind(models.TextChoices):
        IMAGE = "image"
        VIDEO = "video"

    class Status(models.TextChoices):
        PENDING = "pending"  # ticket issued, upload not confirmed
        PROCESSING = "processing"  # uploaded, waiting on thumbnails/transcode
        READY = "ready"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="media")
    # Exactly one owner: a journal entry, a goal (its photo), or a goal milestone.
    entry = models.ForeignKey(Entry, null=True, blank=True, on_delete=models.CASCADE, related_name="media")
    goal = models.ForeignKey("goals.Goal", null=True, blank=True, on_delete=models.CASCADE, related_name="photos")
    milestone = models.ForeignKey(
        "goals.Milestone", null=True, blank=True, on_delete=models.CASCADE, related_name="media"
    )
    kind = models.CharField(max_length=10, choices=Kind.choices)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    content_type = models.CharField(max_length=100)
    original_filename = models.CharField(max_length=255, blank=True)
    size_bytes = models.BigIntegerField()
    s3_key = models.CharField(max_length=512, unique=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    duration_seconds = models.FloatField(null=True, blank=True)
    taken_at = models.DateTimeField(null=True, blank=True)  # from EXIF, when available
    # Derived object keys written by the processor, e.g. {"thumb": "...", "display": "..."}.
    variants = models.JSONField(default=dict, blank=True)
    tags = models.ManyToManyField(Tag, blank=True, related_name="media")
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(entry__isnull=False, goal__isnull=True, milestone__isnull=True)
                    | models.Q(entry__isnull=True, goal__isnull=False, milestone__isnull=True)
                    | models.Q(entry__isnull=True, goal__isnull=True, milestone__isnull=False)
                ),
                name="media_has_exactly_one_owner",
            )
        ]

    def __str__(self):
        return f"{self.kind} {self.id}"

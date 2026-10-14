import uuid

from django.conf import settings
from django.db import models


class Goal(models.Model):
    """Something you're working toward. Its photo is a journal.MediaAsset with goal=this."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="goals")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    starts_on = models.DateField(null=True, blank=True)
    reward = models.CharField(max_length=300, blank=True)
    achieved_on = models.DateField(null=True, blank=True)  # null while in progress
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class Milestone(models.Model):
    """A step along the way to a goal. Its photo/video is a journal.MediaAsset with milestone=this."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="milestones")
    goal = models.ForeignKey(Goal, on_delete=models.CASCADE, related_name="milestones")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    occurred_on = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Dated milestones in order; undated ones after them, in the order they were added.
        ordering = [models.F("occurred_on").asc(nulls_last=True), "created_at"]

    def __str__(self):
        return self.title


class Metric(models.Model):
    """
    Something measurable about a goal: weight, debt balance, study sessions, hours practiced.
    Values (here and on measurements) are stored in the kind's base unit; see goals/units.py.
    """

    class Kind(models.TextChoices):
        COUNT = "count"
        WEIGHT = "weight"
        DISTANCE = "distance"
        DURATION = "duration"
        MONEY = "money"
        PERCENT = "percent"

    class Mode(models.TextChoices):
        LATEST = "latest"  # progress is the most recent reading (weight, a balance)
        TOTAL = "total"  # progress is the sum of all readings (sessions, hours, payments)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="metrics")
    goal = models.ForeignKey(Goal, on_delete=models.CASCADE, related_name="metrics")
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=12, choices=Kind.choices)
    unit = models.CharField(max_length=32)  # display unit: "lb", "mi", "h", "USD", "study sessions"
    mode = models.CharField(max_length=8, choices=Mode.choices)
    start_value = models.DecimalField(max_digits=30, decimal_places=10, null=True, blank=True)
    target_value = models.DecimalField(max_digits=30, decimal_places=10, null=True, blank=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self):
        return f"{self.name} ({self.unit})"


class Measurement(models.Model):
    """One reading of a metric, optionally recorded as part of a milestone."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="measurements")
    metric = models.ForeignKey(Metric, on_delete=models.CASCADE, related_name="measurements")
    value = models.DecimalField(max_digits=30, decimal_places=10)  # base unit
    recorded_on = models.DateField()
    note = models.CharField(max_length=300, blank=True)
    # Deleting the milestone keeps the reading; it just stops being "part of" it.
    milestone = models.ForeignKey(
        Milestone, null=True, blank=True, on_delete=models.SET_NULL, related_name="measurements"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["recorded_on", "created_at"]
        constraints = [
            # A milestone records at most one value per metric.
            models.UniqueConstraint(fields=["milestone", "metric"], name="one_reading_per_metric_per_milestone")
        ]

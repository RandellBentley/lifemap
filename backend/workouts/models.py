"""
Workout tracking (personal site only: every endpoint sits behind the `workouts` feature flag).

Weights are stored in kilograms; the frontend shows kg or lb. Set videos and progress photos are
journal.MediaAsset rows owned by a WorkoutSet / ProgressReport, kept out of the journal's Photos.
"""

import uuid

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

WEIGHT = {"max_digits": 10, "decimal_places": 4}  # kg; 4 places so 225 lb reads back as 225


class Exercise(models.Model):
    """The user's exercise library ("Snatch", "Clean and Jerk"), offered in the dropdown."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="exercises")
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = [Lower("name")]
        constraints = [
            # "snatch" and "Snatch" are the same exercise.
            models.UniqueConstraint(Lower("name"), "user", name="unique_exercise_name_per_user"),
        ]

    def __str__(self):
        return self.name


class Workout(models.Model):
    """One training session."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workouts")
    performed_on = models.DateField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-performed_on", "-created_at"]

    def __str__(self):
        return f"Workout on {self.performed_on}"


class WorkoutExercise(models.Model):
    """An exercise as performed in one workout, holding its sets."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name="exercises")
    # RESTRICT: an exercise with history can be renamed but not deleted, so old workouts keep it.
    # Unlike PROTECT, it still allows deleting the whole account, which removes both together.
    exercise = models.ForeignKey(Exercise, on_delete=models.RESTRICT, related_name="uses")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position"]

    def __str__(self):
        return f"{self.exercise} in {self.workout}"


class WorkoutSet(models.Model):
    """One set: reps, optional weight, made or missed, optional video (MediaAsset with workout_set=this)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workout_exercise = models.ForeignKey(WorkoutExercise, on_delete=models.CASCADE, related_name="sets")
    position = models.PositiveIntegerField(default=0)
    reps = models.PositiveIntegerField()
    weight_kg = models.DecimalField(**WEIGHT, null=True, blank=True)  # null for bodyweight work
    made = models.BooleanField(default=True)  # False = a missed lift

    class Meta:
        ordering = ["position"]

    def __str__(self):
        return f"{self.reps} reps @ {self.weight_kg} kg{'' if self.made else ' (missed)'}"


class ProgressReport(models.Model):
    """
    A physique update: date, body weight, notes, photos (MediaAsset with progress_report=this).
    Either standalone, or part of a workout, in which case it's dated the workout's day and
    edited through the workout. Deleting the workout keeps it as a standalone update.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="progress_reports")
    workout = models.OneToOneField(Workout, null=True, blank=True, on_delete=models.SET_NULL, related_name="physique")
    recorded_on = models.DateField()
    body_weight_kg = models.DecimalField(**WEIGHT, null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-recorded_on", "-created_at"]

    def __str__(self):
        return f"Progress report on {self.recorded_on}"

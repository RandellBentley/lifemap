from django.contrib import admin

from .models import Exercise, PersonalRecord, ProgressReport, Workout, WorkoutExercise


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "created_at")
    search_fields = ("name",)


class WorkoutExerciseInline(admin.TabularInline):
    model = WorkoutExercise
    extra = 0


@admin.register(Workout)
class WorkoutAdmin(admin.ModelAdmin):
    list_display = ("performed_on", "user", "created_at")
    inlines = [WorkoutExerciseInline]


@admin.register(ProgressReport)
class ProgressReportAdmin(admin.ModelAdmin):
    list_display = ("recorded_on", "user", "body_weight_kg")


@admin.register(PersonalRecord)
class PersonalRecordAdmin(admin.ModelAdmin):
    list_display = ("exercise", "weight_kg", "achieved_on", "user")

from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
# Specific prefixes before the bare "workouts" one, so /workouts/exercises/ isn't read as a workout id.
router.register("workouts/exercises", views.ExerciseViewSet, basename="exercise")
router.register("workouts/sets", views.SetViewSet, basename="workout-set")
router.register("workouts/progress", views.ProgressReportViewSet, basename="progress-report")
router.register("workouts/records", views.PersonalRecordViewSet, basename="personal-record")
router.register("workouts", views.WorkoutViewSet, basename="workout")

urlpatterns = router.urls

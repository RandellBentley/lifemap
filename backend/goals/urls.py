from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register("goals", views.GoalViewSet, basename="goal")
router.register("milestones", views.MilestoneViewSet, basename="milestone")
router.register("metrics", views.MetricViewSet, basename="metric")
router.register("measurements", views.MeasurementViewSet, basename="measurement")

urlpatterns = router.urls

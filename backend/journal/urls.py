from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register("entries", views.EntryViewSet, basename="entry")
router.register("events", views.EventViewSet, basename="event")
router.register("media", views.MediaAssetViewSet, basename="media")
router.register("tags", views.TagViewSet, basename="tag")

urlpatterns = [
    path("calendar/", views.calendar, name="calendar"),
    path("internal/media/<uuid:asset_id>/processed/", views.media_processed, name="media-processed"),
    *router.urls,
]

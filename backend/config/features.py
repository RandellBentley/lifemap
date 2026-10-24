"""
Feature flags, set per environment with the FEATURES setting (e.g. FEATURES=workouts).

The backend is the real boundary: views behind a disabled feature answer 404, as if they
didn't exist. The frontend reads GET /api/config/ only to decide what to show.
"""

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response


def feature_enabled(name: str) -> bool:
    if name not in settings.KNOWN_FEATURES:
        raise ValueError(f"Unknown feature {name!r}")  # catches typos at the call site
    return name in settings.FEATURES


def requires_feature(name: str) -> type[BasePermission]:
    """
    DRF permission. List it first so a disabled feature is a 404 even for signed-out callers
    (DRF checks permissions in order; IsAuthenticated first would answer 403 and reveal it):
        permission_classes = [requires_feature("workouts"), IsAuthenticated]
    """
    feature_enabled(name)  # validate the name when the view is defined, not on first request

    class FeatureEnabled(BasePermission):
        def has_permission(self, request, view):
            if not feature_enabled(name):
                raise NotFound()  # 404, not 403: a disabled feature doesn't exist here
            return True

    FeatureEnabled.__name__ = f"RequiresFeature_{name}"
    return FeatureEnabled


@api_view(["GET"])
@permission_classes([AllowAny])
def config(request):
    """GET /api/config/ -> which features this environment has switched on."""
    return Response({"features": sorted(settings.FEATURES)})

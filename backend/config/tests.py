from django.test import TestCase, override_settings
from django.urls import path
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIClient

from accounts.models import User

from .features import feature_enabled, requires_feature


@api_view(["GET"])
@permission_classes([requires_feature("workouts"), IsAuthenticated])
def flagged_view(request):
    return Response({"ok": True})


urlpatterns = [path("flagged/", flagged_view)]


@override_settings(ROOT_URLCONF="config.tests")
class FeatureFlagTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user("alice"))

    @override_settings(FEATURES=frozenset({"workouts"}))
    def test_enabled_feature_is_reachable(self):
        self.assertEqual(self.client.get("/flagged/").status_code, 200)

    @override_settings(FEATURES=frozenset())
    def test_disabled_feature_is_a_404(self):
        self.assertEqual(self.client.get("/flagged/").status_code, 404)

    @override_settings(FEATURES=frozenset())
    def test_disabled_feature_is_a_404_even_when_signed_out(self):
        # Anonymous callers can't even learn the endpoint exists.
        self.assertEqual(APIClient().get("/flagged/").status_code, 404)

    @override_settings(FEATURES=frozenset({"workouts"}))
    def test_enabled_feature_still_requires_auth(self):
        self.assertEqual(APIClient().get("/flagged/").status_code, 403)

    def test_unknown_feature_names_fail_fast(self):
        with self.assertRaises(ValueError):
            feature_enabled("wrokouts")
        with self.assertRaises(ValueError):
            requires_feature("wrokouts")


class ConfigEndpointTests(TestCase):
    @override_settings(FEATURES=frozenset({"workouts"}))
    def test_reports_enabled_features(self):
        self.assertEqual(APIClient().get("/api/config/").json(), {"features": ["workouts"]})

    @override_settings(FEATURES=frozenset())
    def test_reports_none(self):
        self.assertEqual(APIClient().get("/api/config/").json(), {"features": []})

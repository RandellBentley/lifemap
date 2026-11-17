import datetime as dt
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from journal.models import MediaAsset

from .models import Exercise, ProgressReport, Workout, WorkoutSet

VIDEO = {"filename": "set1.mov", "content_type": "video/quicktime", "size": 1000}
PHOTO = {"filename": "front.jpg", "content_type": "image/jpeg", "size": 1000}
LB = Decimal("0.45359237")


@override_settings(FEATURES=frozenset({"workouts"}), MEDIA_PROCESSING_ENABLED=False)
@mock.patch("journal.storage.presigned_upload", return_value={"url": "https://s3.test", "fields": {}})
@mock.patch("journal.storage.object_size", return_value=1000)
@mock.patch("journal.storage.media_url", lambda key: f"https://media.test/{key}" if key else None)
@mock.patch("journal.storage.delete_objects")
class WorkoutApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.snatch = self.add_exercise("Snatch")
        self.cj = self.add_exercise("Clean and Jerk")

    def add_exercise(self, name):
        resp = self.client.post("/api/workouts/exercises/", {"name": name}, format="json")
        self.assertIn(resp.status_code, (200, 201), resp.data)
        return resp.data

    def create_workout(self, **overrides):
        body = {
            "performed_on": "2026-10-20",
            "notes": "Heavy singles",
            "exercises": [
                {"exercise": self.snatch["id"], "sets": [{"reps": 3, "weight_kg": 60}, {"reps": 2, "weight_kg": 65}]},
                {"exercise": self.cj["id"], "sets": [{"reps": 1, "weight_kg": 85}]},
            ],
            **overrides,
        }
        resp = self.client.post("/api/workouts/", body, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def upload_video(self, set_id):
        ticket = self.client.post(f"/api/workouts/sets/{set_id}/video/", VIDEO, format="json")
        self.assertEqual(ticket.status_code, 201, ticket.data)
        self.client.post(f"/api/media/{ticket.data['asset']['id']}/complete/")
        return ticket.data["asset"]["id"]

    # --- exercise library ---------------------------------------------------------------

    def test_exercise_library_is_case_insensitive_and_sorted(self, *_):
        again = self.client.post("/api/workouts/exercises/", {"name": "  sNATCH "}, format="json")
        self.assertEqual((again.status_code, again.data["id"]), (200, self.snatch["id"]))  # existing returned
        self.add_exercise("Back Squat")
        names = [e["name"] for e in self.client.get("/api/workouts/exercises/").data]
        self.assertEqual(names, ["Back Squat", "Clean and Jerk", "Snatch"])
        clash = self.client.patch(f"/api/workouts/exercises/{self.cj['id']}/", {"name": "snatch"}, format="json")
        self.assertEqual(clash.status_code, 400)

    def test_used_exercise_cannot_be_deleted_but_can_be_renamed(self, *_):
        self.create_workout()
        self.assertEqual(self.client.delete(f"/api/workouts/exercises/{self.snatch['id']}/").status_code, 409)
        renamed = self.client.patch(f"/api/workouts/exercises/{self.snatch['id']}/", {"name": "Power Snatch"},
                                    format="json")
        self.assertEqual(renamed.data["use_count"], 1)
        unused = self.add_exercise("Front Squat")
        self.assertEqual(self.client.delete(f"/api/workouts/exercises/{unused['id']}/").status_code, 204)

    # --- workouts -----------------------------------------------------------------------

    def test_user_with_workouts_can_be_deleted(self, *_):
        self.create_workout()
        self.user.delete()
        self.assertFalse(Exercise.objects.exists())

    def test_create_and_list_workout(self, *_):
        workout = self.create_workout()
        self.assertEqual([e["exercise_name"] for e in workout["exercises"]], ["Snatch", "Clean and Jerk"])
        self.assertEqual([(s["reps"], s["weight_kg"]) for s in workout["exercises"][0]["sets"]], [(3, 60), (2, 65)])
        self.create_workout(performed_on="2026-10-22", exercises=[{"exercise": self.cj["id"], "sets": [{"reps": 5}]}])
        listed = self.client.get("/api/workouts/").data["results"]
        self.assertEqual([w["performed_on"] for w in listed], ["2026-10-22", "2026-10-20"])
        self.assertIsNone(listed[0]["exercises"][0]["sets"][0]["weight_kg"])  # bodyweight set

    def test_sets_are_made_unless_marked_missed(self, *_):
        workout = self.create_workout(exercises=[
            {"exercise": self.snatch["id"], "sets": [{"reps": 1, "weight_kg": 80}, {"reps": 1, "weight_kg": 85, "made": False}]},
        ])
        sets = workout["exercises"][0]["sets"]
        self.assertEqual([s["made"] for s in sets], [True, False])
        # Editing a missed set into a made one, as the editor's toggle does.
        sets[1]["made"] = True
        exercises = [{"id": workout["exercises"][0]["id"], "exercise": self.snatch["id"], "sets": sets}]
        resp = self.client.put(f"/api/workouts/{workout['id']}/", {**workout, "exercises": exercises}, format="json")
        self.assertEqual([s["made"] for s in resp.data["exercises"][0]["sets"]], [True, True])

    def test_pounds_round_trip_exactly(self, *_):
        kg = (Decimal(225) * LB).quantize(Decimal("0.0001"))  # what the frontend sends for 225 lb
        workout = self.create_workout(exercises=[{"exercise": self.snatch["id"], "sets": [{"reps": 1, "weight_kg": kg}]}])
        stored = Decimal(str(workout["exercises"][0]["sets"][0]["weight_kg"]))
        self.assertEqual(round(stored / LB, 2), Decimal("225.00"))

    def test_update_keeps_set_ids_and_videos_and_removes_dropped_sets(self, delete_objects, *_):
        workout = self.create_workout()
        snatch = workout["exercises"][0]
        first, second = snatch["sets"]
        video = self.upload_video(first["id"])
        self.upload_video(second["id"])
        delete_objects.reset_mock()

        body = {"exercises": [
            # Keep the first snatch set (edited) and add a new one; drop the second set and the C&J.
            {"id": snatch["id"], "exercise": self.snatch["id"],
             "sets": [{"id": first["id"], "reps": 3, "weight_kg": 62.5}, {"reps": 1, "weight_kg": 70}]},
        ]}
        resp = self.client.patch(f"/api/workouts/{workout['id']}/", body, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        sets = resp.data["exercises"][0]["sets"]
        self.assertEqual(len(resp.data["exercises"]), 1)
        self.assertEqual((sets[0]["id"], sets[0]["weight_kg"], sets[0]["video"]["id"]), (first["id"], 62.5, video))
        self.assertEqual((sets[1]["reps"], sets[1]["video"]), (1, None))
        self.assertFalse(WorkoutSet.objects.filter(pk=second["id"]).exists())
        self.assertEqual(MediaAsset.objects.filter(workout_set__isnull=False).count(), 1)  # dropped set's video gone
        self.assertTrue(delete_objects.called)

    def test_validation(self, *_):
        bad = lambda body: self.client.post("/api/workouts/", {"performed_on": "2026-10-20", **body}, format="json")  # noqa: E731
        self.assertEqual(bad({"exercises": []}).status_code, 400)
        self.assertEqual(bad({"exercises": [{"exercise": self.snatch["id"], "sets": []}]}).status_code, 400)
        self.assertEqual(bad({"exercises": [{"exercise": self.snatch["id"], "sets": [{"reps": -1}]}]}).status_code, 400)
        workout = self.create_workout()
        foreign_set = {"exercises": [{"exercise": self.snatch["id"],
                                      "sets": [{"id": "00000000-0000-0000-0000-000000000000", "reps": 1}]}]}
        self.assertEqual(self.client.patch(f"/api/workouts/{workout['id']}/", foreign_set, format="json").status_code, 400)

    def test_set_video_replace_remove_and_video_only(self, *_):
        set_id = self.create_workout()["exercises"][0]["sets"][0]["id"]
        old = self.upload_video(set_id)
        new = self.upload_video(set_id)
        self.assertFalse(MediaAsset.objects.filter(pk=old).exists())
        self.assertEqual(self.client.get("/api/workouts/").data["results"][0]["exercises"][0]["sets"][0]["video"]["id"], new)
        self.assertEqual(self.client.post(f"/api/workouts/sets/{set_id}/video/", PHOTO, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/workouts/sets/{set_id}/video/").status_code, 204)
        self.assertFalse(MediaAsset.objects.filter(workout_set_id=set_id).exists())

    def test_delete_workout_removes_set_videos(self, delete_objects, *_):
        workout = self.create_workout()
        self.upload_video(workout["exercises"][0]["sets"][0]["id"])
        delete_objects.reset_mock()
        self.assertEqual(self.client.delete(f"/api/workouts/{workout['id']}/").status_code, 204)
        self.assertFalse(MediaAsset.objects.exists())
        self.assertEqual(len(delete_objects.call_args.args[0]), 1)

    # --- progress reports ---------------------------------------------------------------

    def test_progress_report_with_photos(self, delete_objects, *_):
        resp = self.client.post("/api/workouts/progress/", {"recorded_on": "2026-10-01", "body_weight_kg": 81.2,
                                                            "notes": "Week 4"}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        report = resp.data
        for _i in range(2):
            ticket = self.client.post(f"/api/workouts/progress/{report['id']}/photos/", PHOTO, format="json")
            self.client.post(f"/api/media/{ticket.data['asset']['id']}/complete/")
        self.assertEqual(self.client.post(f"/api/workouts/progress/{report['id']}/photos/", VIDEO,
                                          format="json").status_code, 400)
        listed = self.client.get("/api/workouts/progress/").json()  # what the browser gets: a plain number
        self.assertEqual((listed[0]["body_weight_kg"], len(listed[0]["photos"])), (81.2, 2))
        self.assertEqual(listed[0]["photos"][0]["owner"], {"kind": "progress_report", "id": report["id"],
                                                           "date": "2026-10-01"})
        delete_objects.reset_mock()
        self.client.delete(f"/api/workouts/progress/{report['id']}/")
        self.assertFalse(MediaAsset.objects.exists())
        self.assertEqual(len(delete_objects.call_args.args[0]), 2)

    def test_workout_media_stays_off_the_photos_page(self, *_):
        self.upload_video(self.create_workout()["exercises"][0]["sets"][0]["id"])
        report = ProgressReport.objects.create(user=self.user, recorded_on=dt.date(2026, 10, 1))
        ticket = self.client.post(f"/api/workouts/progress/{report.id}/photos/", PHOTO, format="json")
        self.client.post(f"/api/media/{ticket.data['asset']['id']}/complete/")
        self.assertEqual(self.client.get("/api/media/").data["results"], [])

    # --- isolation ----------------------------------------------------------------------

    def test_other_users_data_is_invisible(self, *_):
        other = User.objects.create_user("bob")
        theirs = Exercise.objects.create(user=other, name="Deadlift")
        workout = Workout.objects.create(user=other, performed_on=dt.date(2026, 1, 1))
        report = ProgressReport.objects.create(user=other, recorded_on=dt.date(2026, 1, 1))
        self.assertEqual([e["name"] for e in self.client.get("/api/workouts/exercises/").data], ["Clean and Jerk", "Snatch"])
        self.assertEqual(self.client.get(f"/api/workouts/{workout.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/workouts/progress/{report.id}/").status_code, 404)
        uses_theirs = {"performed_on": "2026-10-20", "exercises": [{"exercise": str(theirs.id), "sets": [{"reps": 1}]}]}
        self.assertEqual(self.client.post("/api/workouts/", uses_theirs, format="json").status_code, 400)


class WorkoutFeatureFlagTests(TestCase):
    """With the flag off (the public demo), every workouts endpoint is a 404."""

    ENDPOINTS = ["/api/workouts/", "/api/workouts/exercises/", "/api/workouts/progress/",
                 "/api/workouts/00000000-0000-0000-0000-000000000000/",
                 "/api/workouts/sets/00000000-0000-0000-0000-000000000000/video/"]

    @override_settings(FEATURES=frozenset())
    def test_all_endpoints_404_when_disabled(self):
        signed_in = APIClient()
        signed_in.force_authenticate(User.objects.create_user("alice"))
        for client in (signed_in, APIClient()):
            for url in self.ENDPOINTS:
                with self.subTest(url=url, signed_in=client is signed_in):
                    resp = client.post(url, {}, format="json") if url.endswith("video/") else client.get(url)
                    self.assertEqual(resp.status_code, 404)

    @override_settings(FEATURES=frozenset({"workouts"}))
    def test_enabled_but_signed_out_is_403(self):
        self.assertEqual(APIClient().get("/api/workouts/").status_code, 403)

import datetime as dt
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from journal.models import Entry, MediaAsset

from .models import Goal, Measurement, Metric, Milestone

PHOTO = {"filename": "p.jpg", "content_type": "image/jpeg", "size": 100}


@override_settings(MEDIA_PROCESSING_ENABLED=False)
@mock.patch("journal.storage.presigned_upload", return_value={"url": "https://s3.test", "fields": {}})
@mock.patch("journal.storage.object_size", return_value=100)
@mock.patch("journal.storage.media_url", lambda key: f"https://media.test/{key}" if key else None)
@mock.patch("journal.storage.delete_objects")
class GoalApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_goal(self, **data):
        resp = self.client.post("/api/goals/", {"title": "Run a marathon", **data}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def upload(self, path):
        ticket = self.client.post(path, PHOTO, format="json")
        self.assertEqual(ticket.status_code, 201, ticket.data)
        self.client.post(f"/api/media/{ticket.data['asset']['id']}/complete/")
        return ticket.data["asset"]["id"]

    def test_create_with_optional_fields_and_list(self, *_):
        bare = self.create_goal()
        self.assertEqual((bare["starts_on"], bare["reward"], bare["photo"], bare["milestone_count"]), (None, "", None, 0))
        newer = self.create_goal(title="Learn Spanish", starts_on="2026-01-01", reward="Trip to Lisbon")
        # Postgres gives every row in a transaction the same now(); make "newer" actually newer.
        Goal.objects.filter(pk=newer["id"]).update(created_at=dt.datetime(2030, 1, 1, tzinfo=dt.UTC))
        titles = [g["title"] for g in self.client.get("/api/goals/").data]
        self.assertEqual(titles, ["Learn Spanish", "Run a marathon"])

    def test_status_filter_and_achieved_validation(self, *_):
        goal = self.create_goal(starts_on="2026-03-01")
        self.create_goal(title="Other")
        bad = self.client.patch(f"/api/goals/{goal['id']}/", {"achieved_on": "2026-02-01"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.client.patch(f"/api/goals/{goal['id']}/", {"achieved_on": "2026-09-30"}, format="json")
        self.assertEqual([g["title"] for g in self.client.get("/api/goals/?status=achieved").data], ["Run a marathon"])
        self.assertEqual([g["title"] for g in self.client.get("/api/goals/?status=active").data], ["Other"])

    def test_goal_photo_upload_replace_and_remove(self, delete_objects, *_):
        goal = self.create_goal()
        first = self.upload(f"/api/goals/{goal['id']}/photo/")
        second = self.upload(f"/api/goals/{goal['id']}/photo/")
        photo = self.client.get(f"/api/goals/{goal['id']}/").data["photo"]
        self.assertEqual(photo["id"], second)
        self.assertFalse(MediaAsset.objects.filter(pk=first).exists())  # replaced
        self.assertEqual(self.client.delete(f"/api/goals/{goal['id']}/photo/").status_code, 204)
        self.assertIsNone(self.client.get(f"/api/goals/{goal['id']}/").data["photo"])
        self.assertEqual(delete_objects.call_count, 3)  # first replaced (and an empty delete), then removed

    def test_milestones_ordering_and_media(self, *_):
        goal = self.create_goal()
        def add(**d):
            return self.client.post(f"/api/goals/{goal['id']}/milestones/", d, format="json")
        add(title="Undated idea")
        add(title="Half marathon", occurred_on="2026-06-01", description="2:05!")
        later = add(title="30k long run", occurred_on="2026-08-15").data
        add(title="First 5k", occurred_on="2026-02-10")
        listed = self.client.get(f"/api/goals/{goal['id']}/milestones/").data
        self.assertEqual([m["title"] for m in listed], ["First 5k", "Half marathon", "30k long run", "Undated idea"])
        self.assertEqual(self.client.get(f"/api/goals/{goal['id']}/").data["milestone_count"], 4)

        asset = self.upload(f"/api/milestones/{later['id']}/media/")
        detail = self.client.get(f"/api/milestones/{later['id']}/").data
        self.assertEqual((detail["media"]["id"], detail["media"]["entry"], detail["media"]["entry_occurred_at"]),
                         (asset, None, None))
        resp = self.client.patch(f"/api/milestones/{later['id']}/", {"title": "32k long run"}, format="json")
        self.assertEqual(resp.data["title"], "32k long run")

    def test_goal_media_on_photos_page_with_owner_and_tags(self, *_):
        goal = self.create_goal(starts_on="2026-01-15")
        ticket = self.client.post(f"/api/goals/{goal['id']}/photo/", {**PHOTO, "tags": ["Running"]}, format="json")
        self.assertEqual(ticket.data["asset"]["tags"], ["Running"])  # tags at upload time
        self.client.post(f"/api/media/{ticket.data['asset']['id']}/complete/")
        milestone = self.client.post(f"/api/goals/{goal['id']}/milestones/",
                                     {"title": "Half marathon", "occurred_on": "2026-06-01"}, format="json").data
        m_asset = self.upload(f"/api/milestones/{milestone['id']}/media/")
        self.client.patch(f"/api/media/{m_asset}/", {"tags": ["running", "race"]}, format="json")

        listed = self.client.get("/api/media/").data["results"]
        self.assertEqual([m["owner"]["kind"] for m in listed], ["milestone", "goal"])  # Jun 1 before Jan 15
        self.assertEqual((listed[0]["owner"]["title"], listed[0]["owner"]["goal_title"], listed[0]["owner"]["date"]),
                         ("Half marathon", "Run a marathon", "2026-06-01"))
        self.assertEqual(len(self.client.get("/api/media/?tag=race").data["results"]), 1)
        self.assertEqual(len(self.client.get("/api/media/?tag=running").data["results"]), 2)

        # Still can't be moved into a journal entry.
        entry = Entry.objects.create(user=self.user, occurred_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC))
        moved = self.client.patch(f"/api/media/{m_asset}/", {"entry": str(entry.id)}, format="json")
        self.assertEqual(moved.status_code, 400)

    def test_markers(self, *_):
        goal = self.create_goal(starts_on="2026-01-15", reward="Watch")
        def add(**d):
            return self.client.post(f"/api/goals/{goal['id']}/milestones/", d, format="json").data
        add(title="Undated")  # never a marker
        half = add(title="Half marathon", occurred_on="2026-06-01")
        add(title="10k", occurred_on="2026-03-10")
        self.client.patch(f"/api/goals/{goal['id']}/", {"achieved_on": "2026-10-04"}, format="json")
        self.create_goal(title="No dates")

        markers = self.client.get("/api/goals/markers/").data
        self.assertEqual([(m["kind"], m["date"], m["title"]) for m in markers], [
            ("goal_start", "2026-01-15", "Run a marathon"),
            ("milestone", "2026-03-10", "10k"),
            ("milestone", "2026-06-01", "Half marathon"),
            ("goal_achieved", "2026-10-04", "Run a marathon"),
        ])
        self.assertEqual(markers[2]["goal"]["title"], "Run a marathon")
        self.assertEqual(markers[3]["reward"], "Watch")

        ranged = self.client.get("/api/goals/markers/?start=2026-03-01&end=2026-06-30").data
        self.assertEqual([m["title"] for m in ranged], ["10k", "Half marathon"])
        self.assertEqual([m["title"] for m in self.client.get("/api/goals/markers/?q=half").data], ["Half marathon"])

        # Tag filter: only milestones/goals whose photo carries the tag.
        asset = self.upload(f"/api/milestones/{half['id']}/media/")
        self.client.patch(f"/api/media/{asset}/", {"tags": ["race"]}, format="json")
        tagged = self.client.get("/api/goals/markers/?tag=race").data
        self.assertEqual([(m["kind"], m["title"]) for m in tagged], [("milestone", "Half marathon")])
        self.assertIsNotNone(tagged[0]["thumb"])

        june = self.client.get("/api/calendar/?month=2026-06").data
        self.assertEqual([(m["kind"], m["date"]) for m in june["goal_markers"]], [("milestone", "2026-06-01")])

    def test_delete_goal_removes_milestones_and_media(self, delete_objects, *_):
        goal = self.create_goal()
        self.upload(f"/api/goals/{goal['id']}/photo/")
        milestone = self.client.post(f"/api/goals/{goal['id']}/milestones/", {"title": "Step"}, format="json").data
        self.upload(f"/api/milestones/{milestone['id']}/media/")
        delete_objects.reset_mock()
        self.assertEqual(self.client.delete(f"/api/goals/{goal['id']}/").status_code, 204)
        self.assertFalse(Milestone.objects.exists())
        self.assertFalse(MediaAsset.objects.exists())
        self.assertEqual(len(delete_objects.call_args.args[0]), 2)

    def test_other_users_goals_are_invisible(self, *_):
        other = User.objects.create_user("bob")
        theirs = Goal.objects.create(user=other, title="Theirs")
        milestone = Milestone.objects.create(user=other, goal=theirs, title="Theirs too")
        self.assertEqual(self.client.get("/api/goals/").data, [])
        self.assertEqual(self.client.get(f"/api/goals/{theirs.id}/milestones/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/goals/{theirs.id}/milestones/", {"title": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/milestones/{milestone.id}/", {"title": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.post(f"/api/goals/{theirs.id}/photo/", PHOTO, format="json").status_code, 404)


class MetricTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.goal = Goal.objects.create(user=self.user, title="Get healthy")

    def add_metric(self, **data):
        resp = self.client.post(f"/api/goals/{self.goal.id}/metrics/", data, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def log(self, metric, value, day, **extra):
        resp = self.client.post(f"/api/metrics/{metric['id']}/measurements/",
                                {"value": value, "recorded_on": day, **extra}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def progress(self, metric):
        return self.client.get(f"/api/metrics/{metric['id']}/").data["progress"]

    def test_weight_stored_in_kg_shown_in_chosen_unit(self):
        weight = self.add_metric(name="Weight", kind="weight", unit="lb", mode="latest", start_value=180, target_value=165)
        self.log(weight, 172.5, "2026-09-01")
        stored = Metric.objects.get(pk=weight["id"])
        self.assertAlmostEqual(float(stored.target_value), 74.842741, places=5)  # 165 lb in kg
        self.assertEqual(self.progress(weight)["current"], 172.5)

        # Switching the display unit re-renders everything without touching the data.
        as_kg = self.client.patch(f"/api/metrics/{weight['id']}/", {"unit": "kg"}, format="json").data
        self.assertEqual(as_kg["target_value"], 74.8427)  # 165 lb
        self.assertEqual(as_kg["progress"]["current"], 78.2447)  # 172.5 lb

    def test_latest_decreasing_progress_and_reached(self):
        weight = self.add_metric(name="Weight", kind="weight", unit="lb", mode="latest", start_value=180, target_value=165)
        self.assertEqual(self.progress(weight)["current"], None)
        self.log(weight, 171, "2026-09-15")
        self.log(weight, 174, "2026-09-01")  # logged later but dated earlier: not the latest
        p = self.progress(weight)
        self.assertEqual((p["current"], p["change"], p["direction"], p["reached"], p["count"]), (171, -9, "down", False, 2))
        self.assertAlmostEqual(p["progress"], 0.6)
        self.log(weight, 164, "2026-10-01")
        p = self.progress(weight)
        self.assertEqual((p["progress"], p["reached"], p["last_recorded_on"]), (1.0, True, "2026-10-01"))

    def test_latest_without_start_uses_first_reading(self):
        balance = self.add_metric(name="Debt", kind="money", unit="usd", mode="latest", target_value=0)
        self.assertEqual(balance["unit"], "USD")  # normalized
        self.log(balance, 12000, "2026-01-01")
        self.log(balance, 7400, "2026-09-01")
        p = self.progress(balance)
        self.assertEqual((p["start"], p["current"], p["direction"]), (12000, 7400, "down"))
        self.assertAlmostEqual(p["progress"], 4600 / 12000)

    def test_total_mode_sums_money_and_hours(self):
        paid = self.add_metric(name="Paid off", kind="money", unit="USD", mode="total", target_value=12000)
        for amount in (500, 750.25, 1000):
            self.log(paid, amount, "2026-09-01")
        p = self.progress(paid)
        self.assertEqual((p["current"], p["reached"]), (2250.25, False))

        hours = self.add_metric(name="Practice", kind="duration", unit="h", mode="total", target_value=50)
        self.log(hours, 1.5, "2026-09-01")
        self.log(hours, 0.75, "2026-09-02")
        self.assertEqual(self.progress(hours)["current"], 2.25)
        self.assertEqual(Measurement.objects.filter(metric_id=hours["id"]).order_by("recorded_on").first().value, 5400)

    def test_count_with_start_offset(self):
        sessions = self.add_metric(name="Study", kind="count", unit="study sessions", mode="total",
                                   start_value=10, target_value=100)
        self.log(sessions, 5, "2026-09-01")
        p = self.progress(sessions)
        self.assertEqual((p["start"], p["current"]), (10, 15))
        self.assertAlmostEqual(p["progress"], 5 / 90)

    def test_validation(self):
        def bad(**d):
            return self.client.post(f"/api/goals/{self.goal.id}/metrics/", {"name": "X", "mode": "latest", **d},
                                                   format="json")
        self.assertIn("unit", bad(kind="weight", unit="stone").data)
        self.assertIn("unit", bad(kind="money", unit="dollars").data)
        self.assertIn("kind", bad(kind="calories", unit="kcal").data)
        defaulted = bad(kind="distance")
        self.assertEqual((defaulted.status_code, defaulted.data["unit"]), (201, "mi"))
        weight = self.add_metric(name="Weight", kind="weight", unit="lb", mode="latest")
        self.log(weight, 170, "2026-09-01")
        changed = self.client.patch(f"/api/metrics/{weight['id']}/", {"kind": "count", "unit": "times"}, format="json")
        self.assertEqual(changed.status_code, 400)

    def test_milestone_readings(self):
        weight = self.add_metric(name="Weight", kind="weight", unit="lb", mode="latest", start_value=180, target_value=165)
        url = f"/api/goals/{self.goal.id}/milestones/"
        milestone = self.client.post(url, {"title": "Under 170!", "occurred_on": "2026-09-20",
                                           "readings": [{"metric": weight["id"], "value": 169.4}]}, format="json")
        self.assertEqual(milestone.status_code, 201, milestone.data)
        self.assertEqual([(m["metric"], m["value"]) for m in milestone.data["measurements"]], [(weight["id"], 169.4)])
        self.assertEqual(self.progress(weight)["current"], 169.4)

        # Moving the milestone's date moves its reading; null clears it.
        mid = milestone.data["id"]
        self.client.patch(f"/api/milestones/{mid}/", {"occurred_on": "2026-09-25"}, format="json")
        self.assertEqual(Measurement.objects.get(milestone_id=mid).recorded_on, dt.date(2026, 9, 25))
        readings = self.client.get(f"/api/metrics/{weight['id']}/measurements/").data
        self.assertEqual(readings[0]["milestone"]["title"], "Under 170!")
        self.client.patch(f"/api/milestones/{mid}/", {"readings": [{"metric": weight["id"], "value": None}]}, format="json")
        self.assertFalse(Measurement.objects.filter(milestone_id=mid).exists())

        # Readings must be for this goal's metrics.
        other_goal = Goal.objects.create(user=self.user, title="Other")
        foreign = Metric.objects.create(user=self.user, goal=other_goal, name="X", kind="count", unit="x", mode="total")
        bad = self.client.post(url, {"title": "x", "readings": [{"metric": str(foreign.id), "value": 1}]}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_deleting_milestone_keeps_reading_and_goal_lists_metrics(self):
        sessions = self.add_metric(name="Study", kind="count", unit="sessions", mode="total", target_value=10)
        m = self.client.post(f"/api/goals/{self.goal.id}/milestones/", {
            "title": "Week 1", "occurred_on": "2026-09-07", "readings": [{"metric": sessions["id"], "value": 4}]
        }, format="json").data
        self.client.delete(f"/api/milestones/{m['id']}/")
        self.assertEqual(self.progress(sessions)["current"], 4)
        goal = self.client.get(f"/api/goals/{self.goal.id}/").data
        self.assertEqual([(x["name"], x["progress"]["current"]) for x in goal["metrics"]], [("Study", 4)])

    def test_other_users_metrics_are_invisible(self):
        other = User.objects.create_user("bob")
        theirs = Goal.objects.create(user=other, title="Theirs")
        metric = Metric.objects.create(user=other, goal=theirs, name="X", kind="count", unit="x", mode="total")
        reading = Measurement.objects.create(user=other, metric=metric, value=1, recorded_on=dt.date(2026, 1, 1))
        self.assertEqual(self.client.get(f"/api/metrics/{metric.id}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/metrics/{metric.id}/measurements/", {"value": 1, "recorded_on": "2026-01-01"},
                                          format="json").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/measurements/{reading.id}/", {"value": 2}, format="json").status_code, 404)
        self.assertEqual(self.client.post(f"/api/goals/{theirs.id}/metrics/", {"name": "x", "kind": "count", "unit": "x",
                                                                              "mode": "total"}, format="json").status_code, 404)

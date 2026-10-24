import datetime as dt
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User

from .models import Entry, Event, MediaAsset


@override_settings(MEDIA_PROCESSING_ENABLED=False, INTERNAL_API_TOKEN="secret-token")
@mock.patch("journal.storage.media_url", lambda key: f"https://media.test/{key}" if key else None)
class JournalApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice", email="alice@example.com")
        self.other = User.objects.create_user("bob")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_entry(self, **overrides):
        data = {
            "title": "Trip",
            "body": "Went hiking",
            "occurred_at": "2026-09-14T05:30:00Z",
            "timezone": "America/Denver",
            "tags": ["Hiking", "Colorado"],
            **overrides,
        }
        resp = self.client.post("/api/entries/", data, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def test_occurred_on_uses_local_timezone(self):
        entry = self.create_entry()
        # 05:30 UTC is 23:30 the previous day in Denver.
        self.assertEqual(entry["occurred_on"], "2026-09-13")
        self.assertEqual(sorted(entry["tags"]), ["Colorado", "Hiking"])

    def test_entries_are_scoped_to_owner(self):
        Entry.objects.create(user=self.other, occurred_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC))
        self.create_entry()
        resp = self.client.get("/api/entries/")
        self.assertEqual(len(resp.data["results"]), 1)

    def test_filter_by_tag_and_date(self):
        self.create_entry()
        self.create_entry(tags=["work"], occurred_at="2026-09-20T12:00:00Z")
        self.assertEqual(len(self.client.get("/api/entries/?tag=hiking").data["results"]), 1)
        self.assertEqual(len(self.client.get("/api/entries/?date=2026-09-20").data["results"]), 1)

    def test_window_pages_both_directions(self):
        ids = [self.create_entry(occurred_at=f"2026-0{m}-15T12:00:00Z", tags=[])["id"] for m in range(1, 8)]

        newest = self.client.get("/api/entries/window/?limit=3").data
        self.assertEqual([e["id"] for e in newest["results"]], ids[4:])  # oldest -> newest
        self.assertTrue(newest["has_more"])

        first = newest["results"][0]
        older = self.client.get(
            "/api/entries/window/", {"limit": 3, "before": first["occurred_at"], "before_id": first["id"]}
        ).data
        self.assertEqual([e["id"] for e in older["results"]], ids[1:4])

        newer = self.client.get("/api/entries/window/", {"limit": 10, "after": "2026-03-01T00:00:00Z"}).data
        self.assertEqual([e["id"] for e in newer["results"]], ids[2:])
        self.assertFalse(newer["has_more"])

    def test_window_breaks_timestamp_ties_by_id(self):
        same = "2026-05-01T12:00:00Z"
        ids = sorted(self.create_entry(occurred_at=same, tags=[])["id"] for _ in range(3))
        page = self.client.get("/api/entries/window/", {"after": same, "after_id": ids[0]}).data
        self.assertEqual([e["id"] for e in page["results"]], ids[1:])

    def test_window_rejects_bad_timestamp(self):
        self.assertEqual(self.client.get("/api/entries/window/?before=yesterday").status_code, 400)

    def test_summary(self):
        self.create_entry(occurred_at="2026-01-10T12:00:00Z")
        self.create_entry(occurred_at="2026-01-20T12:00:00Z", tags=["work"])
        self.create_entry(occurred_at="2026-03-05T12:00:00Z")
        data = self.client.get("/api/entries/summary/").data
        self.assertEqual(data["months"], [{"month": "2026-01", "count": 2}, {"month": "2026-03", "count": 1}])
        self.assertEqual(data["first"].isoformat(), "2026-01-10T12:00:00+00:00")
        self.assertEqual(self.client.get("/api/entries/summary/?tag=work").data["months"], [{"month": "2026-01", "count": 1}])

    def test_calendar_counts(self):
        self.create_entry()
        self.create_entry(occurred_at="2026-09-13T18:00:00Z")
        resp = self.client.get("/api/calendar/?month=2026-09")
        self.assertEqual(resp.data["days"], [
            {"date": "2026-09-13", "entry_count": 2, "media_count": 0, "cover_thumb": None},
        ])

    @mock.patch("journal.storage.presigned_upload", return_value={"url": "https://s3.test", "fields": {}})
    @mock.patch("journal.storage.object_size", return_value=1234)
    def test_upload_flow(self, _size, _presign):
        entry = self.create_entry()
        resp = self.client.post(
            f"/api/entries/{entry['id']}/media/",
            {"filename": "a.jpg", "content_type": "image/jpeg", "size": 1000},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        asset_id = resp.data["asset"]["id"]
        self.assertEqual(resp.data["asset"]["status"], "pending")

        resp = self.client.post(f"/api/media/{asset_id}/complete/")
        self.assertEqual(resp.data["status"], "ready")
        self.assertTrue(resp.data["urls"]["thumb"].endswith(".jpg"))  # falls back to original

    @mock.patch("journal.storage.presigned_upload", return_value={"url": "https://s3.test", "fields": {}})
    @mock.patch("journal.storage.object_size", return_value=10)
    def test_media_tags(self, _size, _presign):
        entry = self.create_entry(tags=["trip"])
        other = self.create_entry(tags=[], occurred_at="2026-09-20T12:00:00Z")

        # Tags can be set at upload time...
        resp = self.client.post(
            f"/api/entries/{entry['id']}/media/",
            {"filename": "a.jpg", "content_type": "image/jpeg", "size": 10, "tags": ["Grandma"]},
            format="json",
        )
        self.assertEqual(resp.data["asset"]["tags"], ["Grandma"])
        photo = resp.data["asset"]["id"]
        self.client.post(f"/api/media/{photo}/complete/")

        # ...and edited afterwards.
        resp = self.client.post(
            f"/api/entries/{other['id']}/media/", {"filename": "b.jpg", "content_type": "image/jpeg", "size": 10},
            format="json",
        )
        video_ish = resp.data["asset"]["id"]
        self.client.post(f"/api/media/{video_ish}/complete/")
        resp = self.client.patch(f"/api/media/{video_ish}/", {"tags": ["grandma", "Lake"]}, format="json")
        self.assertEqual(sorted(resp.data["tags"]), ["Grandma", "Lake"])  # existing tag reused by slug

        # Photos list filters by media tag, newest event first.
        listed = self.client.get("/api/media/?tag=grandma").data["results"]
        self.assertEqual([m["id"] for m in listed], [video_ish, photo])
        self.assertEqual(listed[0]["entry_occurred_at"], "2026-09-20T12:00:00Z")

        # The timeline finds entries through their photos' tags.
        found = {e["id"] for e in self.client.get("/api/entries/?tag=grandma").data["results"]}
        self.assertEqual(found, {entry["id"], other["id"]})

        counts = {t["name"]: (t["entry_count"], t["media_count"]) for t in self.client.get("/api/tags/").data}
        self.assertEqual(counts["Grandma"], (2, 2))
        self.assertEqual(counts["Lake"], (1, 1))
        self.assertEqual(counts["trip"], (1, 0))

    def test_media_list_hides_pending_and_other_users(self):
        entry = Entry.objects.create(user=self.other, occurred_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC))
        MediaAsset.objects.create(user=self.other, entry=entry, kind="image", content_type="image/jpeg",
                                  size_bytes=1, s3_key="x", status="ready")
        mine = Entry.objects.create(user=self.user, occurred_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC))
        MediaAsset.objects.create(user=self.user, entry=mine, kind="image", content_type="image/jpeg",
                                  size_bytes=1, s3_key="y", status="pending")
        self.assertEqual(self.client.get("/api/media/").data["results"], [])

    def test_upload_rejects_bad_type(self):
        entry = self.create_entry()
        resp = self.client.post(
            f"/api/entries/{entry['id']}/media/",
            {"filename": "a.exe", "content_type": "application/x-msdownload", "size": 10},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_processed_callback_requires_token(self):
        entry = Entry.objects.create(user=self.user, occurred_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC))
        asset = MediaAsset.objects.create(
            user=self.user, entry=entry, kind="image", content_type="image/jpeg", size_bytes=1, s3_key="k"
        )
        url = f"/api/internal/media/{asset.id}/processed/"
        anon = APIClient()
        self.assertEqual(anon.post(url, {"status": "ready"}, format="json").status_code, 403)

        resp = anon.post(
            url,
            {"status": "ready", "width": 10, "height": 20, "variants": {"thumb": "media/derived/t.webp"}},
            format="json",
            headers={"X-Internal-Token": "secret-token"},
        )
        self.assertEqual(resp.status_code, 204)
        asset.refresh_from_db()
        self.assertEqual((asset.status, asset.width, asset.variants["thumb"]), ("ready", 10, "media/derived/t.webp"))


class HealthCheckTests(TestCase):
    def test_health_ignores_allowed_hosts(self):
        resp = self.client.get("/api/health/", HTTP_HOST="10.0.1.23")
        self.assertEqual(resp.status_code, 200)


@override_settings(MEDIA_PROCESSING_ENABLED=False)
@mock.patch("journal.storage.media_url", lambda key: f"https://media.test/{key}" if key else None)
@mock.patch("journal.storage.delete_objects")
class EventApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice")
        self.other = User.objects.create_user("bob")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_event(self, **overrides):
        data = {"title": "Hawaii", "starts_on": "2026-07-03", "ends_on": "2026-07-12",
                "timezone": "Pacific/Honolulu", "tags": ["travel"], **overrides}
        resp = self.client.post("/api/events/", data, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def create_entry(self, day, event=None, **extra):
        resp = self.client.post("/api/entries/", {
            "title": f"Day {day}", "occurred_at": f"{day}T20:00:00Z", "timezone": "UTC", "event": event, **extra,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def add_photo(self, entry_id, status="ready"):
        entry = Entry.objects.get(pk=entry_id)
        return MediaAsset.objects.create(user=self.user, entry=entry, kind="image", content_type="image/jpeg",
                                         size_bytes=1, s3_key=f"media/originals/{entry_id}-{entry.media.count()}.jpg",
                                         status=status)

    def test_create_and_validate(self, _delete):
        event = self.create_event()
        self.assertEqual((event["entry_count"], event["media_count"], event["tags"]), (0, 0, ["travel"]))
        resp = self.client.post("/api/events/", {"title": "Bad", "starts_on": "2026-07-10", "ends_on": "2026-07-01"},
                                format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("ends_on", resp.data)
        # PATCH validates against the stored start date too.
        resp = self.client.patch(f"/api/events/{event['id']}/", {"ends_on": "2026-06-01"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_ongoing_event_and_overlap_filter(self, _delete):
        self.create_event(title="Summer", starts_on="2026-06-01", ends_on="2026-06-30")
        self.create_event(title="Sabbatical", starts_on="2026-08-15", ends_on=None)  # still going
        def titles(q):
            return sorted(e["title"] for e in self.client.get(f"/api/events/?{q}").data)
        self.assertEqual(titles("start=2026-06-20&end=2026-06-25"), ["Summer"])
        self.assertEqual(titles("start=2027-01-01&end=2027-01-31"), ["Sabbatical"])
        self.assertEqual(titles("start=2026-07-01&end=2026-08-01"), [])

    def test_entries_attach_and_list_in_order(self, _delete):
        event = self.create_event()
        day3 = self.create_entry("2026-07-05", event["id"])
        day1 = self.create_entry("2026-07-03", event["id"])
        self.create_entry("2026-07-04")  # same week, not part of the event
        self.add_photo(day1["id"])
        self.assertEqual(day3["event_summary"]["title"], "Hawaii")

        listed = self.client.get(f"/api/events/{event['id']}/entries/").data
        self.assertEqual([e["id"] for e in listed], [day1["id"], day3["id"]])
        detail = self.client.get(f"/api/events/{event['id']}/").data
        self.assertEqual((detail["entry_count"], detail["media_count"]), (2, 1))
        self.assertEqual(len(self.client.get(f"/api/entries/?event={event['id']}").data["results"]), 2)

        # Detach by clearing the event.
        resp = self.client.patch(f"/api/entries/{day3['id']}/", {"event": None}, format="json")
        self.assertIsNone(resp.data["event_summary"])

    def test_cannot_attach_to_someone_elses_event(self, _delete):
        theirs = Event.objects.create(user=self.other, title="Not yours", starts_on=dt.date(2026, 1, 1))
        resp = self.client.post("/api/entries/", {"occurred_at": "2026-01-01T12:00:00Z", "timezone": "UTC",
                                                  "event": str(theirs.id)}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.client.get(f"/api/events/{theirs.id}/").status_code, 404)

    def test_cover_defaults_to_first_photo_and_can_be_chosen(self, _delete):
        event = self.create_event()
        later = self.create_entry("2026-07-06", event["id"])
        first = self.create_entry("2026-07-03", event["id"])
        later_photo = self.add_photo(later["id"])
        first_photo = self.add_photo(first["id"])
        listed = self.client.get("/api/events/").data[0]
        self.assertIn(str(first_photo.s3_key), listed["cover_urls"]["thumb"])

        resp = self.client.patch(f"/api/events/{event['id']}/", {"cover": str(later_photo.id)}, format="json")
        self.assertIn(later_photo.s3_key, resp.data["cover_urls"]["thumb"])

    def test_delete_keeps_entries_by_default(self, delete_objects):
        event = self.create_event()
        entry = self.create_entry("2026-07-04", event["id"])
        self.assertEqual(self.client.delete(f"/api/events/{event['id']}/").status_code, 204)
        self.assertIsNone(Entry.objects.get(pk=entry["id"]).event)
        delete_objects.assert_not_called()

    def test_delete_with_entries(self, delete_objects):
        event = self.create_event()
        entry = self.create_entry("2026-07-04", event["id"])
        photo = self.add_photo(entry["id"])
        keep = self.create_entry("2026-07-04")
        resp = self.client.delete(f"/api/events/{event['id']}/?with_entries=true")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Entry.objects.filter(pk=entry["id"]).exists())
        self.assertTrue(Entry.objects.filter(pk=keep["id"]).exists())
        delete_objects.assert_called_once_with([photo.s3_key])

    def test_event_tags_match_entries_in_timeline(self, _delete):
        event = self.create_event(tags=["Hawaii 2026"])
        entry = self.create_entry("2026-07-04", event["id"])
        self.create_entry("2026-07-04")
        found = [e["id"] for e in self.client.get("/api/entries/?tag=hawaii-2026").data["results"]]
        self.assertEqual(found, [entry["id"]])
        counts = {t["name"]: t["entry_count"] for t in self.client.get("/api/tags/").data}
        self.assertEqual(counts["Hawaii 2026"], 1)

    def test_calendar_includes_overlapping_events(self, _delete):
        self.create_event(title="Spans months", starts_on="2026-06-28", ends_on="2026-07-03")
        self.create_event(title="Later", starts_on="2026-08-01", ends_on="2026-08-02")
        july = self.client.get("/api/calendar/?month=2026-07").data
        self.assertEqual([(e["title"], e["starts_on"], e["ends_on"]) for e in july["events"]],
                         [("Spans months", "2026-06-28", "2026-07-03")])


@mock.patch("journal.storage.presigned_upload", return_value={"url": "https://s3.test", "fields": {}})
@mock.patch("journal.storage.media_url", lambda key: f"https://media.test/{key}" if key else None)
class EventUploadTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.event = Event.objects.create(user=self.user, title="Hawaii", timezone="Pacific/Honolulu",
                                          starts_on=dt.date(2026, 7, 3), ends_on=dt.date(2026, 7, 12))

    def upload(self, captured_at=None, event=None, **extra):
        body = {"filename": "p.jpg", "content_type": "image/jpeg", "size": 100, **extra}
        if captured_at is not None:
            body["captured_at"] = captured_at
        return self.client.post(f"/api/events/{(event or self.event).id}/media/", body, format="json")

    def test_exif_wall_clock_time_keeps_its_date(self, _presign):
        # Naive EXIF time: local where the photo was taken, whatever the event's zone.
        resp = self.upload("2026-07-05T23:30:00")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["placement"] | {"entry": None},
                         {"entry": None, "date": "2026-07-05", "day": 3, "outside": False, "created_entry": True})
        entry = Entry.objects.get(pk=resp.data["placement"]["entry"])
        self.assertEqual((entry.event_id, entry.occurred_on, entry.title), (self.event.id, dt.date(2026, 7, 5), ""))

    def test_instant_is_converted_to_event_timezone(self, _presign):
        # 05:00 UTC on Jul 6 is still the evening of Jul 5 in Honolulu.
        resp = self.upload("2026-07-06T05:00:00Z")
        self.assertEqual(resp.data["placement"]["date"], "2026-07-05")

    def test_same_day_reuses_entry_and_tags_apply(self, _presign):
        first = self.upload("2026-07-04T09:00:00", tags=["beach"]).data
        second = self.upload("2026-07-04T17:00:00").data
        self.assertEqual(first["placement"]["entry"], second["placement"]["entry"])
        self.assertFalse(second["placement"]["created_entry"])
        self.assertEqual(first["asset"]["tags"], ["beach"])
        self.assertEqual(Entry.objects.filter(event=self.event).count(), 1)
        self.assertEqual(MediaAsset.objects.get(pk=second["asset"]["id"]).position, 1)

    def test_existing_day_entry_is_used(self, _presign):
        existing = Entry.objects.create(user=self.user, event=self.event, title="Snorkeling", timezone="Pacific/Honolulu",
                                        occurred_at=dt.datetime(2026, 7, 6, 22, 0, tzinfo=dt.UTC))  # Jul 6 local
        resp = self.upload("2026-07-06T08:00:00")
        self.assertEqual(resp.data["placement"]["entry"], str(existing.id))

    def test_outside_dates_clamp_to_nearest_day(self, _presign):
        before = self.upload("2026-06-30T10:00:00").data["placement"]
        after = self.upload("2026-07-20T10:00:00").data["placement"]
        self.assertEqual((before["date"], before["day"], before["outside"]), ("2026-07-03", 1, True))
        self.assertEqual((after["date"], after["day"], after["outside"]), ("2026-07-12", 10, True))

    def test_ongoing_event_has_no_end_clamp(self, _presign):
        ongoing = Event.objects.create(user=self.user, title="Sabbatical", timezone="UTC", starts_on=dt.date(2026, 1, 1))
        placement = self.upload("2026-09-01T10:00:00", event=ongoing).data["placement"]
        self.assertEqual((placement["date"], placement["outside"]), ("2026-09-01", False))

    def test_rejects_bad_input_and_other_users_events(self, _presign):
        self.assertEqual(self.upload("not a date").status_code, 400)
        self.assertEqual(self.upload("2026-07-05T10:00:00", content_type="application/pdf").status_code, 400)
        other = User.objects.create_user("bob")
        theirs = Event.objects.create(user=other, title="Theirs", starts_on=dt.date(2026, 1, 1))
        self.assertEqual(self.upload("2026-01-01T10:00:00", event=theirs).status_code, 404)
        self.assertEqual(Entry.objects.count(), 0)


@mock.patch("journal.storage.media_url", lambda key: f"https://media.test/{key}" if key else None)
class MoveMediaTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        at = dt.datetime(2026, 7, 5, 18, 0, tzinfo=dt.UTC)
        self.auto = Entry.objects.create(user=self.user, occurred_at=at)  # untitled upload container
        self.written = Entry.objects.create(user=self.user, occurred_at=at, title="Hvar day trip")

    def photo(self, entry, n):
        return MediaAsset.objects.create(user=self.user, entry=entry, kind="image", content_type="image/jpeg",
                                         size_bytes=1, s3_key=f"k-{entry.pk}-{n}", status="ready", position=n)

    def move(self, asset, entry):
        return self.client.patch(f"/api/media/{asset.id}/", {"entry": str(entry.id)}, format="json")

    def test_move_appends_and_removes_emptied_auto_entry(self):
        a, b = self.photo(self.auto, 0), self.photo(self.auto, 1)
        self.photo(self.written, 0)
        self.assertEqual(self.move(a, self.written).data["entry"], self.written.id)
        self.assertTrue(Entry.objects.filter(pk=self.auto.pk).exists())  # still holds b
        self.move(b, self.written)
        self.assertFalse(Entry.objects.filter(pk=self.auto.pk).exists())
        self.assertEqual(list(self.written.media.order_by("position").values_list("position", flat=True)), [0, 1, 2])

    def test_written_entry_is_kept_when_emptied(self):
        a = self.photo(self.written, 0)
        self.move(a, self.auto)
        self.assertTrue(Entry.objects.filter(pk=self.written.pk).exists())

    def test_cannot_move_to_someone_elses_entry(self):
        a = self.photo(self.auto, 0)
        other = User.objects.create_user("bob")
        theirs = Entry.objects.create(user=other, occurred_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC))
        self.assertEqual(self.move(a, theirs).status_code, 400)
        a.refresh_from_db()
        self.assertEqual(a.entry_id, self.auto.id)


class EventOrderingTests(TestCase):
    def test_events_list_newest_start_first(self):
        # Regression: the list annotates counts, and Django drops Meta.ordering on aggregate queries.
        user = User.objects.create_user("alice")
        client = APIClient()
        client.force_authenticate(user)
        for title, start in [("Middle", "2026-05-01"), ("Newest", "2026-09-01"), ("Oldest", "2026-01-01")]:
            client.post("/api/events/", {"title": title, "starts_on": start}, format="json")
        self.assertEqual([e["title"] for e in client.get("/api/events/").data], ["Newest", "Middle", "Oldest"])

import datetime as dt
from io import StringIO

from django.core.management import CommandError, call_command
from django.test import TestCase

from journal.models import Entry

from .models import User

SUB = "9b1c4f1e-0000-4000-8000-000000000001"


def link(*args):
    out = StringIO()
    call_command("link_cognito_user", *args, stdout=out)
    return out.getvalue()


class LinkCognitoUserTests(TestCase):
    def setUp(self):
        self.local = User.objects.create_user("dev")

    def test_links_the_account(self):
        link("dev", SUB)
        self.local.refresh_from_db()
        self.assertEqual(self.local.cognito_sub, SUB)

    def test_replaces_an_empty_account_from_an_earlier_sign_in(self):
        User.objects.create_user(SUB, cognito_sub=SUB)  # what the callback creates on first sign-in
        self.assertIn("Removed the empty account", link("dev", SUB))
        self.assertEqual(User.objects.get(cognito_sub=SUB), self.local)

    def test_never_removes_an_account_with_data(self):
        other = User.objects.create_user(SUB, cognito_sub=SUB)
        Entry.objects.create(user=other, occurred_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC))
        with self.assertRaisesMessage(CommandError, "which has data"):
            link("dev", SUB)
        self.assertTrue(User.objects.filter(pk=other.pk).exists())

    def test_unknown_account(self):
        with self.assertRaisesMessage(CommandError, "No account named 'nobody'"):
            link("nobody", SUB)

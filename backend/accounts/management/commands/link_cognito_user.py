from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


def owns_anything(user):
    """True if any row anywhere points at this user (entries, workouts, goals, media, …)."""
    for rel in user._meta.related_objects:
        if rel.one_to_many and rel.related_model.objects.filter(**{rel.field.name: user}).exists():
            return True
    return False


class Command(BaseCommand):
    help = (
        "Link an existing account to a Cognito user, so signing in with Cognito opens that account. "
        "Used when moving local data (signed in with AUTH_MODE=local) to AWS."
    )

    def add_arguments(self, parser):
        parser.add_argument("username", help="The existing account, e.g. the local superuser.")
        parser.add_argument("sub", help="The Cognito user's 'sub' attribute.")

    @transaction.atomic
    def handle(self, username, sub, **options):
        User = get_user_model()
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise CommandError(f"No account named {username!r}.") from None

        other = User.objects.filter(cognito_sub=sub).exclude(pk=user.pk).first()
        if other:
            # Signing in before linking creates an empty account for the sub. That one can go;
            # an account with data can't, because removing it would delete the data.
            if owns_anything(other):
                raise CommandError(f"Cognito user {sub} is already linked to {other.username!r}, which has data.")
            other.delete()
            self.stdout.write(f"Removed the empty account {other.username!r} created by an earlier sign-in.")

        user.cognito_sub = sub
        user.save(update_fields=["cognito_sub"])
        self.stdout.write(self.style.SUCCESS(f"Signing in as Cognito user {sub} now opens {username!r}."))

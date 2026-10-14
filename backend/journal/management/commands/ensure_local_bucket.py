from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from journal import storage


class Command(BaseCommand):
    help = "Create the media bucket in the local S3 emulator (dev only)."

    def handle(self, *args, **options):
        if not settings.AWS_S3_ENDPOINT_URL:
            raise CommandError("Refusing to run without AWS_S3_ENDPOINT_URL; real buckets are managed by Terraform.")
        client = storage.s3()
        existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
        if settings.MEDIA_BUCKET not in existing:
            client.create_bucket(Bucket=settings.MEDIA_BUCKET)
            self.stdout.write(f"Created bucket {settings.MEDIA_BUCKET}")

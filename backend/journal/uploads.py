"""Issuing uploads and deleting media, for any owner (entry, goal, or milestone)."""

from . import storage
from .models import MediaAsset, Tag


def issue_upload(user, data, *, entry=None, goal=None, milestone=None):
    """Create a pending asset and a presigned POST for the browser to upload it."""
    from .serializers import MediaAssetSerializer  # avoid an import cycle at module load

    asset = MediaAsset(
        user=user,
        entry=entry,
        goal=goal,
        milestone=milestone,
        kind=storage.kind_for(data["content_type"]),
        content_type=data["content_type"],
        original_filename=data["filename"],
        size_bytes=data["size"],
        position=entry.media.count() if entry else 0,
    )
    asset.s3_key = storage.original_key(user.id, asset.id, data["content_type"])
    asset.save()
    if data.get("tags"):
        asset.tags.set(Tag.resolve(user, data["tags"]))
    return {
        "asset": MediaAssetSerializer(asset).data,
        "upload": storage.presigned_upload(asset.s3_key, data["content_type"]),
    }


def storage_keys(assets):
    """Every S3 object behind these assets: originals plus derived thumbnails."""
    return [key for asset in assets for key in [asset.s3_key, *asset.variants.values()]]


def delete_media(assets):
    """Delete assets and their S3 objects."""
    assets = list(assets)
    keys = storage_keys(assets)
    MediaAsset.objects.filter(pk__in=[a.pk for a in assets]).delete()
    storage.delete_objects(keys)

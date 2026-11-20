"""Issuing uploads and deleting media, for any owner (entry, goal, milestone, workout set, ...)."""

from rest_framework import status
from rest_framework.response import Response

from . import storage
from .models import MEDIA_OWNER_FIELDS, MediaAsset, Tag


def issue_upload(user, data, **owner):
    """
    Create a pending asset and a presigned POST for the browser to upload it.
    `owner` is exactly one of MEDIA_OWNER_FIELDS, e.g. entry=..., goal=..., workout_set=...
    """
    from .serializers import MediaAssetSerializer  # avoid an import cycle at module load

    if len(owner) != 1 or not set(owner) <= set(MEDIA_OWNER_FIELDS):
        raise ValueError(f"Pass exactly one owner from {MEDIA_OWNER_FIELDS}, got {sorted(owner)}")
    entry = owner.get("entry")
    asset = MediaAsset(
        user=user,
        **owner,
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


def replace_single_media(request, owner_field, owner, existing, kinds=("image", "video")):
    """
    For owners that hold one photo/video (a goal, a milestone, a workout set):
    POST swaps in a new file and returns an upload ticket; DELETE removes it.
    """
    from .serializers import UploadRequestSerializer

    if request.method == "DELETE":
        delete_media(existing)
        return Response(status=status.HTTP_204_NO_CONTENT)
    upload = UploadRequestSerializer(data=request.data)
    upload.is_valid(raise_exception=True)
    if storage.kind_for(upload.validated_data["content_type"]) not in kinds:
        error = {"content_type": [f"Only {' or '.join(kinds)} files here."]}
        return Response(error, status=status.HTTP_400_BAD_REQUEST)
    delete_media(existing)
    ticket = issue_upload(request.user, upload.validated_data, **{owner_field: owner})
    return Response(ticket, status=status.HTTP_201_CREATED)

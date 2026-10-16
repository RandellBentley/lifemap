"""
S3 access for media. Django never proxies file bytes: it hands out presigned
upload forms and signed read URLs.

Key layout (all under media/ so a single CloudFront /media/* behavior serves them):
    media/originals/{user_id}/{asset_id}.{ext}
    media/derived/{user_id}/{asset_id}/thumb.webp | display.webp | poster.jpg
"""

import datetime as dt
import math
import time
from functools import lru_cache
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.signers import CloudFrontSigner
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from django.conf import settings

# Content types we accept, and the extension used for the stored object.
ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
}


def kind_for(content_type: str) -> str:
    return "video" if content_type.startswith("video/") else "image"


def max_bytes_for(content_type: str) -> int:
    return settings.MEDIA_MAX_VIDEO_BYTES if kind_for(content_type) == "video" else settings.MEDIA_MAX_IMAGE_BYTES


def original_key(user_id, asset_id, content_type: str) -> str:
    return f"media/originals/{user_id}/{asset_id}.{ALLOWED_TYPES[content_type]}"


def _client(endpoint_url):
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        endpoint_url=endpoint_url,
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual" if not endpoint_url else "path"}),
    )


@lru_cache(maxsize=1)
def s3():
    """Client for server-side calls (HEAD, DELETE)."""
    return _client(settings.AWS_S3_ENDPOINT_URL)


@lru_cache(maxsize=1)
def s3_public():
    """Client for presigning; URLs must use a host the browser can reach."""
    return _client(settings.AWS_S3_PUBLIC_ENDPOINT_URL)


def presigned_upload(key: str, content_type: str) -> dict:
    """A POST form locked to this key, content type, and max size."""
    return s3_public().generate_presigned_post(
        Bucket=settings.MEDIA_BUCKET,
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, max_bytes_for(content_type)],
        ],
        ExpiresIn=settings.MEDIA_UPLOAD_EXPIRES,
    )


def object_size(key: str) -> int | None:
    try:
        return s3().head_object(Bucket=settings.MEDIA_BUCKET, Key=key)["ContentLength"]
    except s3().exceptions.ClientError:
        return None


def delete_objects(keys: list[str]) -> None:
    keys = [k for k in keys if k]
    if keys:
        s3().delete_objects(Bucket=settings.MEDIA_BUCKET, Delete={"Objects": [{"Key": k} for k in keys]})


# --- Read URLs -----------------------------------------------------------------


@lru_cache(maxsize=1)
def _cloudfront_signer() -> CloudFrontSigner:
    private_key = serialization.load_pem_private_key(settings.CLOUDFRONT_PRIVATE_KEY.encode(), password=None)

    def rsa_signer(message: bytes) -> bytes:
        return private_key.sign(message, padding.PKCS1v15(), hashes.SHA1())  # CloudFront requires SHA-1

    return CloudFrontSigner(settings.CLOUDFRONT_KEY_PAIR_ID, rsa_signer)


def _stable_expiry() -> dt.datetime:
    # Round expiry up to the next TTL boundary so the same object gets the same
    # signed URL for a while; that keeps browser and CloudFront caches effective.
    ttl = settings.MEDIA_URL_TTL
    expires = math.ceil((time.time() + ttl) / ttl) * ttl
    return dt.datetime.fromtimestamp(expires, tz=dt.UTC)


def media_url(key: str | None) -> str | None:
    if not key:
        return None
    if settings.CLOUDFRONT_KEY_PAIR_ID:
        url = f"{settings.CLOUDFRONT_MEDIA_BASE_URL}/{quote(key)}"
        return _cloudfront_signer().generate_presigned_url(url, date_less_than=_stable_expiry())
    return s3_public().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.MEDIA_BUCKET, "Key": key},
        ExpiresIn=settings.MEDIA_URL_TTL,
    )

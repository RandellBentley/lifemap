"""
S3 ObjectCreated -> generate derived media -> report back to the Django API.

Triggered for keys under media/originals/{user_id}/{asset_id}.{ext}.

Images: auto-rotate, write thumb (400px) and display (1600px) WebP copies with
all metadata stripped (EXIF can contain GPS), and read the capture time.

Videos: marked ready with no derivatives for now; the frontend plays the
original. Next step is a MediaConvert job (HLS + poster) whose completion event
calls back the same way.
"""

import datetime as dt
import io
import json
import logging
import os
import urllib.request
from pathlib import PurePosixPath
from urllib.parse import unquote_plus

import boto3
from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()  # iPhone HEIC photos
except ImportError:
    pass

log = logging.getLogger()
log.setLevel(logging.INFO)

s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")

API_BASE_URL = os.environ["API_BASE_URL"].rstrip("/")
APP_SECRET_ARN = os.environ["APP_SECRET_ARN"]

SIZES = {"thumb": 400, "display": 1600}
EXIF_DATETIME_ORIGINAL = 0x9003
EXIF_IFD = 0x8769

_token = None


def internal_token():
    global _token
    if _token is None:
        secret = json.loads(secrets.get_secret_value(SecretId=APP_SECRET_ARN)["SecretString"])
        _token = secret["internal_api_token"]
    return _token


def handler(event, _context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        path = PurePosixPath(key)
        user_id, asset_id = path.parent.name, path.stem
        try:
            head = s3.head_object(Bucket=bucket, Key=key)
            if head["ContentType"].startswith("image/"):
                result = process_image(bucket, key, user_id, asset_id)
            else:
                result = {"status": "ready"}
        except Exception:
            log.exception("Processing failed for %s", key)
            result = {"status": "failed"}
        report(asset_id, result)


def process_image(bucket, key, user_id, asset_id):
    body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    with Image.open(io.BytesIO(body)) as img:
        taken_at = exif_datetime(img)
        img = ImageOps.exif_transpose(img)
        width, height = img.size
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        variants = {}
        for name, max_side in SIZES.items():
            copy = img.copy()
            copy.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            copy.save(out, "WEBP", quality=82, method=4)  # no exif= -> metadata stripped
            derived_key = f"media/derived/{user_id}/{asset_id}/{name}.webp"
            s3.put_object(
                Bucket=bucket,
                Key=derived_key,
                Body=out.getvalue(),
                ContentType="image/webp",
                CacheControl="private, max-age=31536000, immutable",
            )
            variants[name] = derived_key

    return {
        "status": "ready",
        "width": width,
        "height": height,
        "taken_at": taken_at,
        "variants": variants,
    }


def exif_datetime(img):
    try:
        raw = img.getexif().get_ifd(EXIF_IFD).get(EXIF_DATETIME_ORIGINAL)
        # EXIF has no zone; treat as naive local time and let the API store it as UTC.
        return dt.datetime.strptime(raw, "%Y:%m:%d %H:%M:%S").isoformat() if raw else None
    except Exception:
        return None


def report(asset_id, payload):
    req = urllib.request.Request(
        f"{API_BASE_URL}/api/internal/media/{asset_id}/processed/",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "X-Internal-Token": internal_token()},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        log.info("Reported %s -> %s (%s)", asset_id, payload["status"], resp.status)

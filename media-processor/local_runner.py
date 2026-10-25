"""
Local stand-in for S3 -> Lambda event notifications (used by scripts/local-prod.sh).

Polls the emulator bucket for new originals and invokes the real handler with a
synthetic S3 event, so handler.py runs unchanged.
"""

import json
import os
import time

import boto3

BUCKET = os.environ["MEDIA_BUCKET"]
s3 = boto3.client("s3")


def ensure_secret():
    # The handler reads its callback token from Secrets Manager, emulated by Moto locally.
    sm = boto3.client("secretsmanager")
    try:
        sm.create_secret(
            Name=os.environ["APP_SECRET_ARN"],
            SecretString=json.dumps({"internal_api_token": os.environ["INTERNAL_API_TOKEN"]}),
        )
    except sm.exceptions.ResourceExistsException:
        pass


# Marker objects recording what's been processed, so a restart doesn't redo everything
# (S3 notifications fire once per upload in AWS; polling has to remember on its own).
DONE_PREFIX = "local-processor/done/"


def list_keys(prefix):
    """(key, last_modified) pairs under prefix; empty until the bucket exists."""
    try:
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
            yield from ((obj["Key"], obj["LastModified"]) for obj in page.get("Contents", []))
    except s3.exceptions.NoSuchBucket:
        return  # created by the deploy script shortly after startup


def main():
    ensure_secret()
    import handler  # after the secret exists; creates its own clients at import

    done = {key.removeprefix(DONE_PREFIX) for key, _ in list_keys(DONE_PREFIX)}
    print(f"Watching s3://{BUCKET}/media/originals/ ({len(done)} already processed)", flush=True)
    while True:
        # Newest first, so fresh uploads aren't stuck behind a backlog.
        pending = sorted(
            ((key, modified) for key, modified in list_keys("media/originals/") if key not in done),
            key=lambda item: item[1],
            reverse=True,
        )
        for key, _ in pending:
            event = {"Records": [{"s3": {"bucket": {"name": BUCKET}, "object": {"key": key}}}]}
            try:
                handler.handler(event, None)
            except Exception as exc:  # e.g. API not up yet; retry next poll
                print(f"Will retry {key}: {exc}", flush=True)
                continue
            s3.put_object(Bucket=BUCKET, Key=DONE_PREFIX + key, Body=b"")
            done.add(key)
            print(f"Processed {key}", flush=True)
        time.sleep(2)


if __name__ == "__main__":
    main()

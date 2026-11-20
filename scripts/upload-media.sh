#!/usr/bin/env bash
# Copy the photos and videos from a local backup (scripts/local-prod.sh backup) into the
# real S3 media bucket. File names are the same locally and in AWS, so the database needs no
# changes. See docs/runbooks/migrate-local-to-aws.md for the whole move.
#
#   scripts/upload-media.sh <backup-dir> <bucket> --dryrun   # list what would be copied
#   scripts/upload-media.sh <backup-dir> <bucket>
#
# Uses your normal aws CLI login (AWS_PROFILE etc.), like scripts/deploy.sh. Safe to re-run:
# only new or changed files are copied, and nothing in the bucket is deleted.
set -euo pipefail

dir="${1:?usage: upload-media.sh <backup-dir> <bucket> [--dryrun]}"
bucket="${2:?usage: upload-media.sh <backup-dir> <bucket> [--dryrun]}"
shift 2

# The backup mirrors the local bucket: media/ holds the app's files, and local-processor/ holds
# the local media processor's bookkeeping, which AWS doesn't need. Copying only media/ skips it.
src="$dir/media/media"
[[ -d "$src" ]] || { echo "No media found in $dir (expected $src)." >&2; exit 1; }

# Content types are set explicitly rather than guessed from the extension, so browsers get
# exactly what the app's own uploads record. Keep in sync with ALLOWED_TYPES in
# backend/journal/storage.py (plus webp, which the thumbnails use).
TYPES=(jpg:image/jpeg png:image/png webp:image/webp gif:image/gif heic:image/heic heif:image/heif
       mp4:video/mp4 mov:video/quicktime webm:video/webm)

count="$(find "$src" -type f | wc -l | tr -d ' ')"
unknown="$(find "$src" -type f | grep -cvE "\.($(printf '%s|' "${TYPES[@]%%:*}" | sed 's/|$//'))$" || true)"
[[ "$unknown" == 0 ]] || { echo "$unknown files have an unexpected extension; nothing was copied." >&2; exit 1; }

echo "==> Copying $count files to s3://$bucket/media/"
# In AWS each original also triggers the thumbnail Lambda, which regenerates the thumbnails
# copied here; that's harmless and costs under a cent per thousand photos.
for t in "${TYPES[@]}"; do
  aws s3 sync "$src" "s3://$bucket/media" --exclude '*' --include "*.${t%%:*}" --content-type "${t#*:}" \
    --only-show-errors "$@"
done
echo "Done."

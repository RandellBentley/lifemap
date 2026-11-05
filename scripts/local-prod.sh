#!/usr/bin/env bash
# Run the production single-host stack locally: same compose file, Caddy origin,
# gunicorn with DEBUG=0, plus stand-ins for CloudFront, S3, and the Lambda.
#
#   scripts/local-prod.sh up          # build + start, then open http://localhost:8780
#   scripts/local-prod.sh superuser   # create a login (AUTH_MODE=local)
#   scripts/local-prod.sh logs [svc]
#   scripts/local-prod.sh down        # stop (data kept in infra/local/.data)
#   scripts/local-prod.sh reset       # stop and delete local data
#   scripts/local-prod.sh backup <dir>          # copy the database and media to <dir>
#   scripts/local-prod.sh restore <dir> [dump]  # replace local data with a backup
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/infra/local"

compose() {
  docker compose -p lifemap-local \
    -f "$ROOT/infra/host/docker-compose.yml" \
    -f "$LOCAL/docker-compose.override.yml" \
    --env-file "$LOCAL/local.env" "$@"
}

up() {
  mkdir -p "$LOCAL/.secrets" "$LOCAL/.data"
  # Throwaway key so the mount exists; local media URLs are S3-presigned, not CloudFront-signed.
  [[ -f "$LOCAL/.secrets/cloudfront_key.pem" ]] || openssl genrsa -out "$LOCAL/.secrets/cloudfront_key.pem" 2048 2>/dev/null

  echo "==> Building frontend"
  (cd "$ROOT/frontend" && { [[ -d node_modules ]] || npm ci; } && npm run build)

  echo "==> Building images"
  compose build web media-processor
  # Caddy (with the Route 53 plugin) only changes with infra/host/caddy.Dockerfile, and
  # compiling it downloads Go modules; reuse the image once it exists.
  if ! docker image inspect lifemap-caddy >/dev/null 2>&1; then
    echo "==> Compiling Caddy (first run only; a few minutes)"
    compose build caddy
  fi

  # Same order as infra/host/deploy.sh: database, migrations, then everything else.
  echo "==> Migrating"
  compose up -d --wait db s3
  compose run --rm --no-deps web python manage.py migrate --noinput
  compose run --rm --no-deps web python manage.py ensure_local_bucket

  echo "==> Starting"
  compose up -d --remove-orphans
  compose ps
  cat <<MSG

LifeMap (production-like) is running at http://localhost:8780
Create a login with: scripts/local-prod.sh superuser
MSG
}

# The AWS CLI talks to the emulator over the S3 API because SeaweedFS doesn't keep objects
# as plain files. The same media/ folder can later be synced to the real bucket.
s3_sync() {
  local backup_dir="$1" src="$2" dest="$3"
  docker run --rm --network lifemap-local_default -v "$backup_dir:/backup" \
    -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local -e AWS_DEFAULT_REGION=us-east-1 \
    amazon/aws-cli:2.27.0 s3 sync "$src" "$dest" --endpoint-url http://s3:8333 --only-show-errors
}

media_bucket() {
  sed -n 's/^MEDIA_BUCKET=//p' "$LOCAL/local.env"
}

backup_dir_arg() {
  local dir="${1:?usage: local-prod.sh backup|restore <dir>}"
  mkdir -p "$dir"
  dir="$(cd "$dir" && pwd -P)"
  # This repo is public; personal data must never be somewhere it could be committed.
  case "$dir/" in
    "$(cd "$ROOT" && pwd -P)"/*) echo "Choose a backup folder outside the repository." >&2; exit 1 ;;
  esac
  echo "$dir"
}

backup() {
  local dir stamp dump
  dir="$(backup_dir_arg "${1:-}")"
  stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
  dump="$dir/db/lifemap-$stamp.dump"
  mkdir -p "$dir/db" "$dir/media"

  # Database first: every file it references then exists by the time media is copied.
  echo "==> Backing up the database"
  compose exec -T db pg_dump -U lifemap -Fc lifemap > "$dump.partial"
  compose exec -T db pg_restore --list < "$dump.partial" > /dev/null
  mv "$dump.partial" "$dump"

  # Media files are immutable, so this only copies what's new. Nothing is removed from the
  # backup, so older database dumps can still find their files.
  echo "==> Backing up media"
  s3_sync "$dir" "s3://$(media_bucket)" /backup/media

  ls -1t "$dir"/db/*.dump | tail -n +31 | while read -r old; do rm -- "$old"; done
  echo "Backed up to $dir: $(du -h "$dump" | cut -f1) database, $(find "$dir/media" -type f | wc -l | tr -d ' ') media files"
}

restore() {
  local dir dump answer
  dir="$(backup_dir_arg "${1:-}")"
  dump="${2:-$(ls -1t "$dir"/db/*.dump 2>/dev/null | head -n 1 || true)}"
  [[ -f "$dump" ]] || { echo "No database dump found in $dir/db" >&2; exit 1; }

  echo "This replaces the local database with $(basename "$dump") and copies back media from $dir."
  read -r -p "Type 'restore' to continue: " answer
  [[ "$answer" == "restore" ]] || { echo "Cancelled."; exit 1; }

  compose up -d --wait db s3
  compose stop web media-processor
  echo "==> Restoring the database"
  compose exec -T db pg_restore -U lifemap -d lifemap --clean --if-exists --no-owner \
    --single-transaction --exit-on-error < "$dump"
  echo "==> Restoring media"
  compose run --rm --no-deps web python manage.py ensure_local_bucket
  s3_sync "$dir" /backup/media "s3://$(media_bucket)"
  compose run --rm --no-deps web python manage.py migrate --noinput # the dump may be older than the code
  compose up -d
  echo "Restored. LifeMap is running at http://localhost:8780"
}

case "${1:-up}" in
  up) up ;;
  superuser) compose exec web python manage.py createsuperuser ;;
  logs) shift; compose logs -f "$@" ;;
  down) compose down ;;
  reset) compose down -v && rm -rf "$LOCAL/.data" ;;
  backup) shift; backup "$@" ;;
  restore) shift; restore "$@" ;;
  *) echo "usage: local-prod.sh [up|superuser|logs|down|reset|backup|restore]"; exit 1 ;;
esac

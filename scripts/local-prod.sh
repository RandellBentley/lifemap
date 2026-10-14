#!/usr/bin/env bash
# Run the production single-host stack locally: same compose file, Caddy origin,
# gunicorn with DEBUG=0, plus stand-ins for CloudFront, S3, and the Lambda.
#
#   scripts/local-prod.sh up          # build + start, then open http://localhost:8780
#   scripts/local-prod.sh superuser   # create a login (AUTH_MODE=local)
#   scripts/local-prod.sh logs [svc]
#   scripts/local-prod.sh down        # stop (data kept in infra/local/.data)
#   scripts/local-prod.sh reset       # stop and delete local data
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

case "${1:-up}" in
  up) up ;;
  superuser) compose exec web python manage.py createsuperuser ;;
  logs) shift; compose logs -f "$@" ;;
  down) compose down ;;
  reset) compose down -v && rm -rf "$LOCAL/.data" ;;
  *) echo "usage: local-prod.sh [up|superuser|logs|down|reset]"; exit 1 ;;
esac

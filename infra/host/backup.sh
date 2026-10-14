#!/usr/bin/env bash
# Nightly logical backup of Postgres to S3 (complements daily EBS snapshots).
set -euo pipefail
cd /opt/lifemap
set -a; source app.env; set +a

key="db-backups/lifemap-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U lifemap -Fc lifemap | aws s3 cp - "s3://$OPS_BUCKET/$key" --only-show-errors
echo "Backed up to s3://$OPS_BUCKET/$key"

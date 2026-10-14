#!/usr/bin/env bash
# Runs on the host as root, invoked by /usr/local/bin/lifemap-deploy <image-tag>.
set -euo pipefail
cd /opt/lifemap
TAG="${1:?usage: deploy.sh <image-tag>}"

set -a; source app.env; set +a

echo "==> Writing .env from Secrets Manager"
umask 077
aws secretsmanager get-secret-value --secret-id "$APP_SECRET_ARN" --query SecretString --output text \
  | python3 -c '
import json, sys
s = json.load(sys.stdin)
keys = {
    "DJANGO_SECRET_KEY": "django_secret_key",
    "INTERNAL_API_TOKEN": "internal_api_token",
    "DATABASE_PASSWORD": "database_password",
    "COGNITO_CLIENT_SECRET": "cognito_client_secret",
    "ORIGIN_VERIFY_SECRET": "origin_verify_secret",
}
with open("secrets.env", "w") as f:
    f.write("".join(f"{k}={s[v]}\n" for k, v in keys.items()))
with open("cloudfront_key.pem", "w") as f:
    f.write(s["cloudfront_private_key"])
'
{ cat app.env secrets.env; echo "APP_IMAGE=$ECR_REPOSITORY_URL:$TAG"; } > .env
rm secrets.env
chown 1000:1000 cloudfront_key.pem # the app container runs as uid 1000
chmod 400 cloudfront_key.pem

echo "==> Pulling $ECR_REPOSITORY_URL:$TAG"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "${ECR_REPOSITORY_URL%%/*}"
docker compose pull web
docker compose build caddy

echo "==> Migrating"
docker compose up -d --wait db
docker compose run --rm --no-deps web python manage.py migrate --noinput

echo "==> Starting"
docker compose up -d --remove-orphans --wait
docker image prune -f >/dev/null

echo "==> Installing backup timer"
install -m 644 lifemap-backup.service lifemap-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lifemap-backup.timer

docker compose ps
echo "==> Deployed $TAG"

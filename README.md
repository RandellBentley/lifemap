# LifeMap

[![CI](https://github.com/RandellBentley/lifemap/actions/workflows/ci.yml/badge.svg)](https://github.com/RandellBentley/lifemap/actions/workflows/ci.yml)
[![CodeQL](https://github.com/RandellBentley/lifemap/actions/workflows/codeql.yml/badge.svg)](https://github.com/RandellBentley/lifemap/actions/workflows/codeql.yml)

A private journal for documenting events: entries with text, photos, and videos, organized by tags and browsable as a timeline or calendar.

```
frontend/         React + Vite + TypeScript SPA
backend/          Django + DRF API (session auth, presigned S3 uploads)
media-processor/  Lambda: thumbnails, EXIF capture time, metadata stripping
infra/            Terraform (AWS)
scripts/          deploy.sh
```

## Architecture

```
                 CloudFront (app domain)
   /*       -> S3 frontend bucket (SPA)
   /api/*   -> ALB -> ECS Fargate (Django)  -> RDS Postgres
   /media/* -> S3 media bucket (CloudFront signed URLs only)

Browser --presigned POST--> S3 media bucket --ObjectCreated--> Lambda --callback--> /api/internal/...
Login: Django <-> Cognito (OIDC code + PKCE); browser gets an HttpOnly Django session cookie
```

Key decisions:

- **Same origin for SPA and API.** CloudFront routes `/api/*` to the ALB, so there's no CORS and auth is a first-party HttpOnly cookie. The SPA never handles tokens.
- **Uploads bypass Django.** The API issues a presigned POST that is locked to one key, content type, and size limit. The browser uploads directly to S3.
- **Media is never public.** Read URLs are CloudFront signed URLs. Their expiry is rounded to the hour so the same image keeps the same URL and stays cacheable.
- **The ALB only accepts CloudFront.** Its security group allows only CloudFront's IP prefix list, and the listener requires a secret header that CloudFront adds.
- **Time zones.** Each entry stores `occurred_at` (UTC) plus its IANA time zone. `occurred_on` is the local date, which the calendar groups by, so an 11pm entry doesn't land on the next day.

## Local development

Requirements: Docker, Node 22+, Python 3.11+.

```bash
docker compose up -d          # Postgres, S3 emulator (SeaweedFS) on :9000, Django on :8000
docker compose exec backend python manage.py createsuperuser

cd frontend && npm install && npm run dev    # http://localhost:5173
```

Locally `AUTH_MODE=local`: **Sign in** goes to the Django admin login, using the superuser you created. Thumbnails aren't generated locally, so the UI shows originals.

Backend tests:

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
DJANGO_DEBUG=1 .venv/bin/python manage.py test
```

## Continuous integration

Every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Each job runs only when its area changed, and branch protection requires the single **CI passed** check, so a skipped job never blocks a merge.

| Job | Checks |
|---|---|
| Backend | ruff lint, migrations in sync with models, Django tests against Postgres 17, coverage ≥ 85% (summary posted to the run) |
| Backend image | Docker build, Trivy scan; fails on fixable HIGH/CRITICAL vulnerabilities |
| Frontend | clean `npm ci`, TypeScript typecheck, production build |
| Infrastructure | `terraform fmt`, `validate` for every root, Trivy config scan of Terraform and the host Dockerfile |
| Secret scan | gitleaks over the full git history |

[CodeQL](.github/workflows/codeql.yml) analyzes the Python and TypeScript for security issues on every PR and weekly. Dependabot proposes grouped weekly updates for Actions, pip, npm, Terraform, and Docker base images. Third-party actions are pinned to commit SHAs.

**Security-scan exceptions** are inline `#trivy:ignore` comments next to the resource, each with its reason (e.g. the ALB is internet-facing but only reachable from CloudFront with a secret header).

Run the same checks locally:

```bash
pip install -r backend/requirements-dev.txt
ruff check backend media-processor
(cd backend && DJANGO_DEBUG=1 coverage run manage.py test && coverage report)
(cd frontend && npm ci && npm run build)
terraform -chdir=infra fmt -check -recursive
```

## Feature flags

Some features are personal-site only (workout tracking first). Rather than separate codebases, environments differ only in the `FEATURES` setting, set per environment in Terraform (`features = ["workouts"]` for personal, empty for the demo):

- **Backend:** flagged views use `permission_classes = [requires_feature("workouts"), IsAuthenticated]` and answer **404** when the flag is off.
- **Frontend:** `GET /api/config/` lists enabled features; `useFeature()` / `<FeatureGate>` hide the UI.
- Unknown names fail at startup. See [ADR 0002](docs/adr/0002-feature-flags.md).

Design decisions are recorded in [`docs/adr/`](docs/adr/).

## Local production-like stack

`docker compose up` is the fast dev loop: hot reload, `DEBUG=1`, and the Vite dev server. To test what will actually run in the cloud, use:

```bash
scripts/local-prod.sh up          # http://localhost:8780
scripts/local-prod.sh superuser   # create a login
scripts/local-prod.sh logs web    # follow logs (any service)
scripts/local-prod.sh down        # stop; data is kept in infra/local/.data
scripts/local-prod.sh reset       # stop and delete local data
```

This runs **the same `infra/host/docker-compose.yml` that runs on EC2**: the Caddy origin with the secret-header check, gunicorn, `DEBUG=0`, Postgres, and the same migrate-then-start order. `infra/local/` adds local stand-ins for the AWS services around the host:

| AWS | Local stand-in |
|---|---|
| CloudFront | `edge` (Caddy on :8780): serves the built SPA, sends `/api/*` to the origin with the secret header |
| S3 | SeaweedFS on :9100, stored on disk in `infra/local/.data/s3` |
| Secrets Manager | Moto (in-memory; the processor recreates its secret on start) |
| S3 → Lambda trigger | `media-processor` polls the bucket and runs the real `handler.py` |
| Cognito | `AUTH_MODE=local` (admin login), or a real Cognito pool, see below |
| Let's Encrypt | Caddy's self-signed certificate (`CADDY_TLS=tls_internal`) |

Local differences from AWS:

- **Media URLs.** They are S3-presigned instead of CloudFront-signed.
- **Plain HTTP.** The edge serves `http://localhost`. Chrome and Firefox send the app's `Secure` cookies to localhost; Safari doesn't, so test in Chrome or Firefox.
- **Not emulated at all:** CloudFront itself, its geo-restriction, and IAM. Use `terraform plan` to check those.

**Real login.** Cognito is free at this scale, so you can test the real login flow locally:

1. Add `http://localhost:8780/api/auth/callback/` to the app client's callback URLs.
2. Add `http://localhost:8780/` to its sign-out URLs.
3. In `infra/local/local.env`, set `AUTH_MODE=cognito` and the `COGNITO_*` values.

## Environments

| Env | Shape | ~Cost/month |
|---|---|---|
| `personal` | CloudFront + one EC2 (Caddy, Django, Postgres) + S3 + Cognito | ~$20 |
| `dev` / `prod` | CloudFront + ALB + ECS Fargate + RDS + NAT, multi-AZ | ~$85–90 |

Both share the storage, auth, cdn, and media_processing modules and use identical app code.

## Personal (single-host) setup

```
CloudFront (your domain)
  /*        -> S3 frontend bucket
  /api/*    -> EC2 t4g.small: Caddy (TLS + secret-header check) -> Django -> Postgres
  /media/*  -> S3 media bucket (signed URLs)
```

How the instance is locked down:

- **Firewall:** the security group allows only HTTPS from CloudFront's IP prefix list.
- **Secret header:** Caddy returns 403 to any request without CloudFront's secret `X-Origin-Verify` header.
- **No SSH:** shell access goes through SSM Session Manager:
  ```bash
  aws ssm start-session --target <instance-id>
  ```
- **TLS between CloudFront and the instance:** Caddy gets a Let's Encrypt certificate through a Route 53 DNS challenge, which works even though no port is open to Let's Encrypt.
- **Updates and recovery:** security updates apply automatically (dnf-automatic), and EC2 auto-recovery restarts the instance if the underlying hardware fails.

Data protection:

- Postgres lives on its own EBS volume, mounted at `/data`. Terraform sets `prevent_destroy` on that volume, and replacing the instance doesn't touch it.
- That volume gets daily EBS snapshots, kept for 7 days.
- `pg_dump` runs nightly to `s3://<ops-bucket>/db-backups/`, kept for 35 days.
- The media bucket is versioned, and its originals move automatically to cheaper Intelligent-Tiering storage.

Deploy:

```bash
cd infra/envs/personal
cp backend.hcl.example backend.hcl && cp terraform.tfvars.example terraform.tfvars   # fill in
terraform init -backend-config=backend.hcl
cd ../../.. && scripts/deploy.sh personal
aws cognito-idp admin-create-user --user-pool-id <id> --username you@example.com
```

The script runs `terraform apply`, then pushes the image to ECR, then syncs `infra/host/` to S3, then runs `lifemap-deploy <tag>` on the instance over SSM. On the instance, that pulls the config, writes `.env` from Secrets Manager, runs migrations, and restarts the containers. The first deploy also builds Caddy, which takes a few minutes. Edit the files in `infra/host/` to change the server's setup; they ship with every deploy.

Restore the database from a dump:

```bash
aws ssm start-session --target <instance-id>
cd /opt/lifemap
aws s3 cp s3://<ops-bucket>/db-backups/<file>.dump /tmp/db.dump
docker compose exec -T db pg_restore -U lifemap -d lifemap --clean --if-exists < /tmp/db.dump
```

Rebuild the server, keeping the data volume:

```bash
terraform apply -replace=module.host.aws_instance.host
```

If termination protection blocks it, set `termination_protection = false` first.

## Deploying to AWS (dev / prod)

Prerequisites:

- Terraform **>= 1.10**, for native S3 state locking.
- AWS CLI, authenticated.
- A Route 53 public hosted zone for your domain.

1. **State bucket** (once per account):
   ```bash
   cd infra/bootstrap && terraform init && terraform apply -var state_bucket_name=<unique-name>
   ```
2. **Configure the environment:**
   ```bash
   cd infra/envs/dev
   cp backend.hcl.example backend.hcl            # set the state bucket
   cp terraform.tfvars.example terraform.tfvars  # set domain, zone, Cognito prefix
   terraform init -backend-config=backend.hcl
   ```
3. **Deploy:**
   ```bash
   scripts/deploy.sh dev
   ```
   This builds and pushes the arm64 image, builds the Lambda, runs `terraform apply`, runs migrations as a one-off ECS task, then builds the SPA, uploads it to S3, and invalidates CloudFront.
4. **Add users.** The user pool is invite-only by default:
   ```bash
   aws cognito-idp admin-create-user --user-pool-id <id> --username you@example.com
   ```

Notes:

- Migrations run after the new service version rolls out. Keep schema changes backward compatible: add first, remove in a later deploy.
- `image_tag` is required on every `terraform apply`. `deploy.sh` sets it for you.
- Rough dev cost: about $75/month, mostly NAT gateway (~$32), ALB (~$18), RDS micro (~$15), and Fargate (~$12).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/me/` | Current user (401 if signed out); sets the CSRF cookie |
| GET | `/api/auth/login/?next=` | Start login (redirect) |
| POST | `/api/auth/logout/` | Returns `redirect_url` (Cognito logout) |
| GET/POST | `/api/entries/` | Timeline, cursor-paginated. Filters: `tag`, `q`, `date`, `start`, `end` |
| GET/PATCH/DELETE | `/api/entries/{id}/` | Entry detail |
| POST | `/api/entries/{id}/media/` | Request a presigned upload `{filename, content_type, size}` |
| POST | `/api/media/{id}/complete/` | Confirm an upload landed in S3 |
| PATCH/DELETE | `/api/media/{id}/` | Tag or remove media |
| GET | `/api/tags/` | Tags with entry counts |
| GET | `/api/calendar/?month=YYYY-MM` | Per-day counts and cover thumbnails |

## Not done yet

- **Video transcoding.** Videos play from the original file. `.mov`/HEVC won't play in Chrome on all platforms. Next step: Elemental MediaConvert to produce HLS and a poster frame, reporting back through the same callback.
- **Multipart uploads.** Presigned POST handles files up to 5 GB, but a large video on a flaky connection would benefit from resumable multipart upload.
- **Full-text search.** `q` uses `icontains`. Switch to Postgres `SearchVector` with a GIN index as data grows.
- **CI.** Add GitHub Actions with AWS OIDC: tests and `terraform plan` on PRs, `deploy.sh` on merge.

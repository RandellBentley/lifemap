# Move local data to AWS

Moves everything from the local stack (`scripts/local-prod.sh`) to the `personal` environment on AWS: the database, every photo and video, and your login.

**Why it's a copy rather than a conversion.**
- Local storage (SeaweedFS) speaks the S3 API, and files are stored under the same names as in AWS (`media/originals/…`, `media/derived/…`).
- The database stores those names, never addresses.
- So the database dump and the media files go across unchanged. The only thing that changes is how you sign in.

Nothing local is changed or deleted, so you can repeat any step, or stop and keep using the local stack.

## Before you start

- The `personal` environment is deployed and you've created your Cognito user (see [Personal setup](../../README.md#personal-single-host-setup)).
- **AWS runs the same code version as your local stack.** Deploy the commit you run locally, so the dump matches the database schema.
- **Pick a moment when you're not adding entries locally.** Anything added after step 1 stays local.

## 1. Back up into a new, empty folder

```bash
scripts/local-prod.sh backup ~/LifeMapBackups/move-to-aws
```

Use a new folder rather than your regular backup folder. Regular backups keep files you deleted in the app, and those shouldn't be uploaded.

## 2. Look up the AWS names

```bash
terraform -chdir=infra/envs/personal output -json stack
```

The steps below use `media_bucket`, `ops_bucket`, `instance_id`, `cognito_user_pool_id` and `app_url` from this output.

## 3. Upload photos and videos

```bash
scripts/upload-media.sh ~/LifeMapBackups/move-to-aws <media_bucket> --dryrun   # check the list
scripts/upload-media.sh ~/LifeMapBackups/move-to-aws <media_bucket>
```

- **Safe to re-run:** it only copies new files and never deletes anything in the bucket.
- **Thumbnails get made again:** each original also triggers the thumbnail Lambda, which recreates the thumbnails that were just copied. That's harmless.

## 4. Restore the database on the server

Upload the newest dump:

```bash
aws s3 cp ~/LifeMapBackups/move-to-aws/db/<newest>.dump s3://<ops_bucket>/db-backups/local-import.dump
```

Then, on the server, replace its database with the dump:

```bash
aws ssm start-session --target <instance_id>
cd /opt/lifemap
aws s3 cp s3://<ops_bucket>/db-backups/local-import.dump /tmp/db.dump
docker compose exec -T db pg_restore -U lifemap -d lifemap --clean --if-exists --no-owner < /tmp/db.dump
docker compose exec web python manage.py migrate
rm /tmp/db.dump
```

## 5. Link your login

Locally you signed in with a Django account (by default `dev`). On AWS you sign in with Cognito, which only finds that account once it's linked. Without this step, your first sign-in creates a new, empty account.

Get your Cognito user's ID (its `sub`), on your machine:

```bash
aws cognito-idp admin-get-user --user-pool-id <cognito_user_pool_id> --username you@example.com \
  --query "UserAttributes[?Name=='sub'].Value" --output text
```

Then link it, on the server:

```bash
docker compose exec web python manage.py link_cognito_user dev <sub>
```

If you signed in on AWS before linking, that sign-in created an empty account. The command removes it, but only if it has no data.

## 6. Check

1. Sign in at `app_url` and open the timeline, calendar, goals and workouts.
2. Open a few photos and a video. Photos uploaded in step 3 can show "Processing…" for a minute while the Lambda remakes their thumbnails.
3. Keep `~/LifeMapBackups/move-to-aws` until you're happy. After that, the server's nightly backups take over.

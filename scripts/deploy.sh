#!/usr/bin/env bash
# Deploy to an environment.
#   scripts/deploy.sh dev            # backend + frontend
#   scripts/deploy.sh dev backend    # image -> ECR, terraform apply, migrate
#   scripts/deploy.sh dev frontend   # build SPA -> S3, invalidate CloudFront
#   scripts/deploy.sh personal       # single-host env: terraform apply, image -> ECR, deploy via SSM
# Requires: aws CLI (authenticated), docker, terraform >= 1.10, node.
set -euo pipefail

ENV="${1:?usage: deploy.sh <env> [backend|frontend|all]}"
WHAT="${2:-all}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$ROOT/infra/envs/$ENV"

out() {
  terraform -chdir="$TF_DIR" output -json stack | python3 -c "import sys, json; print(json.load(sys.stdin)['$1'])"
}

new_tag() {
  echo "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)-$(date +%Y%m%d%H%M%S)"
}

# Single-host environments (infra/modules/single_host) deploy over SSM instead of ECS.
is_single_host() {
  grep -q 'modules/single_host' "$TF_DIR/main.tf"
}

deploy_host_backend() {
  local tag repo instance
  tag="$(new_tag)"

  echo "==> Building media processor"
  "$ROOT/media-processor/build.sh"

  echo "==> Applying infrastructure"
  terraform -chdir="$TF_DIR" apply

  repo="$(out ecr_repository_url)"
  echo "==> Building and pushing $repo:$tag"
  aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}"
  docker build --platform linux/arm64 -t "$repo:$tag" "$ROOT/backend"
  docker push "$repo:$tag"

  echo "==> Uploading host config"
  aws s3 sync "$ROOT/infra/host/" "s3://$(out ops_bucket)/host/" --delete --only-show-errors

  instance="$(out instance_id)"
  echo "==> Waiting for $instance to register with SSM"
  for _ in $(seq 1 60); do
    [[ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$instance" \
      --query 'length(InstanceInformationList)' --output text)" == "1" ]] && break
    sleep 10
  done

  echo "==> Deploying on host (first run builds Caddy; allow a few minutes)"
  local cmd_id status
  cmd_id="$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --timeout-seconds 1800 --parameters "commands=[\"/usr/local/bin/lifemap-deploy $tag\"]" \
    --query Command.CommandId --output text)"
  while :; do
    status="$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance" \
      --query Status --output text 2>/dev/null || echo Pending)"
    [[ "$status" =~ ^(Pending|InProgress|Delayed)$ ]] || break
    sleep 10
  done
  aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance" \
    --query '[StandardOutputContent, StandardErrorContent]' --output text | tail -40
  [[ "$status" == "Success" ]] || { echo "Host deploy failed ($status)"; exit 1; }
}

deploy_backend() {
  local tag repo
  tag="$(new_tag)"

  # First deploy: the ECR repo must exist before there is an image to run.
  if ! repo="$(out ecr_repository_url 2>/dev/null)"; then
    echo "==> Creating ECR repository (first deploy)"
    terraform -chdir="$TF_DIR" apply -var "image_tag=bootstrap" \
      -target=module.stack.module.backend.aws_ecr_repository.app
    repo="$(terraform -chdir="$TF_DIR" state show -no-color module.stack.module.backend.aws_ecr_repository.app \
      | awk -F'"' '/repository_url/ {print $2}')"
  fi

  echo "==> Building and pushing $repo:$tag"
  aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}"
  docker build --platform linux/arm64 -t "$repo:$tag" "$ROOT/backend"
  docker push "$repo:$tag"

  echo "==> Building media processor"
  "$ROOT/media-processor/build.sh"

  echo "==> Applying infrastructure"
  terraform -chdir="$TF_DIR" apply -var "image_tag=$tag"

  echo "==> Running migrations"
  local task_arn exit_code
  task_arn="$(aws ecs run-task \
    --cluster "$(out ecs_cluster)" \
    --task-definition "$(out ecs_task_family)" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$(out ecs_subnets)],securityGroups=[$(out ecs_security_group)],assignPublicIp=DISABLED}" \
    --overrides '{"containerOverrides":[{"name":"web","command":["python","manage.py","migrate","--noinput"]}]}' \
    --query 'tasks[0].taskArn' --output text)"
  aws ecs wait tasks-stopped --cluster "$(out ecs_cluster)" --tasks "$task_arn"
  exit_code="$(aws ecs describe-tasks --cluster "$(out ecs_cluster)" --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  [[ "$exit_code" == "0" ]] || { echo "Migration failed (exit $exit_code). Check CloudWatch logs."; exit 1; }

  echo "==> Waiting for service to stabilize"
  aws ecs wait services-stable --cluster "$(out ecs_cluster)" --services "$(out ecs_service)"
}

deploy_frontend() {
  local bucket dist
  bucket="$(out frontend_bucket)"
  dist="$(out cloudfront_distribution_id)"

  echo "==> Building frontend"
  (cd "$ROOT/frontend" && npm ci && npm run build)

  echo "==> Uploading to s3://$bucket"
  # Hashed assets are immutable; index.html must always be revalidated.
  aws s3 sync "$ROOT/frontend/dist" "s3://$bucket" --delete --exclude index.html \
    --cache-control "public, max-age=31536000, immutable"
  aws s3 cp "$ROOT/frontend/dist/index.html" "s3://$bucket/index.html" --cache-control "no-cache"
  aws cloudfront create-invalidation --distribution-id "$dist" --paths "/index.html" >/dev/null
}

backend_target=deploy_backend
is_single_host && backend_target=deploy_host_backend

case "$WHAT" in
  backend) $backend_target ;;
  frontend) deploy_frontend ;;
  all) $backend_target && deploy_frontend ;;
  *) echo "unknown target: $WHAT"; exit 1 ;;
esac

echo "==> Done: $(out app_url)"

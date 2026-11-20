# One EC2 instance running Caddy + Django + Postgres (Docker Compose), reachable
# only from CloudFront. Replaces the ALB + Fargate + RDS + NAT of the multi-AZ stack.
#
#   - Security group: 443 from CloudFront's origin-facing prefix list only; no SSH (use SSM).
#   - Caddy terminates TLS (Let's Encrypt via Route 53 DNS challenge) and rejects requests
#     without CloudFront's secret X-Origin-Verify header.
#   - Postgres lives on a separate EBS volume that survives instance replacement,
#     snapshotted daily by DLM and dumped nightly to S3.
#   - Host config (compose file, Caddyfile, scripts) lives in infra/host/ and is pushed
#     to the ops bucket on each deploy, so it changes without rebuilding the instance.

variable "name" { type = string }
variable "hosted_zone_id" { type = string }
variable "app_domain" { type = string }
variable "origin_domain" { type = string }
variable "acme_email" {
  description = "Contact email for Let's Encrypt expiry notices."
  type        = string
}
variable "instance_type" {
  description = "Must be ARM (Graviton): t4g.micro (1 GB) or t4g.small (2 GB)."
  type        = string
  default     = "t4g.small"
}
variable "root_volume_gb" {
  type    = number
  default = 20
}
variable "data_volume_gb" {
  description = "Postgres data. Media lives in S3, so this stays small."
  type        = number
  default     = 10
}
variable "snapshot_retention_count" {
  type    = number
  default = 7
}
variable "db_dump_retention_days" {
  type    = number
  default = 35
}
variable "features" {
  description = "Feature flags to switch on (FEATURES env var), e.g. [\"workouts\"]. Empty = none."
  type        = list(string)
  default     = []
}
variable "termination_protection" {
  type    = bool
  default = true
}

variable "origin_verify_secret" {
  type      = string
  sensitive = true
}
variable "media_bucket_id" { type = string }
variable "media_bucket_arn" { type = string }
variable "cloudfront_key_pair_id" { type = string }
variable "cloudfront_private_key_pem" {
  type      = string
  sensitive = true
}
variable "cognito" {
  type = object({ user_pool_id = string, client_id = string, domain_url = string })
}
variable "cognito_client_secret" {
  type      = string
  sensitive = true
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  region  = data.aws_region.current.region
  app_url = "https://${var.app_domain}"
}

# --- Network: one public subnet, no NAT ---------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = var.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = "10.20.1.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = { Name = "${var.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Free gateway endpoint keeps S3 traffic (media, backups) on the AWS network.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${local.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "host" {
  name        = "${var.name}-host"
  description = "HTTPS from CloudFront only; no SSH (use SSM Session Manager)"
  vpc_id      = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "https_from_cloudfront" {
  security_group_id = aws_security_group.host.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.host.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Supporting resources ------------------------------------------------------------

resource "aws_ecr_repository" "app" {
  name                 = "${var.name}-backend"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# Ops bucket: host/ (config pushed by deploys), config/ (written by Terraform), db-backups/.
resource "aws_s3_bucket" "ops" {
  bucket = "${var.name}-ops-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "ops" {
  bucket                  = aws_s3_bucket.ops.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "ops" {
  bucket = aws_s3_bucket.ops.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ops" {
  bucket = aws_s3_bucket.ops.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "ops" {
  bucket = aws_s3_bucket.ops.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "ops" {
  bucket     = aws_s3_bucket.ops.id
  depends_on = [aws_s3_bucket_versioning.ops]

  rule {
    id     = "expire-db-dumps"
    status = "Enabled"
    filter { prefix = "db-backups/" }
    expiration { days = var.db_dump_retention_days }
    noncurrent_version_expiration { noncurrent_days = 7 }
  }

  rule {
    id     = "expire-old-config-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

resource "random_password" "django_secret_key" {
  length  = 64
  special = false
}

resource "random_password" "internal_api_token" {
  length  = 48
  special = false
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    django_secret_key      = random_password.django_secret_key.result
    internal_api_token     = random_password.internal_api_token.result
    database_password      = random_password.db.result
    cognito_client_secret  = var.cognito_client_secret
    origin_verify_secret   = var.origin_verify_secret
    cloudfront_private_key = var.cloudfront_private_key_pem
  })
}

# Non-secret settings. The host deploy script merges these with the secret above into .env.
locals {
  app_env = {
    DJANGO_DEBUG                = "0"
    DJANGO_ALLOWED_HOSTS        = "${var.app_domain},${var.origin_domain}"
    DJANGO_CSRF_TRUSTED_ORIGINS = local.app_url
    APP_BASE_URL                = local.app_url
    AUTH_MODE                   = "cognito"
    COGNITO_REGION              = local.region
    COGNITO_USER_POOL_ID        = var.cognito.user_pool_id
    COGNITO_CLIENT_ID           = var.cognito.client_id
    COGNITO_DOMAIN              = var.cognito.domain_url
    DATABASE_HOST               = "db"
    DATABASE_PORT               = "5432"
    DATABASE_NAME               = "lifemap"
    DATABASE_USER               = "lifemap"
    DATABASE_SSLMODE            = "disable" # same host, Docker network
    AWS_REGION                  = local.region
    MEDIA_BUCKET                = var.media_bucket_id
    CLOUDFRONT_MEDIA_BASE_URL   = local.app_url
    CLOUDFRONT_KEY_PAIR_ID      = var.cloudfront_key_pair_id
    MEDIA_PROCESSING_ENABLED    = "1"
    FEATURES                    = join(",", var.features)
    # Used by the host scripts / Caddy, ignored by Django:
    ORIGIN_DOMAIN      = var.origin_domain
    ACME_EMAIL         = var.acme_email
    ECR_REPOSITORY_URL = aws_ecr_repository.app.repository_url
    APP_SECRET_ARN     = aws_secretsmanager_secret.app.arn
    OPS_BUCKET         = aws_s3_bucket.ops.id
  }
}

resource "aws_s3_object" "app_env" {
  bucket       = aws_s3_bucket.ops.id
  key          = "config/app.env"
  content      = join("\n", concat([for k, v in local.app_env : "${k}=${v}"], [""]))
  content_type = "text/plain"
}

# --- IAM -------------------------------------------------------------------------------

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "${var.name}-host"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "host" {
  statement {
    sid       = "Media"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.media_bucket_arn}/media/*"]
  }
  statement {
    sid       = "OpsList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.ops.arn]
  }
  statement {
    sid       = "OpsRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.ops.arn}/host/*", "${aws_s3_bucket.ops.arn}/config/*"]
  }
  statement {
    sid       = "DbBackups"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.ops.arn}/db-backups/*"]
  }
  statement {
    sid       = "Secrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.app.arn]
  }
  # Caddy's Let's Encrypt DNS-01 challenge (port 80 is closed, so HTTP-01 can't work).
  statement {
    sid       = "AcmeDnsChallenge"
    actions   = ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${var.hosted_zone_id}"]
  }
  statement {
    sid       = "AcmeDnsLookup"
    actions   = ["route53:GetChange", "route53:ListHostedZones", "route53:ListHostedZonesByName"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "host" {
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host.json
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.name}-host"
  role = aws_iam_role.host.name
}

# --- Instance ----------------------------------------------------------------------------

resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public.availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.name}-data", Snapshot = var.name }

  lifecycle { prevent_destroy = true } # holds the database
}

resource "aws_instance" "host" {
  ami                     = data.aws_ssm_parameter.al2023_arm64.insecure_value
  instance_type           = var.instance_type
  subnet_id               = aws_subnet.public.id
  vpc_security_group_ids  = [aws_security_group.host.id]
  iam_instance_profile    = aws_iam_instance_profile.host.name
  disable_api_termination = var.termination_protection

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    ops_bucket    = aws_s3_bucket.ops.id
    region        = local.region
    volume_serial = replace(aws_ebs_volume.data.id, "-", "")
  })

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2          # lets containers use the instance role
  }

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  maintenance_options { auto_recovery = "default" }

  tags = { Name = var.name }

  # New AMIs or bootstrap tweaks shouldn't silently replace the server.
  # Re-create deliberately with: terraform apply -replace=module.host.aws_instance.host
  lifecycle { ignore_changes = [ami, user_data] }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.host.id
}

resource "aws_eip" "host" {
  domain   = "vpc"
  instance = aws_instance.host.id
  tags     = { Name = var.name }
}

resource "aws_route53_record" "origin" {
  zone_id = var.hosted_zone_id
  name    = var.origin_domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.host.public_ip]
}

# --- Daily snapshots of the data volume ---------------------------------------------------

data "aws_iam_policy_document" "dlm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${var.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "data" {
  description        = "${var.name} daily data volume snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshot = var.name }

    schedule {
      name      = "daily"
      copy_tags = true
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["04:00"]
      }
      retain_rule { count = var.snapshot_retention_count }
    }
  }
}

output "instance_id" { value = aws_instance.host.id }
output "public_ip" { value = aws_eip.host.public_ip }
output "ecr_repository_url" { value = aws_ecr_repository.app.repository_url }
output "ops_bucket" { value = aws_s3_bucket.ops.id }
output "app_secret_arn" { value = aws_secretsmanager_secret.app.arn }

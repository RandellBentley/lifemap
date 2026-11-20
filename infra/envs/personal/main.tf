# Single-user setup (~$20/month): CloudFront + one EC2 instance + S3 + Cognito.
# See infra/modules/single_host for how the server is locked down.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    tls     = { source = "hashicorp/tls", version = "~> 4.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.6" }
  }
  backend "s3" {
    key          = "lifemap/personal/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}
variable "domain_name" {
  description = "Public app domain, e.g. journal.example.com."
  type        = string
}
variable "hosted_zone_name" {
  description = "Existing Route 53 public hosted zone containing domain_name."
  type        = string
}
variable "cognito_domain_prefix" {
  description = "Globally unique prefix for the Cognito sign-in domain."
  type        = string
}
variable "acme_email" {
  description = "Email for Let's Encrypt certificate notices."
  type        = string
}
variable "geo_allowlist" {
  description = "Countries allowed to reach the site, e.g. [\"US\"]. Empty = anywhere."
  type        = list(string)
  default     = []
}
variable "instance_type" {
  type    = string
  default = "t4g.small"
}
variable "require_mfa" {
  type    = bool
  default = true
}

locals {
  name          = "lifemap-personal"
  app_url       = "https://${var.domain_name}"
  origin_domain = "origin.${var.domain_name}"
  tags          = { Project = "lifemap", Environment = "personal", ManagedBy = "terraform" }
}

provider "aws" {
  region = var.region
  default_tags { tags = local.tags }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = local.tags }
}

data "aws_route53_zone" "this" {
  name         = var.hosted_zone_name
  private_zone = false
}

resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

resource "tls_private_key" "media_signing" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_cloudfront_public_key" "media" {
  name        = "${local.name}-media"
  encoded_key = tls_private_key.media_signing.public_key_pem
}

resource "aws_cloudfront_key_group" "media" {
  name  = "${local.name}-media"
  items = [aws_cloudfront_public_key.media.id]
}

module "storage" {
  source               = "../../modules/storage"
  name                 = local.name
  cors_allowed_origins = [local.app_url]
  force_destroy        = false # your photos
}

module "auth" {
  source              = "../../modules/auth"
  name                = local.name
  domain_prefix       = var.cognito_domain_prefix
  callback_urls       = ["${local.app_url}/api/auth/callback/"]
  logout_urls         = ["${local.app_url}/"]
  invite_only         = true
  require_mfa         = var.require_mfa
  deletion_protection = true
}

module "host" {
  source         = "../../modules/single_host"
  name           = local.name
  hosted_zone_id = data.aws_route53_zone.this.zone_id
  app_domain     = var.domain_name
  origin_domain  = local.origin_domain
  acme_email     = var.acme_email
  instance_type  = var.instance_type
  # Personal-only features; the public demo environment leaves this empty.
  features = ["workouts"]

  origin_verify_secret       = random_password.origin_verify.result
  media_bucket_id            = module.storage.media_bucket_id
  media_bucket_arn           = module.storage.media_bucket_arn
  cloudfront_key_pair_id     = aws_cloudfront_public_key.media.id
  cloudfront_private_key_pem = tls_private_key.media_signing.private_key_pem

  cognito = {
    user_pool_id = module.auth.user_pool_id
    client_id    = module.auth.client_id
    domain_url   = module.auth.domain_url
  }
  cognito_client_secret = module.auth.client_secret
}

module "cdn" {
  source = "../../modules/cdn"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                 = local.name
  domain_name          = var.domain_name
  hosted_zone_id       = data.aws_route53_zone.this.zone_id
  api_origin_domain    = local.origin_domain
  origin_verify_secret = random_password.origin_verify.result
  media_key_group_id   = aws_cloudfront_key_group.media.id
  geo_allowlist        = var.geo_allowlist

  frontend_bucket = {
    id                   = module.storage.frontend_bucket_id
    arn                  = module.storage.frontend_bucket_arn
    regional_domain_name = module.storage.frontend_bucket_regional_domain_name
  }
  media_bucket = {
    id                   = module.storage.media_bucket_id
    arn                  = module.storage.media_bucket_arn
    regional_domain_name = module.storage.media_bucket_regional_domain_name
  }
}

module "media_processing" {
  source           = "../../modules/media_processing"
  name             = local.name
  media_bucket_id  = module.storage.media_bucket_id
  media_bucket_arn = module.storage.media_bucket_arn
  api_base_url     = local.app_url
  app_secret_arn   = module.host.app_secret_arn
  source_dir       = "${path.module}/../../../media-processor/build"
}

# Read by scripts/deploy.sh.
output "stack" {
  value = {
    app_url                    = local.app_url
    instance_id                = module.host.instance_id
    ecr_repository_url         = module.host.ecr_repository_url
    ops_bucket                 = module.host.ops_bucket
    frontend_bucket            = module.storage.frontend_bucket_id
    media_bucket               = module.storage.media_bucket_id
    cloudfront_distribution_id = module.cdn.distribution_id
    cognito_user_pool_id       = module.auth.user_pool_id
  }
}

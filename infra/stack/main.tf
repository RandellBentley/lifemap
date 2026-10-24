# Everything for one environment. envs/<env>/ call this with environment-specific settings.

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
    random  = { source = "hashicorp/random" }
    tls     = { source = "hashicorp/tls" }
    archive = { source = "hashicorp/archive" }
  }
}

variable "name" {
  description = "Resource name prefix, e.g. lifemap-dev."
  type        = string
}
variable "domain_name" {
  description = "Public app domain, e.g. dev.lifemap.example.com."
  type        = string
}
variable "hosted_zone_name" {
  description = "Existing Route 53 public hosted zone that contains domain_name."
  type        = string
}
variable "cognito_domain_prefix" { type = string }
variable "image_tag" { type = string }
variable "extra_cors_origins" {
  description = "Additional origins allowed to upload media (e.g. http://localhost:5173 in dev)."
  type        = list(string)
  default     = []
}
variable "production" {
  description = "Turns on deletion protection, Multi-AZ DB, per-AZ NAT."
  type        = bool
  default     = false
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "features" {
  description = "Feature flags to switch on (FEATURES env var), e.g. [\"workouts\"]. Empty = none."
  type        = list(string)
  default     = []
}
variable "desired_count" {
  type    = number
  default = 1
}

data "aws_route53_zone" "this" {
  name         = var.hosted_zone_name
  private_zone = false
}

locals {
  app_url       = "https://${var.domain_name}"
  origin_domain = "origin.${var.domain_name}"
}

# Shared between CloudFront (adds the header) and the ALB (requires it).
resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

resource "random_password" "db" {
  length  = 32
  special = false
}

# Key pair for CloudFront signed media URLs. The private key goes to Django via
# Secrets Manager; the public key is registered with CloudFront.
resource "tls_private_key" "media_signing" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_cloudfront_public_key" "media" {
  name        = "${var.name}-media"
  encoded_key = tls_private_key.media_signing.public_key_pem
}

resource "aws_cloudfront_key_group" "media" {
  name  = "${var.name}-media"
  items = [aws_cloudfront_public_key.media.id]
}

module "network" {
  source             = "../modules/network"
  name               = var.name
  single_nat_gateway = !var.production
}

module "storage" {
  source               = "../modules/storage"
  name                 = var.name
  cors_allowed_origins = concat([local.app_url], var.extra_cors_origins)
  force_destroy        = !var.production
}

module "database" {
  source              = "../modules/database"
  name                = var.name
  vpc_id              = module.network.vpc_id
  subnet_ids          = module.network.private_subnet_ids
  password            = random_password.db.result
  instance_class      = var.db_instance_class
  multi_az            = var.production
  deletion_protection = var.production
}

module "auth" {
  source              = "../modules/auth"
  name                = var.name
  domain_prefix       = var.cognito_domain_prefix
  callback_urls       = ["${local.app_url}/api/auth/callback/"]
  logout_urls         = ["${local.app_url}/"]
  deletion_protection = var.production
}

module "backend" {
  source               = "../modules/backend"
  name                 = var.name
  vpc_id               = module.network.vpc_id
  public_subnet_ids    = module.network.public_subnet_ids
  private_subnet_ids   = module.network.private_subnet_ids
  hosted_zone_id       = data.aws_route53_zone.this.zone_id
  app_domain           = var.domain_name
  origin_domain        = local.origin_domain
  origin_verify_secret = random_password.origin_verify.result
  image_tag            = var.image_tag
  desired_count        = var.desired_count
  features             = var.features

  db = {
    address           = module.database.address
    port              = module.database.port
    name              = module.database.db_name
    username          = module.database.username
    security_group_id = module.database.security_group_id
  }
  db_password = random_password.db.result

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
  source = "../modules/cdn"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                 = var.name
  domain_name          = var.domain_name
  hosted_zone_id       = data.aws_route53_zone.this.zone_id
  api_origin_domain    = local.origin_domain
  origin_verify_secret = random_password.origin_verify.result
  media_key_group_id   = aws_cloudfront_key_group.media.id

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
  source           = "../modules/media_processing"
  name             = var.name
  media_bucket_id  = module.storage.media_bucket_id
  media_bucket_arn = module.storage.media_bucket_arn
  api_base_url     = local.app_url
  app_secret_arn   = module.backend.app_secret_arn
  source_dir       = "${path.module}/../../media-processor/build"
}

output "app_url" { value = local.app_url }
output "ecr_repository_url" { value = module.backend.ecr_repository_url }
output "ecs_cluster" { value = module.backend.cluster_name }
output "ecs_service" { value = module.backend.service_name }
output "ecs_task_family" { value = module.backend.task_definition_family }
output "ecs_subnets" { value = join(",", module.backend.private_subnet_ids) }
output "ecs_security_group" { value = module.backend.app_security_group_id }
output "frontend_bucket" { value = module.storage.frontend_bucket_id }
output "media_bucket" { value = module.storage.media_bucket_id }
output "cloudfront_distribution_id" { value = module.cdn.distribution_id }
output "cognito_user_pool_id" { value = module.auth.user_pool_id }

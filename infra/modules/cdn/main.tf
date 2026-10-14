# One CloudFront distribution on the app domain:
#   /*        -> frontend bucket (SPA; a viewer-request function rewrites routes to /index.html)
#   /api/*    -> ALB (no caching; forwards cookies, query strings, and the secret origin header)
#   /media/*  -> media bucket (requires CloudFront signed URLs from the trusted key group)

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

variable "name" { type = string }
variable "domain_name" { type = string }
variable "hosted_zone_id" { type = string }
variable "api_origin_domain" { type = string }
variable "origin_verify_secret" {
  type      = string
  sensitive = true
}
variable "media_key_group_id" { type = string }
variable "frontend_bucket" {
  type = object({ id = string, arn = string, regional_domain_name = string })
}
variable "media_bucket" {
  type = object({ id = string, arn = string, regional_domain_name = string })
}
variable "geo_allowlist" {
  description = "ISO country codes allowed to reach the site (e.g. [\"US\"]). Empty = no restriction. Free."
  type        = list(string)
  default     = []
}
variable "price_class" {
  type    = string
  default = "PriceClass_100" # North America + Europe edges
}

# CloudFront certificates must live in us-east-1.
resource "aws_acm_certificate" "this" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  }
  zone_id         = var.hosted_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa_router" {
  name    = "${var.name}-spa-router"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      var last = request.uri.split('/').pop();
      // Paths without a file extension are client-side routes.
      if (last.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  JS
}

data "aws_cloudfront_cache_policy" "optimized" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" { name = "Managed-AllViewerExceptHostHeader" }
data "aws_cloudfront_response_headers_policy" "security" { name = "Managed-SecurityHeadersPolicy" }

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  aliases             = [var.domain_name]
  default_root_object = "index.html"
  price_class         = var.price_class
  comment             = var.name

  origin {
    origin_id                = "frontend"
    domain_name              = var.frontend_bucket.regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = "media"
    domain_name              = var.media_bucket.regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id   = "api"
    domain_name = var.api_origin_domain
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_verify_secret
    }
  }

  default_cache_behavior {
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_router.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern           = "/media/*"
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    trusted_key_groups     = [var.media_key_group_id]
    compress               = false # images/video are already compressed
  }

  restrictions {
    geo_restriction {
      restriction_type = length(var.geo_allowlist) > 0 ? "whitelist" : "none"
      locations        = var.geo_allowlist
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.this.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Buckets only accept reads from this distribution.
data "aws_iam_policy_document" "cloudfront_read" {
  for_each = { frontend = var.frontend_bucket.arn, media = var.media_bucket.arn }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${each.value}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = var.frontend_bucket.id
  policy = data.aws_iam_policy_document.cloudfront_read["frontend"].json
}

resource "aws_s3_bucket_policy" "media" {
  bucket = var.media_bucket.id
  policy = data.aws_iam_policy_document.cloudfront_read["media"].json
}

resource "aws_route53_record" "app" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.hosted_zone_id
  name     = var.domain_name
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

output "distribution_id" { value = aws_cloudfront_distribution.this.id }
output "distribution_domain_name" { value = aws_cloudfront_distribution.this.domain_name }

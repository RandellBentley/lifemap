# Private S3 buckets for the SPA build and user media. Neither is public;
# CloudFront reads both through Origin Access Control (policies live in the cdn module).

variable "name" { type = string }
variable "cors_allowed_origins" {
  description = "Origins allowed to upload directly to the media bucket (presigned POST)."
  type        = list(string)
}
variable "force_destroy" {
  type    = bool
  default = false
}

data "aws_caller_identity" "current" {}

locals {
  suffix = data.aws_caller_identity.current.account_id
}

# --- Frontend --------------------------------------------------------------------

resource "aws_s3_bucket" "frontend" {
  bucket        = "${var.name}-frontend-${local.suffix}"
  force_destroy = true # build artifacts only; always reproducible
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

# --- Media -------------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket        = "${var.name}-media-${local.suffix}"
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

# Versioning protects originals from accidental overwrite/delete.
resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_methods = ["POST", "GET", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket     = aws_s3_bucket.media.id
  depends_on = [aws_s3_bucket_versioning.media]

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }

  # Originals are rarely read once thumbnails exist; Intelligent-Tiering moves
  # them to cheaper tiers automatically with no retrieval fees.
  rule {
    id     = "originals-intelligent-tiering"
    status = "Enabled"
    filter { prefix = "media/originals/" }
    transition {
      days          = 0
      storage_class = "INTELLIGENT_TIERING"
    }
  }

  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 30 }
    expiration { expired_object_delete_marker = true }
  }
}

output "frontend_bucket_id" { value = aws_s3_bucket.frontend.id }
output "frontend_bucket_arn" { value = aws_s3_bucket.frontend.arn }
output "frontend_bucket_regional_domain_name" { value = aws_s3_bucket.frontend.bucket_regional_domain_name }
output "media_bucket_id" { value = aws_s3_bucket.media.id }
output "media_bucket_arn" { value = aws_s3_bucket.media.arn }
output "media_bucket_regional_domain_name" { value = aws_s3_bucket.media.bucket_regional_domain_name }

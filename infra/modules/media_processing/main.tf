# S3 ObjectCreated (media/originals/*) -> Lambda that writes thumbnails to
# media/derived/* and reports back to the API. Writing to a different prefix
# than the trigger avoids recursive invocations.

variable "name" { type = string }
variable "media_bucket_id" { type = string }
variable "media_bucket_arn" { type = string }
variable "api_base_url" { type = string }
variable "app_secret_arn" { type = string }
variable "source_dir" {
  description = "Built Lambda package directory (media-processor/build)."
  type        = string
}
variable "architecture" {
  type    = string
  default = "arm64" # must match LAMBDA_ARCH in media-processor/build.sh
}

data "archive_file" "package" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.root}/.build/${var.name}-media-processor.zip"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.name}-media-processor"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "this" {
  role = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${var.media_bucket_arn}/media/originals/*"] },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = ["${var.media_bucket_arn}/media/derived/*"] },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [var.app_secret_arn] },
    ]
  })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}-media-processor"
  retention_in_days = 30
}

resource "aws_lambda_function" "this" {
  function_name    = "${var.name}-media-processor"
  role             = aws_iam_role.this.arn
  runtime          = "python3.12"
  architectures    = [var.architecture]
  handler          = "handler.handler"
  filename         = data.archive_file.package.output_path
  source_code_hash = data.archive_file.package.output_base64sha256
  memory_size      = 2048 # large photos decode into a lot of memory
  timeout          = 120

  environment {
    variables = {
      API_BASE_URL   = var.api_base_url
      APP_SECRET_ARN = var.app_secret_arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.this]
}

resource "aws_lambda_permission" "s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = var.media_bucket_arn
}

resource "aws_s3_bucket_notification" "originals" {
  bucket = var.media_bucket_id
  lambda_function {
    lambda_function_arn = aws_lambda_function.this.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "media/originals/"
  }
  depends_on = [aws_lambda_permission.s3]
}

output "function_name" { value = aws_lambda_function.this.function_name }

# Django on ECS Fargate behind an ALB that only CloudFront can reach:
#  - ALB security group allows 443 only from CloudFront's origin-facing IP ranges
#  - the listener forwards only requests carrying CloudFront's secret X-Origin-Verify header

variable "name" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "hosted_zone_id" { type = string }
variable "app_domain" {
  description = "Public domain users visit (CloudFront)."
  type        = string
}
variable "origin_domain" {
  description = "DNS name CloudFront uses to reach the ALB."
  type        = string
}
variable "origin_verify_secret" {
  type      = string
  sensitive = true
}
variable "image_tag" { type = string }
variable "cpu" {
  type    = number
  default = 512
}
variable "memory" {
  type    = number
  default = 1024
}
variable "desired_count" {
  type    = number
  default = 1
}
variable "cpu_architecture" {
  description = "ARM64 (Graviton) is ~20% cheaper; build images with --platform linux/arm64."
  type        = string
  default     = "ARM64"
}

variable "db" {
  type = object({
    address           = string
    port              = number
    name              = string
    username          = string
    security_group_id = string
  })
}
variable "db_password" {
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
  type = object({
    user_pool_id = string
    client_id    = string
    domain_url   = string
  })
}
variable "cognito_client_secret" {
  type      = string
  sensitive = true
}

data "aws_region" "current" {}

# --- Secrets ---------------------------------------------------------------------

resource "random_password" "django_secret_key" {
  length  = 64
  special = false
}

resource "random_password" "internal_api_token" {
  length  = 48
  special = false
}

# One JSON secret; ECS injects individual keys as env vars at task start.
resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    django_secret_key      = random_password.django_secret_key.result
    internal_api_token     = random_password.internal_api_token.result
    database_password      = var.db_password
    cloudfront_private_key = var.cloudfront_private_key_pem
    cognito_client_secret  = var.cognito_client_secret
  })
}

# --- Container registry ------------------------------------------------------------

resource "aws_ecr_repository" "app" {
  name                 = "${var.name}-backend"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

# --- Load balancer -------------------------------------------------------------------

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "HTTPS from CloudFront only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 8000
  to_port                      = 8000
}

resource "aws_acm_certificate" "origin" {
  domain_name       = var.origin_domain
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "origin_validation" {
  for_each = {
    for o in aws_acm_certificate.origin.domain_validation_options : o.domain_name => o
  }
  zone_id         = var.hosted_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "origin" {
  certificate_arn         = aws_acm_certificate.origin.arn
  validation_record_fqdns = [for r in aws_route53_record.origin_validation : r.fqdn]
}

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = var.public_subnet_ids
  idle_timeout               = 60
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "app" {
  name                 = var.name
  port                 = 8000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = "/api/health/"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.origin.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [var.origin_verify_secret]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_route53_record" "origin" {
  zone_id = var.hosted_zone_id
  name    = var.origin_domain
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

# --- ECS -----------------------------------------------------------------------------

resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "Django tasks"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8000
  to_port                      = 8000
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = var.db.security_group_id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = var.db.port
  to_port                      = var.db.port
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: used by the ECS agent to pull the image, write logs, read secrets.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.app.arn]
    }]
  })
}

# Task role: what Django itself may do. Only the media bucket, nothing else.
resource "aws_iam_role" "task" {
  name               = "${var.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task_media" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = ["${var.media_bucket_arn}/media/*"]
    }]
  })
}

locals {
  app_url = "https://${var.app_domain}"
  secret  = aws_secretsmanager_secret.app.arn

  environment = {
    DJANGO_DEBUG                = "0"
    DJANGO_ALLOWED_HOSTS        = "${var.app_domain},${var.origin_domain}"
    DJANGO_CSRF_TRUSTED_ORIGINS = local.app_url
    APP_BASE_URL                = local.app_url
    AUTH_MODE                   = "cognito"
    COGNITO_REGION              = data.aws_region.current.region
    COGNITO_USER_POOL_ID        = var.cognito.user_pool_id
    COGNITO_CLIENT_ID           = var.cognito.client_id
    COGNITO_DOMAIN              = var.cognito.domain_url
    DATABASE_HOST               = var.db.address
    DATABASE_PORT               = tostring(var.db.port)
    DATABASE_NAME               = var.db.name
    DATABASE_USER               = var.db.username
    DATABASE_SSLMODE            = "require"
    AWS_REGION                  = data.aws_region.current.region
    MEDIA_BUCKET                = var.media_bucket_id
    CLOUDFRONT_MEDIA_BASE_URL   = local.app_url
    CLOUDFRONT_KEY_PAIR_ID      = var.cloudfront_key_pair_id
    MEDIA_PROCESSING_ENABLED    = "1"
  }

  secrets = {
    DJANGO_SECRET_KEY      = "${local.secret}:django_secret_key::"
    INTERNAL_API_TOKEN     = "${local.secret}:internal_api_token::"
    DATABASE_PASSWORD      = "${local.secret}:database_password::"
    CLOUDFRONT_PRIVATE_KEY = "${local.secret}:cloudfront_private_key::"
    COGNITO_CLIENT_SECRET  = "${local.secret}:cognito_client_secret::"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name         = "web"
    image        = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 8000, protocol = "tcp" }]
    environment  = [for k, v in local.environment : { name = k, value = v }]
    secrets      = [for k, v in local.secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "web"
      }
    }
  }])

  depends_on = [aws_secretsmanager_secret_version.app]
}

resource "aws_ecs_service" "app" {
  name                   = var.name
  cluster                = aws_ecs_cluster.this.id
  task_definition        = aws_ecs_task_definition.app.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "web"
    container_port   = 8000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener_rule.from_cloudfront]
}

output "ecr_repository_url" { value = aws_ecr_repository.app.repository_url }
output "cluster_name" { value = aws_ecs_cluster.this.name }
output "service_name" { value = aws_ecs_service.app.name }
output "task_definition_family" { value = aws_ecs_task_definition.app.family }
output "app_secret_arn" { value = aws_secretsmanager_secret.app.arn }
output "app_security_group_id" { value = aws_security_group.app.id }
output "private_subnet_ids" { value = var.private_subnet_ids }

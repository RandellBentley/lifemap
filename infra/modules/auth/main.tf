# Cognito user pool + an OIDC client for the Django backend (confidential client,
# authorization code + PKCE). Django exchanges the code and issues its own session.

variable "name" { type = string }
variable "domain_prefix" {
  description = "Cognito hosted domain prefix: https://<prefix>.auth.<region>.amazoncognito.com"
  type        = string
}
variable "callback_urls" { type = list(string) }
variable "logout_urls" { type = list(string) }
variable "invite_only" {
  description = "Only admins can create users (good for a private journal)."
  type        = bool
  default     = true
}
variable "require_mfa" {
  description = "Require an authenticator app (TOTP) for every user instead of making it optional."
  type        = bool
  default     = false
}
variable "deletion_protection" {
  type    = bool
  default = true
}

data "aws_region" "current" {}

resource "aws_cognito_user_pool" "this" {
  name                     = var.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.deletion_protection ? "ACTIVE" : "INACTIVE"
  mfa_configuration        = var.require_mfa ? "ON" : "OPTIONAL"

  software_token_mfa_configuration { enabled = true }

  password_policy {
    minimum_length    = 10
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  admin_create_user_config {
    allow_admin_create_user_only = var.invite_only
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 1 # classic hosted UI; v2 requires a branding resource
}

resource "aws_cognito_user_pool_client" "web" {
  name            = "${var.name}-web"
  user_pool_id    = aws_cognito_user_pool.this.id
  generate_secret = true

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls

  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"

  # Tokens are only used once at login; Django's session governs how long users stay signed in.
  id_token_validity     = 60
  access_token_validity = 60
  token_validity_units {
    id_token     = "minutes"
    access_token = "minutes"
  }
}

output "user_pool_id" { value = aws_cognito_user_pool.this.id }
output "client_id" { value = aws_cognito_user_pool_client.web.id }
output "client_secret" {
  value     = aws_cognito_user_pool_client.web.client_secret
  sensitive = true
}
output "domain_url" {
  value = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.region}.amazoncognito.com"
}

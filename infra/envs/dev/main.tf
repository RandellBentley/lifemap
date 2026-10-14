terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    tls     = { source = "hashicorp/tls", version = "~> 4.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.6" }
  }
  # Bucket/region come from backend.hcl: terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "lifemap/dev/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}
variable "domain_name" { type = string }
variable "hosted_zone_name" { type = string }
variable "cognito_domain_prefix" { type = string }
variable "image_tag" {
  description = "Backend image tag in ECR; set by scripts/deploy.sh."
  type        = string
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "lifemap", Environment = "dev", ManagedBy = "terraform" }
  }
}

# CloudFront's ACM certificate must be issued in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Project = "lifemap", Environment = "dev", ManagedBy = "terraform" }
  }
}

module "stack" {
  source = "../../stack"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                  = "lifemap-dev"
  domain_name           = var.domain_name
  hosted_zone_name      = var.hosted_zone_name
  cognito_domain_prefix = var.cognito_domain_prefix
  image_tag             = var.image_tag
  production            = false
  # Lets the local Vite dev server upload straight to the dev bucket if you point Django at it.
  extra_cors_origins = ["http://localhost:5173"]
}

output "stack" { value = module.stack }

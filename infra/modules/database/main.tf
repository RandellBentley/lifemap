# RDS PostgreSQL in private subnets. Ingress is added by the backend module.

variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "password" {
  type      = string
  sensitive = true
}
variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "engine_version" {
  type    = string
  default = "17"
}
variable "multi_az" {
  type    = bool
  default = false
}
variable "deletion_protection" {
  type    = bool
  default = true
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres; ingress granted to the app by the backend module"
  vpc_id      = var.vpc_id
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "lifemap"
  username = "lifemap"
  # A Terraform-managed password (kept in the app's Secrets Manager secret) rather than
  # manage_master_user_password: RDS-managed secrets rotate weekly, and ECS only reads
  # secrets at task start, so running tasks would lose DB access after each rotation.
  password = var.password

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  deletion_protection        = var.deletion_protection
  skip_final_snapshot        = !var.deletion_protection
  final_snapshot_identifier  = var.deletion_protection ? "${var.name}-final" : null
}

output "address" { value = aws_db_instance.this.address }
output "port" { value = aws_db_instance.this.port }
output "db_name" { value = aws_db_instance.this.db_name }
output "username" { value = aws_db_instance.this.username }
output "security_group_id" { value = aws_security_group.db.id }

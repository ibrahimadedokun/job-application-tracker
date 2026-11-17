terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.8"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
}
provider "azapi" {
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id
}
provider "azuread" { tenant_id = var.tenant_id }
data "azuread_client_config" "current" {}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.account_id]
}


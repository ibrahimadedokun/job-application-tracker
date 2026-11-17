variable "name" {
  type    = string
  default = "folio"
}
variable "environment" {
  type    = string
  default = "dev"
}
variable "region" {
  type    = string
  default = "eastus2"
}
variable "resource_group_region" {
  type        = string
  default     = null
  description = "Metadata location of the resource group; preserve it when moving an incomplete deployment's workload region."
}
variable "static_web_region" {
  type        = string
  default     = "eastus2"
  description = "Static Web Apps control-plane region, selected independently of the Functions/storage region."
}
variable "subscription_id" { type = string }
variable "tenant_id" { type = string }
variable "budget_amount" {
  type    = number
  default = 10
}
variable "budget_email" {
  type    = string
  default = ""
}
variable "budget_start_date" {
  type        = string
  default     = "2026-11-01T00:00:00Z"
  description = "First day of the initial deployment month. Keep stable thereafter."
}
variable "extra_origins" {
  type    = list(string)
  default = []
}

variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}
variable "model_id" {
  type = string
  validation {
    condition     = can(regex("^[A-Za-z0-9._:/-]+$", var.model_id)) && !can(regex("^(us|eu|apac|global)\\.", var.model_id))
    error_message = "Use an explicit model ID or full inference-profile ARN without wildcards."
  }
}
variable "extra_model_arns" {
  type    = list(string)
  default = []
  validation {
    condition     = alltrue([for arn in var.extra_model_arns : can(regex("^arn:aws[^:]*:bedrock:[a-z0-9-]+:[0-9]*:foundation-model/[A-Za-z0-9._:-]+$", arn)) || can(regex("^arn:aws:bedrock:::foundation-model/[A-Za-z0-9._:-]+$", arn))])
    error_message = "Extra model resources must be explicit foundation-model ARNs."
  }
}

variable "aws_region" {
  type    = string
  default = "eu-west-2"
  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]+$", var.aws_region))
    error_message = "Use an AWS region name."
  }
}
variable "existing_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "Reuse a tenant OIDC provider owned elsewhere; add this deployment's federation audience there first."
}

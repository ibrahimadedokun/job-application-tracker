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
  default = "eu-west-2"
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
    condition     = length(var.model_id) > 0 && !strcontains(var.model_id, "*") && !can(regex("^(us|eu|apac|global)\\.", var.model_id))
    error_message = "Use an explicit model ID or full inference-profile ARN without wildcards."
  }
}
variable "extra_model_arns" {
  type    = list(string)
  default = []
  validation {
    condition     = alltrue([for arn in var.extra_model_arns : can(regex("^arn:aws[^:]*:bedrock:[a-z0-9-]+:[0-9]*:foundation-model/[^*]+$", arn))])
    error_message = "Extra model resources must be explicit foundation-model ARNs."
  }
}
variable "lambda_bundle_path" { type = string }
variable "budget_amount" {
  type    = number
  default = 10
}
variable "budget_email" {
  type    = string
  default = ""
}
variable "cognito_domain_prefix" {
  type    = string
  default = ""
}

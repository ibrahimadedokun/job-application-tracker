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
  default = "westeurope"
}
variable "subscription_id" { type = string }
variable "tenant_id" { type = string }
variable "foundry_region" {
  type    = string
  default = "swedencentral"
}
variable "model_id" {
  type    = string
  default = "gpt-4.1-nano"
}
variable "model_version" {
  type    = string
  default = "2025-04-14"
}
variable "model_sku" {
  type    = string
  default = "GlobalStandard"
  validation {
    condition     = contains(["GlobalStandard", "Standard", "DataZoneStandard"], var.model_sku)
    error_message = "Use a consumption model SKU, not provisioned throughput."
  }
}
variable "model_capacity" {
  type    = number
  default = 10
}
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

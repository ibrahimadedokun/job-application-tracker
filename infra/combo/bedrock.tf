locals {
  # A dedicated v1 resource audience avoids v2 azp/aud claim remapping in STS.
  issuer          = "https://sts.windows.net/${var.tenant_id}/"
  issuer_key      = trimprefix(local.issuer, "https://")
  model_resources = concat([startswith(var.model_id, "arn:") ? var.model_id : "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.model_id}"], var.extra_model_arns)
  haiku_4_5       = anytrue([for resource in local.model_resources : strcontains(resource, "anthropic.claude-haiku-4-5")])
  oidc_arn        = var.existing_oidc_provider_arn == "" ? aws_iam_openid_connect_provider.azure[0].arn : data.aws_iam_openid_connect_provider.existing[0].arn
}

resource "azuread_application_registration" "bedrock" {
  display_name                   = "${local.prefix} AWS federation"
  sign_in_audience               = "AzureADMyOrg"
  requested_access_token_version = 1
}
resource "azuread_application_identifier_uri" "bedrock" {
  application_id = azuread_application_registration.bedrock.id
  identifier_uri = "api://${azuread_application_registration.bedrock.client_id}"
}
resource "azuread_application_app_role" "bedrock" {
  application_id       = azuread_application_registration.bedrock.id
  role_id              = uuidv5("url", "${local.prefix}/bedrock.invoke")
  allowed_member_types = ["Application"]
  display_name         = "Invoke Bedrock"
  description          = "Allow the Function managed identity to obtain AWS federation tokens."
  value                = "Bedrock.Invoke"
}
resource "azuread_service_principal" "bedrock" {
  client_id                    = azuread_application_registration.bedrock.client_id
  app_role_assignment_required = true
}
resource "azuread_app_role_assignment" "bedrock" {
  app_role_id         = azuread_application_app_role.bedrock.role_id
  principal_object_id = azapi_resource.identity.output.properties.principalId
  resource_object_id  = azuread_service_principal.bedrock.object_id
}

resource "aws_iam_openid_connect_provider" "azure" {
  count          = var.existing_oidc_provider_arn == "" ? 1 : 0
  url            = local.issuer
  client_id_list = [azuread_application_identifier_uri.bedrock.identifier_uri]
}
data "aws_iam_openid_connect_provider" "existing" {
  count = var.existing_oidc_provider_arn == "" ? 0 : 1
  arn   = var.existing_oidc_provider_arn
  lifecycle {
    postcondition {
      condition     = trimsuffix(trimprefix(self.url, "https://"), "/") == trimsuffix(local.issuer_key, "/") && contains(self.client_id_list, azuread_application_identifier_uri.bedrock.identifier_uri)
      error_message = "Existing OIDC provider must use this tenant's sts.windows.net issuer and include the federation application URI in its audiences."
    }
  }
}
resource "aws_iam_role" "bedrock" {
  name                 = "${local.prefix}-bedrock-${local.suffix}"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${local.issuer_key}:aud" = azuread_application_identifier_uri.bedrock.identifier_uri
        "${local.issuer_key}:sub" = azapi_resource.identity.output.properties.principalId
      } }
    }]
  })
}
resource "aws_iam_role_policy" "bedrock" {
  role = aws_iam_role.bedrock.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["bedrock:InvokeModel"], Resource = local.model_resources
  }] })
  lifecycle {
    precondition {
      condition     = !strcontains(var.model_id, "inference-profile/") || length(var.extra_model_arns) > 0
      error_message = "Inference profiles require explicit destination foundation-model ARNs."
    }
    precondition {
      condition     = !local.haiku_4_5 || can(regex(":(application-)?inference-profile/", var.model_id))
      error_message = "Claude Haiku 4.5 on Bedrock Runtime requires a full cross-region inference-profile ARN and its destination model ARNs; a bare foundation-model ID cannot be invoked regionally."
    }
    precondition {
      condition     = !can(regex(":(application-)?inference-profile/", var.model_id)) || startswith(var.model_id, "arn:aws:bedrock:${var.aws_region}:${var.account_id}:")
      error_message = "The inference profile ARN must belong to the configured AWS account and source region."
    }
  }
}
resource "aws_budgets_budget" "monthly" {
  count        = var.budget_email == "" ? 0 : 1
  name         = "${local.prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_amount)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}

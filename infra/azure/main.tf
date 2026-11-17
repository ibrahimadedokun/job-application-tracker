locals {
  prefix           = "${var.name}-${var.environment}"
  suffix           = substr(sha256("${var.subscription_id}/${local.prefix}"), 0, 12)
  storage_name     = "folio${local.suffix}"
  foundry_name     = "${local.prefix}-ai-${local.suffix}"
  project_endpoint = "https://${local.foundry_name}.services.ai.azure.com/api/projects/folio"
  web_url          = "https://${azapi_resource.web.output.properties.defaultHostname}"
  tags             = { application = "folio", environment = var.environment }
  subscription     = "/subscriptions/${var.subscription_id}"
  blob_role        = "${local.subscription}/providers/Microsoft.Authorization/roleDefinitions/b7e6dc6d-f1e8-4753-8033-0f276bb0955b"
  ai_role          = "${local.subscription}/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d"
}
resource "azapi_resource" "group" {
  type      = "Microsoft.Resources/resourceGroups@2024-03-01"
  name      = local.prefix
  parent_id = local.subscription
  location  = var.region
  tags      = local.tags
}
resource "azapi_resource" "identity" {
  type                   = "Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31"
  name                   = "${local.prefix}-api-identity"
  parent_id              = azapi_resource.group.id
  location               = var.region
  tags                   = local.tags
  response_export_values = ["properties.clientId", "properties.principalId"]
}
resource "azapi_resource" "storage" {
  type      = "Microsoft.Storage/storageAccounts@2023-05-01"
  name      = local.storage_name
  parent_id = azapi_resource.group.id
  location  = var.region
  tags      = local.tags
  body = {
    kind = "StorageV2"
    sku  = { name = "Standard_LRS" }
    properties = {
      accessTier               = "Hot"
      allowBlobPublicAccess    = false
      allowSharedKeyAccess     = false
      supportsHttpsTrafficOnly = true
      minimumTlsVersion        = "TLS1_2"
      publicNetworkAccess      = "Enabled"
    }
  }
  lifecycle { prevent_destroy = true }
}
resource "azapi_resource" "blobs" {
  type      = "Microsoft.Storage/storageAccounts/blobServices@2023-05-01"
  name      = "default"
  parent_id = azapi_resource.storage.id
  body = { properties = {
    deleteRetentionPolicy          = { enabled = true, days = 7 }
    containerDeleteRetentionPolicy = { enabled = true, days = 7 }
    isVersioningEnabled            = false
  } }
}
resource "azapi_resource" "containers" {
  for_each  = toset(["applications", "function-packages"])
  type      = "Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01"
  name      = each.value
  parent_id = azapi_resource.blobs.id
  body      = { properties = { publicAccess = "None" } }
}
resource "azapi_resource" "storage_role" {
  type      = "Microsoft.Authorization/roleAssignments@2022-04-01"
  name      = uuidv5("url", "${azapi_resource.storage.id}/${azapi_resource.identity.output.properties.principalId}/blob-owner")
  parent_id = azapi_resource.storage.id
  body = { properties = {
    roleDefinitionId = local.blob_role
    principalId      = azapi_resource.identity.output.properties.principalId
    principalType    = "ServicePrincipal"
  } }
}
resource "azapi_resource" "storage_lock" {
  type      = "Microsoft.Authorization/locks@2020-05-01"
  name      = "retain-application-data"
  parent_id = azapi_resource.storage.id
  body      = { properties = { level = "CanNotDelete", notes = "Export records and explicitly remove protection before deleting data." } }
}
resource "azapi_resource" "foundry" {
  type      = "Microsoft.CognitiveServices/accounts@2025-06-01"
  name      = local.foundry_name
  parent_id = azapi_resource.group.id
  location  = var.foundry_region
  tags      = local.tags
  identity { type = "SystemAssigned" }
  body = {
    kind = "AIServices"
    sku  = { name = "S0" }
    properties = {
      customSubDomainName    = local.foundry_name
      allowProjectManagement = true
      disableLocalAuth       = true
      publicNetworkAccess    = "Enabled"
    }
  }
}
resource "azapi_resource" "project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@2025-06-01"
  name      = "folio"
  parent_id = azapi_resource.foundry.id
  location  = var.foundry_region
  identity { type = "SystemAssigned" }
  body = { properties = { displayName = "Folio tailoring", description = "Private CV and cover-letter prompt agent." } }
}
resource "azapi_resource" "model" {
  type      = "Microsoft.CognitiveServices/accounts/deployments@2025-06-01"
  name      = "tailoring"
  parent_id = azapi_resource.foundry.id
  body = {
    sku = { name = var.model_sku, capacity = var.model_capacity }
    properties = {
      model                = { format = "OpenAI", name = var.model_id, version = var.model_version }
      versionUpgradeOption = "OnceCurrentVersionExpired"
    }
  }
}
resource "azapi_resource" "ai_roles" {
  for_each  = { api = azapi_resource.identity.output.properties.principalId, deployer = data.azuread_client_config.current.object_id }
  type      = "Microsoft.Authorization/roleAssignments@2022-04-01"
  name      = uuidv5("url", "${azapi_resource.project.id}/${each.value}/ai-user")
  parent_id = azapi_resource.project.id
  body = { properties = merge({
    roleDefinitionId = local.ai_role
    principalId      = each.value
  }, each.key == "api" ? { principalType = "ServicePrincipal" } : {}) }
}
resource "azapi_resource" "web" {
  type                   = "Microsoft.Web/staticSites@2023-12-01"
  name                   = "${local.prefix}-web-${local.suffix}"
  parent_id              = azapi_resource.group.id
  location               = var.region
  tags                   = local.tags
  body                   = { sku = { name = "Free", tier = "Free" }, properties = { allowConfigFileUpdates = true } }
  response_export_values = ["properties.defaultHostname"]
}
resource "azuread_application_registration" "browser" {
  display_name                   = "${local.prefix} workspace"
  sign_in_audience               = "AzureADMyOrg"
  requested_access_token_version = 2
  lifecycle { prevent_destroy = true }
}
resource "azuread_application_identifier_uri" "api" {
  application_id = azuread_application_registration.browser.id
  identifier_uri = "api://${azuread_application_registration.browser.client_id}"
}
resource "azuread_application_permission_scope" "api" {
  application_id             = azuread_application_registration.browser.id
  scope_id                   = uuidv5("url", "${local.prefix}/access_as_user")
  value                      = "access_as_user"
  type                       = "User"
  admin_consent_display_name = "Access your Folio workspace"
  admin_consent_description  = "Read and update the signed-in user's job applications and generate documents."
  user_consent_display_name  = "Access your Folio workspace"
  user_consent_description   = "Read and update your job applications and generate documents."
}
resource "azuread_application_redirect_uris" "browser" {
  application_id = azuread_application_registration.browser.id
  type           = "SPA"
  redirect_uris  = concat(["${local.web_url}/"], [for origin in var.extra_origins : "${origin}/"])
}
resource "azuread_service_principal" "browser" {
  client_id = azuread_application_registration.browser.client_id
}
resource "azapi_resource" "plan" {
  type      = "Microsoft.Web/serverfarms@2024-04-01"
  name      = "${local.prefix}-plan"
  parent_id = azapi_resource.group.id
  location  = var.region
  tags      = local.tags
  body      = { kind = "functionapp", sku = { name = "FC1", tier = "FlexConsumption" }, properties = { reserved = true } }
}
resource "azapi_resource" "api" {
  type      = "Microsoft.Web/sites@2024-04-01"
  name      = "${local.prefix}-api-${local.suffix}"
  parent_id = azapi_resource.group.id
  location  = var.region
  tags      = local.tags
  identity {
    type         = "UserAssigned"
    identity_ids = [azapi_resource.identity.id]
  }
  body = {
    kind = "functionapp,linux"
    properties = {
      serverFarmId = azapi_resource.plan.id
      httpsOnly    = true
      functionAppConfig = {
        deployment = { storage = {
          type           = "blobContainer"
          value          = "https://${local.storage_name}.blob.core.windows.net/function-packages"
          authentication = { type = "UserAssignedIdentity", userAssignedIdentityResourceId = azapi_resource.identity.id }
        } }
        runtime             = { name = "node", version = "22" }
        scaleAndConcurrency = { instanceMemoryMB = 512, maximumInstanceCount = 40, triggers = { http = { perInstanceConcurrency = 4 } } }
      }
      siteConfig = {
        minTlsVersion = "1.2"
        ftpsState     = "Disabled"
        cors          = { allowedOrigins = concat([local.web_url], var.extra_origins), supportCredentials = false }
        appSettings = [for key, value in {
          AzureWebJobsStorage__accountName = local.storage_name
          AzureWebJobsStorage__credential  = "managedidentity"
          AzureWebJobsStorage__clientId    = azapi_resource.identity.output.properties.clientId
          AZURE_CLIENT_ID                  = azapi_resource.identity.output.properties.clientId
          ENTRA_TENANT_ID                  = var.tenant_id
          ENTRA_CLIENT_ID                  = azuread_application_registration.browser.client_id
          AZURE_STORAGE_ACCOUNT_URL        = "https://${local.storage_name}.blob.core.windows.net"
          AZURE_STORAGE_CONTAINER          = "applications"
          FOUNDRY_PROJECT_ENDPOINT         = local.project_endpoint
          FOUNDRY_AGENT_NAME               = "folio-tailoring"
        } : { name = key, value = value }]
      }
    }
  }
  response_export_values = ["properties.defaultHostName"]
  depends_on             = [azapi_resource.storage_role, azapi_resource.ai_roles, azapi_resource.containers]
}
resource "azapi_resource" "budget" {
  count     = var.budget_email == "" ? 0 : 1
  type      = "Microsoft.Consumption/budgets@2023-11-01"
  name      = "${local.prefix}-monthly"
  parent_id = azapi_resource.group.id
  body = { properties = {
    category   = "Cost"
    amount     = var.budget_amount
    timeGrain  = "Monthly"
    timePeriod = { startDate = var.budget_start_date }
    notifications = { actual = {
      enabled = true, operator = "GreaterThanOrEqualTo", threshold = 80, contactEmails = [var.budget_email], thresholdType = "Actual"
    } }
  } }
}

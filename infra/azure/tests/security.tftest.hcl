mock_provider "azapi" {}
mock_provider "azuread" {}
variables {
  subscription_id = "11111111-1111-4111-8111-111111111111"
  tenant_id       = "22222222-2222-4222-8222-222222222222"
}
override_resource {
  target = azapi_resource.identity
  values = { output = { properties = { principalId = "33333333-3333-4333-8333-333333333333", clientId = "44444444-4444-4444-8444-444444444444" } } }
}
override_resource {
  target = azapi_resource.web
  values = { output = { properties = { defaultHostname = "test.azurestaticapps.net" } } }
}
override_resource {
  target = azapi_resource.api
  values = { output = { properties = { defaultHostName = "test.azurewebsites.net" } } }
}
run "cheap_private_managed_defaults" {
  command = plan
  assert {
    condition     = azapi_resource.storage.body.sku.name == "Standard_LRS" && !azapi_resource.storage.body.properties.allowBlobPublicAccess && !azapi_resource.storage.body.properties.allowSharedKeyAccess && azapi_resource.storage.body.properties.supportsHttpsTrafficOnly
    error_message = "Use private LRS storage with HTTPS and no shared keys."
  }
  assert {
    condition     = azapi_resource.web.body.sku.name == "Free" && azapi_resource.plan.body.sku.name == "FC1" && azapi_resource.api.body.properties.functionAppConfig.scaleAndConcurrency.instanceMemoryMB == 512 && !can(azapi_resource.api.body.properties.functionAppConfig.scaleAndConcurrency.alwaysReady)
    error_message = "Keep free static hosting and scale-to-zero Functions."
  }
  assert {
    condition     = azapi_resource.api.body.properties.httpsOnly && azapi_resource.api.body.properties.functionAppConfig.deployment.storage.authentication.type == "UserAssignedIdentity" && azapi_resource.foundry.body.properties.disableLocalAuth
    error_message = "Use HTTPS and managed identity for storage and Foundry."
  }
  assert {
    condition     = azuread_application_registration.browser.requested_access_token_version == 2 && azuread_application_registration.browser.sign_in_audience == "AzureADMyOrg" && azuread_application_permission_scope.api.value == "access_as_user"
    error_message = "Use single-tenant Entra authentication with v2 API access tokens."
  }
  assert {
    condition     = azapi_resource.storage_lock.body.properties.level == "CanNotDelete" && azapi_resource.blobs.body.properties.deleteRetentionPolicy.days == 7 && !azapi_resource.blobs.body.properties.isVersioningEnabled
    error_message = "Keep explicit data protection and bounded soft-delete retention."
  }
  assert {
    condition     = alltrue([for setting in azapi_resource.api.body.properties.siteConfig.appSettings : !can(regex("KEY$|SECRET$|CONNECTION_STRING$", setting.name))])
    error_message = "Do not configure runtime credential secrets."
  }
}

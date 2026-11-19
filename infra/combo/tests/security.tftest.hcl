mock_provider "aws" {}
mock_provider "azapi" {}
mock_provider "azuread" {}
variables {
  subscription_id = "11111111-1111-4111-8111-111111111111"
  tenant_id       = "22222222-2222-4222-8222-222222222222"
  account_id      = "123456789012"
  model_id        = "amazon.nova-micro-v1:0"
}
override_resource {
  target          = azapi_resource.identity
  override_during = plan
  values = {
    id     = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/test/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test"
    output = { properties = { principalId = "33333333-3333-4333-8333-333333333333", clientId = "44444444-4444-4444-8444-444444444444" } }
  }
}

override_resource {
  target          = azapi_resource.storage
  override_during = plan
  values          = { id = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/test/providers/Microsoft.Storage/storageAccounts/teststorage" }
}
override_resource {
  target          = azuread_application_registration.bedrock
  override_during = plan
  values = {
    id        = "/applications/55555555-5555-4555-8555-555555555555"
    client_id = "66666666-6666-4666-8666-666666666666"
  }
}
override_resource {
  target          = aws_iam_openid_connect_provider.azure[0]
  override_during = plan
  values          = { arn = "arn:aws:iam::123456789012:oidc-provider/sts.windows.net/22222222-2222-4222-8222-222222222222/" }
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
    condition     = azapi_resource.identity.location == "eastus2" && azapi_resource.api.location == "eastus2" && azapi_resource.storage.location == "eastus2" && azapi_resource.web.location == "eastus2"
    error_message = "Use supported backend and static-hosting regions independently."
  }
  assert {
    condition     = azuread_application_registration.bedrock.requested_access_token_version == 1 && azuread_service_principal.bedrock.app_role_assignment_required && azuread_app_role_assignment.bedrock.principal_object_id == azapi_resource.identity.output.properties.principalId
    error_message = "Federation must use the assigned managed identity and a dedicated v1 audience."
  }
  assert {
    condition     = jsondecode(aws_iam_role.bedrock.assume_role_policy).Statement[0].Condition.StringEquals["${local.issuer_key}:sub"] == azapi_resource.identity.output.properties.principalId && jsondecode(aws_iam_role.bedrock.assume_role_policy).Statement[0].Condition.StringEquals["${local.issuer_key}:aud"] == azuread_application_identifier_uri.bedrock.identifier_uri
    error_message = "AWS trust must restrict both the subject and audience."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.bedrock.policy).Statement[0].Action == ["bedrock:InvokeModel"] && local.model_resources == ["arn:aws:bedrock:eu-west-2::foundation-model/amazon.nova-micro-v1:0"]
    error_message = "Grant only Bedrock invocation on the selected models."
  }
  assert {
    condition     = azapi_resource.storage.body.sku.name == "Standard_LRS" && !azapi_resource.storage.body.properties.allowBlobPublicAccess && !azapi_resource.storage.body.properties.allowSharedKeyAccess && azapi_resource.storage.body.properties.supportsHttpsTrafficOnly
    error_message = "Use private LRS storage with HTTPS and no shared keys."
  }
  assert {
    condition     = azapi_resource.web.body.sku.name == "Free" && azapi_resource.plan.body.sku.name == "FC1" && azapi_resource.api.body.properties.functionAppConfig.scaleAndConcurrency.instanceMemoryMB == 512 && !can(azapi_resource.api.body.properties.functionAppConfig.scaleAndConcurrency.alwaysReady)
    error_message = "Keep free static hosting and scale-to-zero Functions."
  }
  assert {
    condition     = azapi_resource.api.body.properties.httpsOnly && azapi_resource.api.body.properties.functionAppConfig.deployment.storage.authentication.type == "UserAssignedIdentity"
    error_message = "Use HTTPS and managed identity for storage."
  }
  assert {
    condition     = azuread_application_registration.browser.requested_access_token_version == 2 && azuread_application_registration.browser.sign_in_audience == "AzureADMyOrg" && azuread_application_permission_scope.api.value == "access_as_user"
    error_message = "Use single-tenant Entra authentication with v2 API access tokens."
  }
  assert {
    condition     = azapi_resource.storage_lock.body.properties.level == "CanNotDelete" && azapi_update_resource.blobs.body.properties.deleteRetentionPolicy.days == 7 && !azapi_update_resource.blobs.body.properties.isVersioningEnabled && endswith(azapi_update_resource.blobs.resource_id, "/blobServices/default")
    error_message = "Keep explicit data protection and bounded soft-delete retention."
  }
  assert {
    condition     = alltrue([for setting in azapi_resource.api.body.properties.siteConfig.appSettings : !can(regex("KEY$|SECRET$|CONNECTION_STRING$", setting.name))])
    error_message = "Do not configure runtime credential secrets."
  }
}

run "retain_existing_resource_group_location" {
  command = plan
  variables { resource_group_region = "westeurope" }
  assert {
    condition     = azapi_resource.group.location == "westeurope" && azapi_resource.api.location == "eastus2"
    error_message = "Moving uncreated workloads must not relocate the existing resource group."
  }
}

run "haiku_4_5_scoped_profile_and_models" {
  command = plan
  variables {
    model_id         = "arn:aws:bedrock:eu-west-2:123456789012:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0"
    extra_model_arns = ["arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0", "arn:aws:bedrock:eu-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"]
  }
  assert {
    condition     = toset(jsondecode(aws_iam_role_policy.bedrock.policy).Statement[0].Resource) == toset(concat([var.model_id], var.extra_model_arns))
    error_message = "Claude must receive exactly the selected profile and destination models."
  }
}

run "haiku_application_profile_uses_destination_metadata" {
  command = plan
  variables {
    model_id         = "arn:aws:bedrock:eu-west-2:123456789012:application-inference-profile/custom-id"
    extra_model_arns = ["arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"]
  }
  assert {
    condition     = local.haiku_4_5 && length(jsondecode(aws_iam_role_policy.bedrock.policy).Statement[0].Resource) == 2
    error_message = "Opaque application profiles must grant only the profile and destination models."
  }
}

run "reject_regional_haiku_4_5" {
  command = plan
  variables { model_id = "anthropic.claude-haiku-4-5-20251001-v1:0" }
  expect_failures = [aws_iam_role_policy.bedrock]
}

run "reject_wrong_profile_region" {
  command = plan
  variables {
    model_id         = "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
    extra_model_arns = ["arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"]
  }
  expect_failures = [aws_iam_role_policy.bedrock]
}

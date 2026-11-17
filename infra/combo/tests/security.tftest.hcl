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
    condition     = length(local.project_resources) == 0
    error_message = "Nova must not receive OpenAI project permissions."
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
    condition     = azapi_resource.storage_lock.body.properties.level == "CanNotDelete" && azapi_resource.blobs.body.properties.deleteRetentionPolicy.days == 7 && !azapi_resource.blobs.body.properties.isVersioningEnabled
    error_message = "Keep explicit data protection and bounded soft-delete retention."
  }
  assert {
    condition     = alltrue([for setting in azapi_resource.api.body.properties.siteConfig.appSettings : !can(regex("KEY$|SECRET$|CONNECTION_STRING$", setting.name))])
    error_message = "Do not configure runtime credential secrets."
  }
}

run "gpt6_sol_scoped_project_and_models" {
  command = plan
  variables {
    model_id         = "arn:aws:bedrock:eu-west-2:123456789012:inference-profile/global.openai.gpt-6-sol"
    extra_model_arns = ["arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-6-sol", "arn:aws:bedrock:us-west-2::foundation-model/openai.gpt-6-sol"]
  }
  assert {
    condition     = toset(jsondecode(aws_iam_role_policy.bedrock.policy).Statement[0].Resource) == toset(concat([var.model_id], var.extra_model_arns, ["arn:aws:bedrock:eu-west-2:123456789012:project/default"]))
    error_message = "GPT must receive exactly the selected profile, destination models and this account/region's default project."
  }
  assert {
    condition     = [for setting in azapi_resource.api.body.properties.siteConfig.appSettings : setting.value if setting.name == "BEDROCK_OPENAI_GPT"] == ["true"]
    error_message = "The runtime must receive the GPT request compatibility setting."
  }
}

run "gpt_application_profile_uses_destination_metadata" {
  command = plan
  variables {
    model_id         = "arn:aws:bedrock:eu-west-2:123456789012:application-inference-profile/custom-id"
    extra_model_arns = ["arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-6-sol"]
  }
  assert {
    condition     = local.openai_gpt && contains(jsondecode(aws_iam_role_policy.bedrock.policy).Statement[0].Resource, "arn:aws:bedrock:eu-west-2:123456789012:project/default")
    error_message = "Opaque application profile names must still receive GPT compatibility and project permissions."
  }
}

run "reject_regional_gpt" {
  command = plan
  variables { model_id = "openai.gpt-6-sol" }
  expect_failures = [aws_iam_role_policy.bedrock]
}

run "gpt_oss_remains_regional" {
  command = plan
  variables { model_id = "openai.gpt-oss-120b-1:0" }
  assert {
    condition     = !local.openai_gpt && length(local.project_resources) == 0
    error_message = "GPT OSS regional models must not receive frontier GPT profile requirements or project permissions."
  }
}

run "reject_wrong_profile_region" {
  command = plan
  variables {
    model_id         = "arn:aws:bedrock:us-east-1:123456789012:inference-profile/global.openai.gpt-6-sol"
    extra_model_arns = ["arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-6-sol"]
  }
  expect_failures = [aws_iam_role_policy.bedrock]
}


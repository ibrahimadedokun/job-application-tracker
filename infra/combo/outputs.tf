output "deployment" {
  value = {
    cloud               = "combo"
    federation_audience = azuread_application_identifier_uri.bedrock.identifier_uri
    web_url             = local.web_url
    runtime_config = {
      local     = false
      provider  = "azure"
      apiUrl    = "https://${azapi_resource.api.output.properties.defaultHostName}"
      authority = "https://login.microsoftonline.com/${var.tenant_id}/v2.0"
      clientId  = azuread_application_registration.browser.client_id
      scope     = "openid profile email api://${azuread_application_registration.browser.client_id}/access_as_user"
    }
    release = {
      resource_group  = azapi_resource.group.name
      api_name        = azapi_resource.api.name
      web_name        = azapi_resource.web.name
      subscription_id = var.subscription_id
      tenant_id       = var.tenant_id
    }
  }
}


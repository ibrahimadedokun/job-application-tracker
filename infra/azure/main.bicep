targetScope = 'resourceGroup'

@minLength(3)
@maxLength(20)
@description('Lowercase letters, digits and hyphens. Keep stable across deployments.')
param namePrefix string = 'folio'
param location string = 'westeurope'
param foundryLocation string = 'swedencentral'
param tenantId string = tenant().tenantId
@description('Application (client) ID created by setup-identity.ps1.')
param clientId string
@description('Object ID of the deployment user/service principal, for agent provisioning.')
param deployerPrincipalId string
@allowed(['User', 'ServicePrincipal'])
param deployerPrincipalType string = 'User'
param modelName string = 'gpt-4.1-nano'
param modelVersion string = '2025-04-14'
param modelDeploymentName string = 'tailoring'
@allowed(['GlobalStandard', 'Standard', 'DataZoneStandard'])
param modelSku string = 'GlobalStandard'
@minValue(1)
param modelCapacity int = 10
param agentName string = 'folio-tailoring'
@description('Optional monthly alert in the subscription billing currency. Zero disables it.')
@minValue(0)
param monthlyBudget int = 0
param budgetEmail string = ''
param protectStorage bool = true
param budgetStartDate string = '${utcNow('yyyy-MM')}-01T00:00:00Z'

var suffix = uniqueString(resourceGroup().id, namePrefix)
var tags = { application: 'folio', provider: 'azure' }
var blobOwnerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
var foundryUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-api-identity-${suffix}'
  location: location
  tags: tags
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'folio${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    isVersioningEnabled: false
  }
}
resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'applications'
  properties: { publicAccess: 'None' }
}
resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'function-packages'
  properties: { publicAccess: 'None' }
}
resource storageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, identity.id, blobOwnerRole)
  scope: storage
  properties: {
    roleDefinitionId: blobOwnerRole
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource storageLock 'Microsoft.Authorization/locks@2020-05-01' = if (protectStorage) {
  name: 'retain-application-data'
  scope: storage
  properties: {
    level: 'CanNotDelete'
    notes: 'Export application data and explicitly remove this lock before deleting storage or the resource group.'
  }
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: '${namePrefix}-ai-${suffix}'
  location: foundryLocation
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: '${namePrefix}-ai-${suffix}'
    allowProjectManagement: true
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundry
  name: 'folio'
  location: foundryLocation
  identity: { type: 'SystemAssigned' }
  properties: { displayName: 'Folio tailoring', description: 'Private CV and cover-letter prompt agent.' }
}
resource model 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundry
  name: modelDeploymentName
  sku: { name: modelSku, capacity: modelCapacity }
  properties: {
    model: { format: 'OpenAI', name: modelName, version: modelVersion }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}
resource apiFoundryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(project.id, identity.id, foundryUserRole)
  scope: project
  properties: {
    roleDefinitionId: foundryUserRole
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource deployerFoundryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(project.id, deployerPrincipalId, foundryUserRole)
  scope: project
  properties: {
    roleDefinitionId: foundryUserRole
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
  }
}

resource web 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${namePrefix}-web-${suffix}'
  location: location
  tags: tags
  sku: { name: 'Free', tier: 'Free' }
  properties: { allowConfigFileUpdates: true }
}
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${namePrefix}-plan-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}
resource api 'Microsoft.Web/sites@2024-04-01' = {
  name: '${namePrefix}-api-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${packages.name}'
          authentication: { type: 'UserAssignedIdentity', userAssignedIdentityResourceId: identity.id }
        }
      }
      runtime: { name: 'node', version: '22' }
      scaleAndConcurrency: {
        instanceMemoryMB: 512
        maximumInstanceCount: 40
        triggers: { http: { perInstanceConcurrency: 4 } }
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: { allowedOrigins: ['https://${web.properties.defaultHostname}'], supportCredentials: false }
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: identity.properties.clientId }
        { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
        { name: 'ENTRA_TENANT_ID', value: tenantId }
        { name: 'ENTRA_CLIENT_ID', value: clientId }
        { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
        { name: 'AZURE_STORAGE_CONTAINER', value: documents.name }
        { name: 'FOUNDRY_PROJECT_ENDPOINT', value: 'https://${foundry.name}.services.ai.azure.com/api/projects/${project.name}' }
        { name: 'FOUNDRY_AGENT_NAME', value: agentName }
      ]
    }
  }
  dependsOn: [storageRole, apiFoundryRole]
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (monthlyBudget > 0 && !empty(budgetEmail)) {
  name: '${namePrefix}-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: {
      actual: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        contactEmails: [budgetEmail]
        thresholdType: 'Actual'
      }
    }
  }
}

output webName string = web.name
output webUrl string = 'https://${web.properties.defaultHostname}'
output apiName string = api.name
output apiUrl string = 'https://${api.properties.defaultHostName}'
output storageName string = storage.name
output foundryName string = foundry.name
output projectEndpoint string = 'https://${foundry.name}.services.ai.azure.com/api/projects/${project.name}'
output deployedModel string = model.name
output deployedAgent string = agentName

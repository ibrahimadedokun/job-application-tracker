[CmdletBinding()]
param(
    [switch] $ValidateOnly,
    [string] $SubscriptionId = $env:AZURE_SUBSCRIPTION_ID,
    [ValidatePattern('^[a-z0-9][a-z0-9-]{2,19}$')][string] $NamePrefix = 'folio',
    [string] $ResourceGroup = 'folio-azure',
    [string] $Location = 'westeurope',
    [string] $FoundryLocation = 'swedencentral',
    [string] $ClientId = $env:ENTRA_CLIENT_ID,
    [string] $ModelName = 'gpt-4.1-nano',
    [string] $ModelVersion = '2025-04-14',
    [ValidateSet('GlobalStandard', 'Standard', 'DataZoneStandard')][string] $ModelSku = 'GlobalStandard',
    [ValidateRange(1, 1000)][int] $ModelCapacity = 10,
    [ValidateRange(0, 1000000)][int] $MonthlyBudget = 0,
    [string] $BudgetEmail = '',
    [string] $DeployerPrincipalId = '',
    [ValidateSet('User', 'ServicePrincipal')][string] $DeployerPrincipalType = 'User'
)
. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $RepoRoot
try {
    Invoke-BicepBuild
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Application tests failed.' }
    if ($ValidateOnly) {
        & node infra/azure/build.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Azure packaging failed.' }
        & node infra/azure/verify.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Azure infrastructure verification failed.' }
        Write-Host 'Azure local validation passed. No cloud resources were created.'
        return
    }
    $version = Invoke-AzJson -Arguments @('version')
    if ([version]$version.'azure-cli' -lt [version]'2.80.0') { throw 'Upgrade Azure CLI to 2.80.0 or later before deploying (az upgrade).' }
    if (!$SubscriptionId) { throw 'Set AZURE_SUBSCRIPTION_ID or pass -SubscriptionId to select the billing subscription explicitly.' }
    Invoke-AzJson -Arguments @('account', 'set', '--subscription', $SubscriptionId) | Out-Null
    $account = Invoke-AzJson -Arguments @('account', 'show')
    $identityFile = Join-Path $AzureOutput 'identity.json'
    if (!$ClientId -and (Test-Path -LiteralPath $identityFile)) {
        $saved = Get-Content -LiteralPath $identityFile -Raw | ConvertFrom-Json
        if ($saved.tenantId -ne $account.tenantId) { throw 'Saved identity and selected subscription have different tenants.' }
        $ClientId = $saved.clientId
    }
    if (!$ClientId) { throw 'Run npm run azure:identity first, or set ENTRA_CLIENT_ID to a dedicated app registration configured by setup-identity.ps1.' }
    $application = Invoke-AzJson -Arguments @('ad', 'app', 'show', '--id', $ClientId)
    if ($application.api.requestedAccessTokenVersion -ne 2 -or !($application.api.oauth2PermissionScopes | Where-Object { $_.value -eq 'access_as_user' -and $_.isEnabled })) {
        throw 'Configure this app registration using setup-identity.ps1 -ClientId YOUR_CLIENT_ID first.'
    }
    if (($MonthlyBudget -gt 0) -ne [bool]$BudgetEmail) { throw 'Supply both -MonthlyBudget and -BudgetEmail for cost alerts.' }
    if (!$DeployerPrincipalId) {
        if ($account.user.type -eq 'user') {
            $deployer = Invoke-AzJson -Arguments @('ad', 'signed-in-user', 'show')
            $DeployerPrincipalId = $deployer.id
            $DeployerPrincipalType = 'User'
        } else {
            $deployer = Invoke-AzJson -Arguments @('ad', 'sp', 'show', '--id', $account.user.name)
            $DeployerPrincipalId = $deployer.id
            $DeployerPrincipalType = 'ServicePrincipal'
        }
    }
    foreach ($provider in @('Microsoft.Web', 'Microsoft.Storage', 'Microsoft.ManagedIdentity', 'Microsoft.CognitiveServices')) {
        Invoke-AzJson -Arguments @('provider', 'register', '--namespace', $provider, '--wait') | Out-Null
    }
    Invoke-AzJson -Arguments @('group', 'create', '--name', $ResourceGroup, '--location', $Location) | Out-Null
    $parametersFile = Join-Path $AzureOutput 'parameters.json'
    $values = @{
        namePrefix = $NamePrefix; location = $Location; foundryLocation = $FoundryLocation
        tenantId = $account.tenantId; clientId = $ClientId
        deployerPrincipalId = $DeployerPrincipalId; deployerPrincipalType = $DeployerPrincipalType
        modelName = $ModelName; modelVersion = $ModelVersion; modelSku = $ModelSku; modelCapacity = $ModelCapacity
        monthlyBudget = $MonthlyBudget; budgetEmail = $BudgetEmail
    }
    $parameters = @{}
    foreach ($entry in $values.GetEnumerator()) { $parameters[$entry.Key] = @{ value = $entry.Value } }
    Write-AzureJson $parametersFile @{ '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'; contentVersion = '1.0.0.0'; parameters = $parameters }
    # Use the compiled template so deployment does not depend on a second Bicep installation.
    $deployment = Invoke-AzJson -Arguments @('deployment', 'group', 'create', '--name', "$NamePrefix-deployment", '--resource-group', $ResourceGroup, '--template-file', (Join-Path $AzureOutput 'main.json'), '--parameters', "@$parametersFile", '--mode', 'Incremental')
    $outputs = $deployment.properties.outputs
    Write-AzureJson (Join-Path $AzureOutput 'outputs.json') $outputs
    $webUrl = $outputs.webUrl.value
    # Retain existing custom-domain callbacks while adding the Azure default hostname.
    $callbacks = @($application.spa.redirectUris) + @("$webUrl/") | Where-Object { $_ } | Select-Object -Unique
    Invoke-GraphBody 'PATCH' "https://graph.microsoft.com/v1.0/applications/$($application.id)" @{ spa = @{ redirectUris = @($callbacks) } } | Out-Null
    $agentFile = Join-Path $AzureOutput 'agent.json'
    & node infra/azure/provision-agent.mjs $outputs.projectEndpoint.value $outputs.deployedAgent.value $outputs.deployedModel.value $agentFile
    if ($LASTEXITCODE -ne 0) { throw 'Foundry agent provisioning failed. Check Foundry roles and model quota, then rerun deployment.' }
    $agent = Get-Content -LiteralPath $agentFile -Raw | ConvertFrom-Json
    Invoke-AzJson -Arguments @('functionapp', 'config', 'appsettings', 'set', '--resource-group', $ResourceGroup, '--name', $outputs.apiName.value, '--settings', "FOUNDRY_AGENT_VERSION=$($agent.version)") | Out-Null
    $runtimeFile = Join-Path $AzureOutput 'runtime-config.json'
    Write-AzureJson $runtimeFile @{
        local = $false; provider = 'azure'; apiUrl = $outputs.apiUrl.value
        authority = "https://login.microsoftonline.com/$($account.tenantId)/v2.0"
        clientId = $ClientId; scope = "openid profile email api://$ClientId/access_as_user"
    }
    & node infra/azure/build.mjs --config $runtimeFile
    if ($LASTEXITCODE -ne 0) { throw 'Azure packaging failed.' }
    & node infra/azure/verify.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Azure infrastructure verification failed.' }
    $zip = Join-Path $AzureOutput 'api.zip'
    Compress-Archive -Path (Join-Path $AzureOutput 'api/*') -DestinationPath $zip -Force
    Invoke-AzJson -Arguments @('functionapp', 'deployment', 'source', 'config-zip', '--resource-group', $ResourceGroup, '--name', $outputs.apiName.value, '--src', $zip, '--build-remote', 'false') | Out-Null
    $previousToken = $env:SWA_CLI_DEPLOYMENT_TOKEN
    try {
        $secrets = Invoke-AzJson -Arguments @('staticwebapp', 'secrets', 'list', '--resource-group', $ResourceGroup, '--name', $outputs.webName.value)
        $env:SWA_CLI_DEPLOYMENT_TOKEN = $secrets.properties.apiKey
        # Install this deployment tool in npm's cache, outside the app dependency tree.
        & npx --yes '@azure/static-web-apps-cli@2.1.0' deploy (Join-Path $AzureOutput 'web') --env production --no-use-keychain
        if ($LASTEXITCODE -ne 0) { throw 'Static Web App upload failed.' }
    } finally {
        $env:SWA_CLI_DEPLOYMENT_TOKEN = $previousToken
        $secrets = $null
    }
    Write-Host "Deployment uploaded. Open $webUrl and complete the verification checklist in infra/azure/README.md."
} finally {
    Pop-Location
}

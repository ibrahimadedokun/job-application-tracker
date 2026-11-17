[CmdletBinding()]
param([Parameter(Mandatory)][string] $OutputsFile, [Parameter(Mandatory)][string] $Artifacts)
. (Join-Path $PSScriptRoot 'common.ps1')
$deployment = Get-Content -LiteralPath $OutputsFile -Raw | ConvertFrom-Json
if ($deployment.cloud -ne 'azure') { throw 'Expected Azure Terraform outputs.' }
$release = $deployment.release
Invoke-AzJson -Arguments @('account', 'set', '--subscription', $release.subscription_id) | Out-Null
$account = Invoke-AzJson -Arguments @('account', 'show')
if ($account.tenantId -ne $release.tenant_id) { throw 'Azure CLI and Terraform target tenants differ.' }
$version = Invoke-AzJson -Arguments @('version')
if ([version]$version.'azure-cli' -lt [version]'2.80.0') { throw 'Upgrade Azure CLI to at least 2.80.0 for Functions publishing.' }
$agentFile = Join-Path $Artifacts 'agent.json'
& node infra/azure/provision-agent.mjs $release.project_endpoint $release.agent_name $release.model_deployment $agentFile
if ($LASTEXITCODE -ne 0) { throw 'Foundry agent provisioning failed. Resolve model quota/RBAC and rerun npm run deploy:publish.' }
& node infra/azure/build.mjs --config (Join-Path $Artifacts 'runtime-config.json') --output $Artifacts --agent-config $agentFile
if ($LASTEXITCODE -ne 0) { throw 'Azure packaging failed.' }
& node infra/azure/verify.mjs --output $Artifacts
if ($LASTEXITCODE -ne 0) { throw 'Azure package validation failed.' }
$zip = Join-Path $Artifacts 'api.zip'
Compress-Archive -Path (Join-Path $Artifacts 'api/*') -DestinationPath $zip -Force
Invoke-AzJson -Arguments @('functionapp', 'deployment', 'source', 'config-zip', '--resource-group', $release.resource_group, '--name', $release.api_name, '--src', $zip, '--build-remote', 'false') | Out-Null
$previousToken = $env:SWA_CLI_DEPLOYMENT_TOKEN
try {
    $secrets = Invoke-AzJson -Arguments @('staticwebapp', 'secrets', 'list', '--resource-group', $release.resource_group, '--name', $release.web_name)
    $env:SWA_CLI_DEPLOYMENT_TOKEN = $secrets.properties.apiKey
    & npx --yes '@azure/static-web-apps-cli@2.1.0' deploy (Join-Path $Artifacts 'web') --env production --no-use-keychain
    if ($LASTEXITCODE -ne 0) { throw 'Static Web App publishing failed.' }
} finally {
    $env:SWA_CLI_DEPLOYMENT_TOKEN = $previousToken
    $secrets = $null
}

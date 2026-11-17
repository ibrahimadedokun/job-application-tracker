[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $SubscriptionId,
    [Parameter(Mandatory)][string] $TenantId,
    [Parameter(Mandatory)][string] $Region,
    [Parameter(Mandatory)][string] $StaticWebRegion,
    [Parameter(Mandatory)][string] $ResourceGroup,
    [Parameter(Mandatory)][string] $ValidationTemplate,
    [switch] $ValidateOnly
)
. (Join-Path $PSScriptRoot '../azure/common.ps1')
$version = Invoke-AzJson -Arguments @('version')
if ([version]$version.'azure-cli' -lt [version]'2.80.0') { throw 'Upgrade Azure CLI to at least 2.80.0 before creating resources, for Functions publishing.' }
Invoke-AzJson -Arguments @('account', 'set', '--subscription', $SubscriptionId) | Out-Null
$account = Invoke-AzJson -Arguments @('account', 'show')
if ($account.tenantId -ne $TenantId) { throw 'Azure CLI and Terraform target tenants differ.' }
foreach ($provider in @('Microsoft.Web', 'Microsoft.Storage', 'Microsoft.ManagedIdentity')) {
    if (-not $ValidateOnly) {
        Invoke-AzJson -Arguments @('provider', 'register', '--namespace', $provider, '--wait') | Out-Null
    }
}
$flexLocations = Invoke-AzJson -Arguments @('functionapp', 'list-flexconsumption-locations', '--subscription', $SubscriptionId)
if ($Region -notin @($flexLocations | ForEach-Object { $_.name })) { throw "Functions Flex Consumption is unavailable in '$Region'. Select an available backend region." }
foreach ($check in @(
    @{ Provider = 'Microsoft.Web'; ResourceType = 'staticSites'; Region = $StaticWebRegion },
    @{ Provider = 'Microsoft.ManagedIdentity'; ResourceType = 'userAssignedIdentities'; Region = $Region },
    @{ Provider = 'Microsoft.Storage'; ResourceType = 'storageAccounts'; Region = $Region }
)) {
    $providerInfo = Invoke-AzJson -Arguments @('provider', 'show', '--subscription', $SubscriptionId, '--namespace', $check.Provider)
    $resourceInfo = $providerInfo.resourceTypes | Where-Object { $_.resourceType -eq $check.ResourceType }
    $locations = @($resourceInfo.locations | ForEach-Object { ($_ -replace '\s', '').ToLowerInvariant() })
    if ($check.Region -notin $locations) { throw "$($check.Provider)/$($check.ResourceType) does not support '$($check.Region)'. Choose its region separately from other services." }
}
$groupExists = Invoke-AzJson -Arguments @('group', 'exists', '--subscription', $SubscriptionId, '--name', $ResourceGroup)
if ($groupExists) {
    Invoke-AzJson -Arguments @('deployment', 'group', 'validate', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', 'folio-region-check', '--template-file', $ValidationTemplate, '--validation-level', 'Provider') | Out-Null
    Write-Host "Azure provider validation passed: backend $Region; Static Web Apps $StaticWebRegion."
} else {
    Write-Host 'Service region availability checked. Subscription eligibility will be checked by Azure when the new resource group is deployed.'
}


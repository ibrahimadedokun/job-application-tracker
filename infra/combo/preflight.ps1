[CmdletBinding()]
param([Parameter(Mandatory)][string] $SubscriptionId, [Parameter(Mandatory)][string] $TenantId)
. (Join-Path $PSScriptRoot '../azure/common.ps1')
$version = Invoke-AzJson -Arguments @('version')
if ([version]$version.'azure-cli' -lt [version]'2.80.0') { throw 'Upgrade Azure CLI to at least 2.80.0 before creating resources, for Functions publishing.' }
Invoke-AzJson -Arguments @('account', 'set', '--subscription', $SubscriptionId) | Out-Null
$account = Invoke-AzJson -Arguments @('account', 'show')
if ($account.tenantId -ne $TenantId) { throw 'Azure CLI and Terraform target tenants differ.' }
foreach ($provider in @('Microsoft.Web', 'Microsoft.Storage', 'Microsoft.ManagedIdentity')) {
    Invoke-AzJson -Arguments @('provider', 'register', '--namespace', $provider, '--wait') | Out-Null
}


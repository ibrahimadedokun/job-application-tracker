[CmdletBinding()]
param(
    [string] $DisplayName = 'Folio Azure',
    [string] $ClientId = $env:ENTRA_CLIENT_ID
)
. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $RepoRoot
try {
    $account = Invoke-AzJson -Arguments @('account', 'show')
    $identityFile = Join-Path $AzureOutput 'identity.json'
    if (!$ClientId -and (Test-Path -LiteralPath $identityFile)) {
        $saved = Get-Content -LiteralPath $identityFile -Raw | ConvertFrom-Json
        if ($saved.tenantId -ne $account.tenantId) { throw 'Saved identity belongs to another tenant. Choose the correct az account or pass -ClientId explicitly.' }
        $ClientId = $saved.clientId
    }
    if ($ClientId) {
        $application = Invoke-AzJson -Arguments @('ad', 'app', 'show', '--id', $ClientId)
        if ($application.signInAudience -ne 'AzureADMyOrg') { throw 'Use a dedicated single-tenant Folio app registration.' }
    } else {
        $application = Invoke-GraphBody 'POST' 'https://graph.microsoft.com/v1.0/applications' @{
            displayName = $DisplayName
            signInAudience = 'AzureADMyOrg'
        }
    }
    $scope = @($application.api.oauth2PermissionScopes | Where-Object value -eq 'access_as_user') | Select-Object -First 1
    $scopeId = if ($scope) { $scope.id } else { [guid]::NewGuid().ToString() }
    $scopeDefinition = @{
        id = $scopeId; value = 'access_as_user'; type = 'User'; isEnabled = $true
        adminConsentDisplayName = 'Access your Folio workspace'
        adminConsentDescription = 'Read and update the signed-in user''s job applications and generate documents.'
        userConsentDisplayName = 'Access your Folio workspace'
        userConsentDescription = 'Read and update your applications and generate documents.'
    }
    # This is a dedicated public SPA/API registration. No client secret is created.
    $scopes = @($application.api.oauth2PermissionScopes | Where-Object value -ne 'access_as_user') + @($scopeDefinition)
    Invoke-GraphBody 'PATCH' "https://graph.microsoft.com/v1.0/applications/$($application.id)" @{
        identifierUris = @("api://$($application.appId)")
        api = @{
            requestedAccessTokenVersion = 2
            oauth2PermissionScopes = $scopes
        }
    } | Out-Null
    $principals = Invoke-AzJson -Arguments @('ad', 'sp', 'list', '--filter', "appId eq '$($application.appId)'")
    if (!$principals) { Invoke-AzJson -Arguments @('ad', 'sp', 'create', '--id', $application.appId) | Out-Null }
    Write-AzureJson $identityFile @{ tenantId = $account.tenantId; clientId = $application.appId; objectId = $application.id; scopeId = $scopeId }
    Write-Host "Entra registration ready: $($application.appId). Saved non-secret IDs to .local/azure/identity.json."
} finally {
    Pop-Location
}

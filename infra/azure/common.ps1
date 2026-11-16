$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$AzureOutput = Join-Path $RepoRoot '.local/azure'
New-Item -ItemType Directory -Path $AzureOutput -Force | Out-Null

function Invoke-AzJson {
    param([Parameter(Mandatory)][string[]] $Arguments)
    $result = & az @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: az $($Arguments[0]) $($Arguments[1])." }
    if ($result) { return ($result | Out-String | ConvertFrom-Json) }
}

function Invoke-BicepBuild {
    $localBicep = Join-Path $RepoRoot '.local/azure-cli/bin/bicep.exe'
    $template = Join-Path $PSScriptRoot 'main.bicep'
    $output = Join-Path $AzureOutput 'main.json'
    if (Test-Path -LiteralPath $localBicep) {
        & $localBicep build $template --outfile $output
    } else {
        & az bicep build --file $template --outfile $output
    }
    if ($LASTEXITCODE -ne 0) { throw 'Bicep compilation failed. Install Bicep with: az bicep install' }
}

function Write-AzureJson {
    param([string] $Path, $Value)
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}

function Invoke-GraphBody {
    param([string] $Method, [string] $Url, $Body)
    $bodyFile = Join-Path $AzureOutput 'graph-request.json'
    try {
        Write-AzureJson $bodyFile $Body
        Invoke-AzJson -Arguments @('rest', '--method', $Method, '--url', $Url, '--body', "@$bodyFile", '--headers', 'Content-Type=application/json')
    } finally {
        Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue
    }
}

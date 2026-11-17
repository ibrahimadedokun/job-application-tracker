$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Invoke-AzJson {
    param([Parameter(Mandatory)][string[]] $Arguments)
    $result = & az @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: az $($Arguments[0]) $($Arguments[1])." }
    if ($result) { return ($result | Out-String | ConvertFrom-Json) }
}

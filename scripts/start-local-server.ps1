param(
    [string]$Database = 'formation_inspection',
    [string]$BindAddress = '127.0.0.1',
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $env:LOCALAPPDATA 'FormationInspection\postgres-local-credentials.json'
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Local database credentials were not found.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found. Install an approved Node.js LTS version.' }
$secrets = Get-Content -LiteralPath $secretPath -Raw -Encoding UTF8 | ConvertFrom-Json
$secure = ConvertTo-SecureString $secrets.app
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
try {
    $env:PGHOST = '127.0.0.1'
    $env:PGPORT = '5432'
    $env:PGDATABASE = $Database
    $env:PGUSER = 'formation_app'
    $env:PGPASSWORD = $password
    $env:FORMATION_HOST = $BindAddress
    $env:FORMATION_PORT = [string]$Port
    Set-Location -LiteralPath $project
    & node 'server\index.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Formation server stopped with an error.' }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null
}
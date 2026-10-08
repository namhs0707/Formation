param(
    [string]$Database = 'formation_ir_demo'
)

# Adds dummy records for every page to a local test database (see seed-demo-data.mjs).
# Connects as the postgres administrator because backdating records needs UPDATE, which the app role does not have.
$ErrorActionPreference = 'Stop'
if ($Database -eq 'formation_inspection') { throw 'Demo data is for test databases only.' }
$project = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $env:LOCALAPPDATA 'FormationInspection\postgres-local-credentials.json'
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Local database credentials were not found.' }
$secrets = Get-Content -LiteralPath $secretPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR((ConvertTo-SecureString $secrets.admin))
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
try {
    $env:PGHOST = '127.0.0.1'
    $env:PGPORT = '5432'
    $env:PGDATABASE = $Database
    $env:PGUSER = 'postgres'
    $env:PGPASSWORD = $password
    Set-Location -LiteralPath $project
    & node 'scripts\seed-demo-data.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Adding demo data failed.' }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null
}

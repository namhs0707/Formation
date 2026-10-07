# Developer check on this PC: builds a throwaway database, runs the schema twice and the smoke test,
# creates a test administrator, starts the server and runs server/test-api.mjs and server/test-auth.mjs.
# The real formation_inspection database is never touched, and the test database is dropped at the end.
# Needs local PostgreSQL 18 and the credentials saved by the local setup (LOCALAPPDATA\FormationInspection).
param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin', [int]$Port = 3011)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$psql = Join-Path $PostgresBin 'psql.exe'
$testDb = 'formation_vm_test'
$env:PGOPTIONS = '-c client_min_messages=warning'
$secrets = Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'FormationInspection\postgres-local-credentials.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Reveal($encrypted) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR((ConvertTo-SecureString $encrypted))
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$admin = Reveal $secrets.admin
$app = Reveal $secrets.app
$server = $null
$log = Join-Path $env:TEMP 'formation-test-server.log'
try {
    $env:PGPASSWORD = $admin
    & $psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -c "DROP DATABASE IF EXISTS $testDb;" -c "CREATE DATABASE $testDb;"
    foreach ($run in 1, 2) {
        & $psql -X -q -v ON_ERROR_STOP=1 -1 -h 127.0.0.1 -U postgres -d $testDb -f (Join-Path $repo 'database\001_initial.sql')
        if ($LASTEXITCODE) { throw "Schema run $run failed." }
    }
    $env:PGPASSWORD = $app
    & $psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U formation_app -d $testDb -f (Join-Path $repo 'database\002_smoke_test.sql') | Out-Null
    if ($LASTEXITCODE) { throw 'Smoke test failed.' }
    Write-Host 'Schema (twice) and smoke test passed.'

    $env:PGDATABASE = $testDb; $env:PGUSER = 'formation_app'; $env:FORMATION_PORT = [string]$Port
    $env:FORMATION_ADMIN_ID = 'admin.test'; $env:FORMATION_ADMIN_NAME = 'Test Admin'; $env:FORMATION_ADMIN_PASSWORD = 'AdminPass2026'
    Push-Location $repo
    node server/create-admin.mjs
    Remove-Item Env:FORMATION_ALLOW_HTTP_LOGIN -ErrorAction SilentlyContinue
    $server = Start-Process node -ArgumentList 'server/index.mjs' -WorkingDirectory $repo -PassThru -NoNewWindow -RedirectStandardError $log
    Start-Sleep -Seconds 3
    $env:TEST_API_URL = "http://127.0.0.1:$Port"
    $env:TEST_ADMIN_ID = 'admin.test'; $env:TEST_ADMIN_PASSWORD = 'AdminPass2026'
    node server/test-api.mjs
    if ($LASTEXITCODE) { throw 'server/test-api.mjs failed.' }
    node server/test-auth.mjs
    if ($LASTEXITCODE) { throw 'server/test-auth.mjs failed.' }
    Pop-Location
    Write-Host 'All tests passed.'
} finally {
    if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }
    $env:PGPASSWORD = $admin
    & $psql -X -q -h 127.0.0.1 -U postgres -d postgres -c "DROP DATABASE IF EXISTS $testDb WITH (FORCE);"
    Remove-Item Env:PGPASSWORD, Env:FORMATION_ADMIN_PASSWORD, Env:TEST_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Write-Host "Test database dropped. Server errors, if any: $log"
}

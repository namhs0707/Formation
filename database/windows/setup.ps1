param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$psql = Join-Path $PostgresBin 'psql.exe'
if (-not (Test-Path -LiteralPath $psql)) {
    throw "psql.exe was not found in $PostgresBin"
}

$dbDir = Split-Path -Parent $PSScriptRoot
$bootstrap = Join-Path $dbDir '000_bootstrap.psql'
$schema = Join-Path $dbDir '001_initial.sql'
$smokeTest = Join-Path $dbDir '002_smoke_test.sql'

Write-Host '1/3 Creating the application role and database.'
Write-Host 'PostgreSQL will ask for the postgres password and a new formation_app password.'
& $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d postgres -f $bootstrap
if ($LASTEXITCODE -ne 0) { throw 'Database bootstrap failed.' }

Write-Host '2/3 Creating Formation Inspection tables and indexes.'
& $psql -X -v ON_ERROR_STOP=1 -1 -h 127.0.0.1 -p $Port -U postgres -d formation_inspection -f $schema
if ($LASTEXITCODE -ne 0) { throw 'Database schema creation failed.' }

Write-Host '3/3 Checking application permissions with sample rows that will be rolled back.'
& $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U formation_app -d formation_inspection -f $smokeTest
if ($LASTEXITCODE -ne 0) { throw 'Database verification failed.' }

Write-Host 'Formation Inspection database setup completed.'

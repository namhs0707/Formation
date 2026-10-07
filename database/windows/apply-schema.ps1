param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [int]$Port = 5432
)

# Applies table changes from a new app version to an existing database. Existing records are kept and
# the formation_app password is not touched (unlike setup.ps1, which is for the first installation).
$ErrorActionPreference = 'Stop'
$psql = Join-Path $PostgresBin 'psql.exe'
if (-not (Test-Path -LiteralPath $psql)) {
    throw "psql.exe was not found in $PostgresBin"
}

$schema = Join-Path (Split-Path -Parent $PSScriptRoot) '001_initial.sql'
Write-Host 'Updating Formation Inspection tables. PostgreSQL will ask for the postgres password.'
& $psql -X -v ON_ERROR_STOP=1 -1 -q -h 127.0.0.1 -p $Port -U postgres -d formation_inspection -f $schema
if ($LASTEXITCODE -ne 0) { throw 'Table update failed. No changes were applied.' }
Write-Host 'Table update completed. Existing records were kept.'

param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$createdb = Join-Path $PostgresBin 'createdb.exe'
$pgRestore = Join-Path $PostgresBin 'pg_restore.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
foreach ($tool in @($createdb, $pgRestore, $psql)) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "PostgreSQL tool not found: $tool" }
}
if (-not (Test-Path -LiteralPath $BackupFile)) { throw "Backup file not found: $BackupFile" }

$testDb = 'formation_restore_test_{0}' -f (Get-Date -Format 'yyyyMMdd_HHmmss')
Write-Host "Creating a separate restore test database: $testDb"
& $createdb -h 127.0.0.1 -p $Port -U postgres -T template0 $testDb
if ($LASTEXITCODE -ne 0) { throw 'Could not create the restore test database.' }

& $pgRestore --exit-on-error --no-owner -h 127.0.0.1 -p $Port -U postgres -d $testDb $BackupFile
if ($LASTEXITCODE -ne 0) { throw "Restore failed. Inspect test database $testDb; production was not changed." }

& $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d $testDb -c "SELECT 'appearance' AS category, count(*) AS records FROM formation.appearance_inspections UNION ALL SELECT 'startup', count(*) FROM formation.startup_checks UNION ALL SELECT 'ip', count(*) FROM formation.ip_checks;"
if ($LASTEXITCODE -ne 0) { throw "Restore verification failed in $testDb" }

Write-Host "Restore test completed in $testDb. Production was not changed."

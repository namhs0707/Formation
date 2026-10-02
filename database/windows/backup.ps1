param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [string]$BackupDir = 'C:\FormationBackups',
    [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$pgDump = Join-Path $PostgresBin 'pg_dump.exe'
$pgRestore = Join-Path $PostgresBin 'pg_restore.exe'
if (-not (Test-Path -LiteralPath $pgDump) -or -not (Test-Path -LiteralPath $pgRestore)) {
    throw "pg_dump.exe or pg_restore.exe was not found in $PostgresBin"
}

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
$backupFile = Join-Path $BackupDir ('formation_inspection_{0}.dump' -f (Get-Date -Format 'yyyyMMdd_HHmmss'))

& $pgDump -h 127.0.0.1 -p $Port -U postgres -d formation_inspection -Fc -f $backupFile
if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }

& $pgRestore -l $backupFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Backup file could not be read by pg_restore.' }

Write-Host "Backup created: $backupFile"
Write-Host 'Keep a copy on approved storage outside the VM and test a restore regularly.'

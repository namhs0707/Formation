param(
    [ValidateSet('Tables', 'Shell', 'CopyAppPassword', 'CopyAdminPassword')]
    [string]$Action = 'Tables'
)

$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$secretPath = Join-Path $env:LOCALAPPDATA 'FormationInspection\postgres-local-credentials.json'
if (-not (Test-Path -LiteralPath $psql)) { throw 'Local PostgreSQL 18 was not found.' }
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Local database credentials were not found.' }

$secrets = Get-Content -LiteralPath $secretPath -Raw -Encoding UTF8 | ConvertFrom-Json
$encryptedPassword = if ($Action -eq 'CopyAdminPassword') { $secrets.admin } else { $secrets.app }
$secure = ConvertTo-SecureString $encryptedPassword
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}

try {
    if ($Action -eq 'CopyAppPassword' -or $Action -eq 'CopyAdminPassword') {
        Set-Clipboard -Value $password
        $role = if ($Action -eq 'CopyAdminPassword') { 'postgres administrator' } else { 'formation_app' }
        Write-Host "$role password copied. Paste it into pgAdmin, then return here and press Enter to clear the clipboard."
        [void][Console]::ReadLine()
        Set-Clipboard -Value ''
        return
    }

    $env:PGPASSWORD = $password
    if ($Action -eq 'Shell') {
        Write-Host 'Connected as formation_app. Try: \dt formation.* or \d formation.startup_checks. Use \q to exit.'
        & $psql -X -h 127.0.0.1 -p 5432 -U formation_app -d formation_inspection
    } else {
        & $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U formation_app -d formation_inspection -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'formation' AND table_type = 'BASE TABLE' ORDER BY table_name;"
    }
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL command failed.' }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null
}

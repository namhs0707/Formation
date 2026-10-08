# Creates the Formation administrator account (or resets it). Run on the VM with the same Windows account
# that saved the app database password (save-vm-app-password.ps1).
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $env:LOCALAPPDATA 'FormationInspection\postgres-vm-app-credentials.json'
if (-not (Test-Path -LiteralPath $secretPath)) {
    throw 'VM app password is not saved. Run scripts\save-vm-app-password.ps1 on the VM first.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found.' }

function Reveal([Security.SecureString]$secure) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$loginId = Read-Host 'Administrator ID (3-40 letters, numbers, . _ -)'
$displayName = Read-Host 'Administrator name'
$first = Reveal (Read-Host 'Password (10+ characters, letters and numbers)' -AsSecureString)
$second = Reveal (Read-Host 'Password again' -AsSecureString)
if ($first -cne $second) { throw 'The passwords do not match.' }
$approvalRef = Read-Host 'E-approval document number (press Enter if none)'

$secrets = Get-Content -LiteralPath $secretPath -Raw -Encoding UTF8 | ConvertFrom-Json
try {
    $env:PGHOST = '127.0.0.1'
    $env:PGPORT = '5432'
    $env:PGDATABASE = 'formation_inspection'
    $env:PGUSER = 'formation_app'
    $env:PGPASSWORD = Reveal (ConvertTo-SecureString $secrets.app)
    $env:FORMATION_ADMIN_ID = $loginId
    $env:FORMATION_ADMIN_NAME = $displayName
    $env:FORMATION_ADMIN_PASSWORD = $first
    $env:FORMATION_ADMIN_APPROVAL_REF = $approvalRef
    Set-Location -LiteralPath $project
    & node 'server\create-admin.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Administrator account was not created.' }
} finally {
    Remove-Item Env:PGPASSWORD, Env:FORMATION_ADMIN_PASSWORD, Env:FORMATION_ADMIN_ID, Env:FORMATION_ADMIN_NAME, Env:FORMATION_ADMIN_APPROVAL_REF -ErrorAction SilentlyContinue
    $first = $null; $second = $null
}

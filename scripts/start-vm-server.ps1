param(
    [string]$BindAddress = '0.0.0.0',
    [int]$Port = 3000,
    # Testing only: allows sign-in over plain HTTP, which sends passwords unencrypted. Use HTTPS (IIS) in production.
    [switch]$AllowHttpLogin
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $env:LOCALAPPDATA 'FormationInspection\postgres-vm-app-credentials.json'
if (-not (Test-Path -LiteralPath $secretPath)) {
    throw 'VM app password is not saved. Run scripts\save-vm-app-password.ps1 on the VM first.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found.' }
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
    $env:PGDATABASE = 'formation_inspection'
    $env:PGUSER = 'formation_app'
    $env:PGPASSWORD = $password
    $env:FORMATION_HOST = $BindAddress
    $env:FORMATION_PORT = [string]$Port
    if ($AllowHttpLogin) {
        $env:FORMATION_ALLOW_HTTP_LOGIN = '1'
        Write-Warning 'Sign-in over HTTP is enabled for testing. Passwords are sent unencrypted.'
    } else {
        Remove-Item Env:FORMATION_ALLOW_HTTP_LOGIN -ErrorAction SilentlyContinue
    }
    Set-Location -LiteralPath $project
    & node 'server\index.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Formation server stopped with an error.' }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null
}
$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'FormationInspection'
$path = Join-Path $folder 'postgres-vm-app-credentials.json'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$secure = Read-Host 'Enter the formation_app database password for this VM' -AsSecureString
if (-not $secure.Length) { throw 'Password cannot be empty.' }
$data = @{ app = ConvertFrom-SecureString $secure } | ConvertTo-Json
[IO.File]::WriteAllText($path, $data, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'VM app password saved for this Windows account using Windows encryption.'
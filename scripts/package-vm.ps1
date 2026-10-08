$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stage = [IO.Path]::GetFullPath((Join-Path $project '.vm-app-stage'))
$expectedStage = $project.TrimEnd('\') + '\.vm-app-stage'
if ($stage -ne $expectedStage) { throw 'Unexpected package stage path.' }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
$pgVersion = (Get-Content -Raw -Encoding UTF8 (Join-Path $project 'node_modules\pg\package.json') | ConvertFrom-Json).version
$manifest = @{
    name = 'formation-vm-app'
    version = '1.0.0'
    private = $true
    type = 'module'
    scripts = @{ start = 'node server/index.mjs' }
    dependencies = @{ pg = $pgVersion }
} | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $stage 'package.json'), $manifest, (New-Object System.Text.UTF8Encoding($false)))
New-Item -ItemType Directory -Path (Join-Path $stage 'server'), (Join-Path $stage 'scripts') | Out-Null
# Every server module except the test scripts, so new modules are never left out of the package.
Get-ChildItem -LiteralPath (Join-Path $project 'server') -Filter '*.mjs' | Where-Object { $_.Name -notlike 'test-*' } | Copy-Item -Destination (Join-Path $stage 'server')
Copy-Item -LiteralPath (Join-Path $project 'public') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $project 'database') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $project 'scripts\start-vm-server.ps1'), (Join-Path $project 'scripts\save-vm-app-password.ps1'), (Join-Path $project 'scripts\create-admin.ps1') -Destination (Join-Path $stage 'scripts')
Copy-Item -LiteralPath (Join-Path $project 'VM-APP.ko.md') -Destination $stage
& npm install --prefix $stage --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'VM runtime dependency installation failed.' }
$archive = Join-Path $project 'Formation-VM-App.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -Force
if (-not (Test-Path -LiteralPath $archive)) { throw 'VM archive was not created.' }
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Host ('VM package created: ' + $archive)

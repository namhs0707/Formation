$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceFile = Join-Path $projectRoot 'Code.gs'
$claspFile = Join-Path $projectRoot 'apps-script\Code.js'
$deploymentId = 'AKfycby4_P_F818omnp_ytln0JQnF4OIwlvdPBElUwHOQLS-Lrr2wJhc_eDv7KR72nluYLWW'
$description = 'Automated deployment ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

if (-not (Test-Path -LiteralPath $sourceFile)) {
  throw "Code.gs was not found: $sourceFile"
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.clasp.json'))) {
  throw '.clasp.json was not found. Run clasp clone before deploying.'
}

Copy-Item -LiteralPath $sourceFile -Destination $claspFile -Force

Push-Location $projectRoot
try {
  clasp push --force
  if ($LASTEXITCODE -ne 0) { throw 'clasp push failed.' }

  clasp deploy --deploymentId $deploymentId --description $description
  if ($LASTEXITCODE -ne 0) { throw 'clasp deploy failed.' }

  Write-Host 'Apps Script deployment completed.'
  Write-Host "Web app URL: https://script.google.com/macros/s/$deploymentId/exec"
} finally {
  Pop-Location
}

$ErrorActionPreference = "Stop"

$bundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$composePath = Join-Path $bundleDir "docker-compose.offline.yml"

function Assert-LastExitCode {
  param(
    [string]$Step
  )

  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Checking Docker daemon..."
docker version | Out-Null
Assert-LastExitCode "Docker daemon check"

if (-not (Test-Path $composePath)) {
  throw "Compose file not found: $composePath"
}

Write-Host "Stopping OpenReel offline container"
docker compose -f $composePath down
Assert-LastExitCode "docker compose down"

Write-Host "OpenReel offline container stopped."

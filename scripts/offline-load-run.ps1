$ErrorActionPreference = "Stop"

$bundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tarPath = Join-Path $bundleDir "openreel-offline.tar"
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

if (-not (Test-Path $tarPath)) {
  throw "Offline image archive not found: $tarPath"
}

if (-not (Test-Path $composePath)) {
  throw "Compose file not found: $composePath"
}

Write-Host "Loading Docker image from: $tarPath"
docker load -i $tarPath
Assert-LastExitCode "docker load"

Write-Host "Starting OpenReel offline container"
docker compose -f $composePath up -d
Assert-LastExitCode "docker compose up"

Write-Host "OpenReel is starting at: http://localhost:8080"

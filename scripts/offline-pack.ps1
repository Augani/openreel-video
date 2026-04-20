$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bundleDir = Join-Path $root "offline-bundle"
$image = "openreel-offline:latest"
$tarPath = Join-Path $bundleDir "openreel-offline.tar"

function Assert-LastExitCode {
  param(
    [string]$Step
  )

  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

Write-Host "Building Docker image: $image"
docker build -t $image $root
Assert-LastExitCode "docker build"

Write-Host "Saving image to: $tarPath"
docker save -o $tarPath $image
Assert-LastExitCode "docker save"

Copy-Item (Join-Path $root "docker-compose.offline.yml") $bundleDir -Force
Copy-Item (Join-Path $PSScriptRoot "offline-load-run.ps1") $bundleDir -Force
Copy-Item (Join-Path $PSScriptRoot "offline-load-run.sh") $bundleDir -Force
Copy-Item (Join-Path $PSScriptRoot "offline-load-run.bat") $bundleDir -Force
Copy-Item (Join-Path $PSScriptRoot "offline-stop.ps1") $bundleDir -Force
Copy-Item (Join-Path $PSScriptRoot "offline-stop.sh") $bundleDir -Force
Copy-Item (Join-Path $PSScriptRoot "offline-stop.bat") $bundleDir -Force
Copy-Item (Join-Path $root "OFFLINE-DELIVERY.md") $bundleDir -Force

Write-Host "Offline bundle created at: $bundleDir"

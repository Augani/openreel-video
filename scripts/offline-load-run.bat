@echo off
setlocal

set "BUNDLE_DIR=%~dp0"
set "TAR_PATH=%BUNDLE_DIR%openreel-offline.tar"
set "COMPOSE_PATH=%BUNDLE_DIR%docker-compose.offline.yml"

echo Checking Docker daemon...
docker version >nul 2>&1
if errorlevel 1 (
  echo Docker daemon is not running. Please start Docker Desktop first.
  exit /b 1
)

if not exist "%TAR_PATH%" (
  echo Offline image archive not found: %TAR_PATH%
  exit /b 1
)

if not exist "%COMPOSE_PATH%" (
  echo Compose file not found: %COMPOSE_PATH%
  exit /b 1
)

echo Loading Docker image from: %TAR_PATH%
docker load -i "%TAR_PATH%"
if errorlevel 1 (
  echo docker load failed.
  exit /b 1
)

echo Starting OpenReel offline container...
docker compose -f "%COMPOSE_PATH%" up -d
if errorlevel 1 (
  echo docker compose up failed.
  exit /b 1
)

echo OpenReel is starting at: http://localhost:8080
endlocal

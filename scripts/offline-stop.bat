@echo off
setlocal

set "BUNDLE_DIR=%~dp0"
set "COMPOSE_PATH=%BUNDLE_DIR%docker-compose.offline.yml"

echo Checking Docker daemon...
docker version >nul 2>&1
if errorlevel 1 (
  echo Docker daemon is not running. Please start Docker Desktop first.
  exit /b 1
)

if not exist "%COMPOSE_PATH%" (
  echo Compose file not found: %COMPOSE_PATH%
  exit /b 1
)

echo Stopping OpenReel offline container...
docker compose -f "%COMPOSE_PATH%" down
if errorlevel 1 (
  echo docker compose down failed.
  exit /b 1
)

echo OpenReel offline container stopped.
endlocal

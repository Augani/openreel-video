# OpenReel Offline Delivery

This repository now includes a Docker-based offline delivery workflow for the web editor.

## What gets delivered

The offline bundle contains:

- `openreel-offline.tar`: Docker image archive
- `docker-compose.offline.yml`: runtime definition
- `offline-load-run.ps1`: Windows startup script
- `offline-load-run.bat`: Windows double-click startup script
- `offline-load-run.sh`: Linux/macOS startup script
- `offline-stop.ps1`: Windows stop script
- `offline-stop.bat`: Windows double-click stop script
- `offline-stop.sh`: Linux/macOS stop script

## Build the offline bundle

From the repository root:

### PowerShell

```powershell
./scripts/offline-pack.ps1
```

### Bash

```bash
./scripts/offline-pack.sh
```

This creates an `offline-bundle/` directory.

## Run in an offline environment

Copy the entire `offline-bundle/` directory to the target machine.

### PowerShell

```powershell
./offline-load-run.ps1
```

### Windows double-click

Run:

`offline-load-run.bat`

### Bash

```bash
./offline-load-run.sh
```

Then open:

`http://localhost:8080`

## Stop the offline service

### PowerShell

```powershell
./offline-stop.ps1
```

### Windows double-click

Run:

`offline-stop.bat`

### Bash

```bash
./offline-stop.sh
```

## Notes

- Docker and Docker Compose plugin are required on the target machine.
- Docker Desktop / Docker daemon must be running before executing the offline startup scripts.
- The container serves the built web app with SPA routing.
- Required COOP/COEP headers are included in the bundled Nginx config so browser features like SharedArrayBuffer remain available.

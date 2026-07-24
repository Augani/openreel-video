# OpenReel filter recipes → LUT generator

Build LUTs from YAML recipes for the filter-presets subsystem.

## Setup
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt

## Generate everything
    python generate.py

Outputs land in `out/cube/*.cube` and `out/manifest.json`.

## Tests
    pytest tests/ -v

## Deploy
    ./deploy.sh   # uploads out/ to R2 via wrangler

See `docs/superpowers/specs/2026-05-22-filter-presets-design.md` for design.

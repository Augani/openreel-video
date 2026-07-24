from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Iterable

import jsonschema

from scripts.filters.recipe import Recipe


SCHEMA_PATH = Path(__file__).parent / "manifest_schema.json"


def build_manifest_entry(recipe: Recipe, cube_path: Path, base_url: str) -> dict:
    data = cube_path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    return {
        "id": recipe.id,
        "name": recipe.name,
        "category": recipe.category,
        "accent": recipe.accent,
        "sort": int(recipe.sort),
        "cubeUrl": f"{base_url.rstrip('/')}/cube/{recipe.id}.cube",
        "sha256": sha,
        "bytes": len(data),
    }


def write_manifest(
    out_path: Path,
    version: str,
    filters: Iterable[dict],
    categories: Iterable[dict],
    min_client_version: str | None = None,
) -> None:
    payload = {
        "version": version,
        "filters": list(filters),
        "categories": list(categories),
    }
    if min_client_version is not None:
        payload["minClientVersion"] = min_client_version
    schema = json.loads(SCHEMA_PATH.read_text())
    jsonschema.validate(payload, schema)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))

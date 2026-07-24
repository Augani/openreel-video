from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Iterable

from scripts.filters.lut import (
    LUT_SIZE,
    apply_transforms_to_lut,
    identity_lut,
    write_cube,
)
from scripts.filters.manifest import build_manifest_entry, write_manifest
from scripts.filters.recipe import load_recipe, recipe_to_transform_steps


DEFAULT_BASE_URL = "https://filters.openreel.video"
ROOT = Path(__file__).parent
RECIPE_ROOT = ROOT / "recipes"
OUT_ROOT = ROOT / "out"

CATEGORY_ORDER = ["cinematic", "portrait", "vlog", "retro", "mood", "bw"]
CATEGORY_NAMES = {
    "cinematic": "Cinematic",
    "portrait": "Portrait",
    "vlog": "Vlog",
    "retro": "Retro",
    "mood": "Mood",
    "bw": "B&W",
}


def discover_recipes(recipe_root: Path) -> Iterable[Path]:
    yield from sorted(recipe_root.rglob("*.yaml"))


def generate_one(recipe_path: Path, cube_out_root: Path) -> tuple[Path, dict]:
    recipe = load_recipe(recipe_path)
    steps = recipe_to_transform_steps(recipe)
    lut = apply_transforms_to_lut(identity_lut(), steps)
    cube_path = cube_out_root / f"{recipe.id}.cube"
    write_cube(lut, cube_path, title=recipe.name)
    entry = build_manifest_entry(
        recipe=recipe, cube_path=cube_path, base_url=DEFAULT_BASE_URL
    )
    return cube_path, entry


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipes", type=Path, default=RECIPE_ROOT)
    parser.add_argument("--out", type=Path, default=OUT_ROOT)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--version", default=None)
    args = parser.parse_args()

    cube_out = args.out / "cube"
    cube_out.mkdir(parents=True, exist_ok=True)

    filters_meta = []
    for recipe_path in discover_recipes(args.recipes):
        _, entry = generate_one(recipe_path, cube_out)
        if args.base_url != DEFAULT_BASE_URL:
            entry["cubeUrl"] = f"{args.base_url.rstrip('/')}/cube/{entry['id']}.cube"
        filters_meta.append(entry)
        print(f"  → {entry['id']}")

    version = args.version or dt.datetime.utcnow().strftime("%Y-%m-%dT%H%M%S")
    categories = [
        {"id": c, "name": CATEGORY_NAMES.get(c, c.title()), "sort": i + 1}
        for i, c in enumerate(CATEGORY_ORDER)
    ]
    write_manifest(
        out_path=args.out / "manifest.json",
        version=version,
        filters=filters_meta,
        categories=categories,
    )
    print(
        f"Wrote {len(filters_meta)} filters at LUT_3D_SIZE={LUT_SIZE} → {args.out / 'manifest.json'}"
    )


if __name__ == "__main__":
    main()

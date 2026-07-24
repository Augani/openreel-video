import hashlib
import json
from pathlib import Path

import pytest

from scripts.filters.recipe import Recipe, load_recipe, recipe_to_transform_steps
from scripts.filters.manifest import build_manifest_entry, write_manifest


def test_load_recipe_basic(tmp_path: Path):
    src = tmp_path / "demo.yaml"
    src.write_text(
        """
id: cinematic.demo
name: Demo
category: cinematic
accent: "#38BDF8"
sort: 10
steps:
  - temperature: -8
  - tint: 3
  - contrast:
      curve: s_curve
      amount: 1.15
  - saturation: 1.1
"""
    )
    recipe = load_recipe(src)
    assert recipe.id == "cinematic.demo"
    assert recipe.name == "Demo"
    assert recipe.category == "cinematic"
    assert recipe.accent == "#38BDF8"
    assert recipe.sort == 10
    assert len(recipe.steps) == 4


def test_recipe_to_transform_steps_resolves_callables(tmp_path: Path):
    recipe = Recipe(
        id="x.y",
        name="X",
        category="x",
        accent="#000000",
        sort=0,
        steps=[
            {"temperature": -8},
            {"contrast": {"curve": "s_curve", "amount": 1.2}},
        ],
    )
    out = recipe_to_transform_steps(recipe)
    assert len(out) == 2
    fn0, kw0 = out[0]
    assert fn0.__name__ == "apply_temperature"
    assert kw0 == {"amount": -8}
    fn1, kw1 = out[1]
    assert fn1.__name__ == "apply_contrast"
    assert kw1 == {"curve": "s_curve", "amount": 1.2}


def test_load_recipe_rejects_unknown_step(tmp_path: Path):
    src = tmp_path / "bad.yaml"
    src.write_text(
        """
id: bad.recipe
name: Bad
category: bad
accent: "#000000"
sort: 1
steps:
  - what_even_is_this: 1
"""
    )
    recipe = load_recipe(src)
    with pytest.raises(ValueError, match="Unknown step"):
        recipe_to_transform_steps(recipe)


def test_build_manifest_entry_includes_sha_and_bytes(tmp_path: Path):
    cube_path = tmp_path / "demo.cube"
    cube_path.write_bytes(b"hello world")
    recipe = Recipe(
        id="cinematic.demo",
        name="Demo",
        category="cinematic",
        accent="#38BDF8",
        sort=10,
        steps=[],
    )
    entry = build_manifest_entry(
        recipe=recipe,
        cube_path=cube_path,
        base_url="https://filters.openreel.video",
    )
    assert entry["id"] == "cinematic.demo"
    assert entry["cubeUrl"] == "https://filters.openreel.video/cube/cinematic.demo.cube"
    assert entry["sha256"] == hashlib.sha256(b"hello world").hexdigest()
    assert entry["bytes"] == len(b"hello world")


def test_write_manifest_validates_against_schema(tmp_path: Path):
    out_path = tmp_path / "manifest.json"
    write_manifest(
        out_path=out_path,
        version="2026-05-22T1",
        filters=[
            {
                "id": "x.y",
                "name": "X",
                "category": "x",
                "accent": "#000000",
                "sort": 1,
                "cubeUrl": "https://filters.openreel.video/cube/x.y.cube",
                "sha256": "a" * 64,
                "bytes": 100,
            }
        ],
        categories=[{"id": "x", "name": "X", "sort": 1}],
    )
    data = json.loads(out_path.read_text())
    assert data["version"] == "2026-05-22T1"
    assert len(data["filters"]) == 1

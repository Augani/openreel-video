# Filter Presets v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a curated ~60-filter catalog (LUT-based color grades) on iOS and Android, streamed from Cloudflare R2, with a CapCut-style picker (dynamic thumbnails, 0–100% intensity), backed by a code-generated recipe → `.cube` toolchain.

**Architecture:** Three layers. (1) Build-time Python tool reads YAML recipes and emits `.cube` LUTs + `manifest.json`. (2) Cloudflare R2 hosts the bundle behind a public custom domain (`filters.openreel.video`) — no Worker proxy needed; R2 natively serves with ETag + immutable caching. (3) Mobile clients (iOS Swift + Android Kotlin) fetch the manifest, lazy-load LUTs on demand with `sha256` integrity, render via `CIColorCube` (iOS) or a Media3 `GlEffect` with `GL_TEXTURE_3D` (Android). One new optional field `clip.filter: AppliedFilter?` carries id + intensity.

**Tech Stack:** Python 3.11 (NumPy, PyYAML, jsonschema, Pillow) for the tool. Cloudflare Workers + Hono + R2 for hosting. Swift 5.10 + CoreImage + SwiftUI on iOS. Kotlin 2.2 + Media3 1.5 + OkHttp + Compose on Android.

Spec: `docs/superpowers/specs/2026-05-22-filter-presets-design.md`

---

## Phase 0 — Foundations

> **Architecture deviation from spec.** During execution we elected to serve filter content directly from R2 via a public custom domain (`filters.openreel.video`), bypassing the `apps/cloud` Worker. R2 natively provides ETags, immutable caching, and 304s. Rationale: `apps/cloud/` is gitignored by repo convention (only `infra/` carries tracked backend code), and the Worker layer didn't add value for static-content delivery. Tasks 0.7 (wrangler R2 binding) and 0.8 (Worker routes) are deleted. Renumbered: old Task 0.9 (deploy script) becomes new Task 0.8.

### Task 0.1: Create R2 bucket `openreel-filters` + public access + custom domain

**Files:** none. Cloudflare config only.

- [ ] **Step 1: Create the R2 bucket**

```bash
npx wrangler r2 bucket create openreel-filters
```

Expected: `Created bucket 'openreel-filters'.`

- [ ] **Step 2: Bind the public custom domain**

```bash
npx wrangler r2 bucket domain add openreel-filters --domain filters.openreel.video
```

Expected: domain creation request acknowledged. If wrangler can't manage the zone, do it in the Cloudflare dashboard: R2 → openreel-filters → Settings → Custom Domains → add `filters.openreel.video`.

- [ ] **Step 3: Verify**

```bash
npx wrangler r2 bucket list | grep openreel-filters
```

Expected: line containing `openreel-filters`. After DNS propagates, `curl -I https://filters.openreel.video/manifest.json` returns 404 (no content uploaded yet) — proving the route resolves to R2.

- [ ] **Step 4: Commit nothing** — infra-only step.

---

### Task 0.2: Scaffold the Python tool

**Files:**
- Create: `scripts/filters/__init__.py`
- Create: `scripts/filters/requirements.txt`
- Create: `scripts/filters/.gitignore`
- Create: `scripts/filters/README.md`
- Create: `scripts/filters/tests/__init__.py`

- [ ] **Step 1: Make the directory tree**

Run:
```bash
mkdir -p scripts/filters/{recipes,tests,tests/fixtures,out}
touch scripts/filters/__init__.py scripts/filters/tests/__init__.py
```

- [ ] **Step 2: Pin Python deps**

Write `scripts/filters/requirements.txt`:
```
numpy==1.26.4
pyyaml==6.0.2
jsonschema==4.23.0
Pillow==10.4.0
pytest==8.3.3
```

- [ ] **Step 3: Ignore generated output**

Write `scripts/filters/.gitignore`:
```
out/
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 4: Add a one-page README**

Write `scripts/filters/README.md`:
```markdown
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
```

- [ ] **Step 5: Verify pip install works**

Run:
```bash
cd scripts/filters && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && deactivate
```

Expected: no errors. `.venv/` created.

- [ ] **Step 6: Commit**

```bash
git add scripts/filters/__init__.py scripts/filters/tests/__init__.py scripts/filters/requirements.txt scripts/filters/.gitignore scripts/filters/README.md
git commit -m "feat(filters): scaffold python toolchain"
```

---

### Task 0.3: Color-transforms module — test first

**Files:**
- Create: `scripts/filters/tests/test_transforms.py`
- Create: `scripts/filters/transforms.py`

- [ ] **Step 1: Write the failing tests**

Write `scripts/filters/tests/test_transforms.py`:
```python
import numpy as np
import pytest

from scripts.filters.transforms import (
    apply_temperature,
    apply_tint,
    apply_exposure,
    apply_contrast,
    apply_saturation,
    apply_vibrance,
    apply_hue_shift,
    apply_split_tone,
    apply_lift_gamma_gain,
    apply_channel_mixer,
    apply_tone_curve,
    apply_clip_levels,
    apply_monochrome,
)


def _gray():
    return np.full((1, 1, 3), 0.5, dtype=np.float32)


def test_temperature_warm_shifts_toward_orange():
    out = apply_temperature(_gray(), amount=10)
    assert out[0, 0, 0] > 0.5  # red up
    assert out[0, 0, 2] < 0.5  # blue down


def test_temperature_cool_shifts_toward_blue():
    out = apply_temperature(_gray(), amount=-10)
    assert out[0, 0, 0] < 0.5
    assert out[0, 0, 2] > 0.5


def test_tint_positive_pushes_green():
    out = apply_tint(_gray(), amount=10)
    assert out[0, 0, 1] > 0.5


def test_exposure_one_stop_doubles_value():
    out = apply_exposure(_gray(), stops=1.0)
    np.testing.assert_allclose(out[0, 0], 1.0, atol=1e-3)


def test_contrast_s_curve_pushes_midtones_away_from_gray():
    bright = np.full((1, 1, 3), 0.75, dtype=np.float32)
    dark = np.full((1, 1, 3), 0.25, dtype=np.float32)
    out_bright = apply_contrast(bright, curve="s_curve", amount=1.5)
    out_dark = apply_contrast(dark, curve="s_curve", amount=1.5)
    assert out_bright[0, 0, 0] > 0.75
    assert out_dark[0, 0, 0] < 0.25


def test_saturation_zero_is_grayscale():
    color = np.array([[[1.0, 0.0, 0.0]]], dtype=np.float32)
    out = apply_saturation(color, amount=0.0)
    np.testing.assert_allclose(out[0, 0, 0], out[0, 0, 1], atol=1e-3)
    np.testing.assert_allclose(out[0, 0, 1], out[0, 0, 2], atol=1e-3)


def test_vibrance_affects_low_sat_more_than_high_sat():
    low_sat = np.array([[[0.55, 0.50, 0.45]]], dtype=np.float32)
    high_sat = np.array([[[1.00, 0.20, 0.20]]], dtype=np.float32)
    out_low = apply_vibrance(low_sat, amount=1.0)
    out_high = apply_vibrance(high_sat, amount=1.0)
    delta_low = abs(out_low[0, 0, 0] - low_sat[0, 0, 0])
    delta_high = abs(out_high[0, 0, 0] - high_sat[0, 0, 0])
    assert delta_low > delta_high


def test_hue_shift_red_to_orange():
    red = np.array([[[1.0, 0.0, 0.0]]], dtype=np.float32)
    out = apply_hue_shift(red, reds=-15)
    assert out[0, 0, 1] > 0.0  # picked up green → orange


def test_split_tone_pushes_shadows_to_color():
    out = apply_split_tone(
        np.full((1, 1, 3), 0.2, dtype=np.float32),
        shadows=(0.1, 0.3, 0.6),
        highlights=(1.0, 0.7, 0.4),
        balance=0.0,
    )
    assert out[0, 0, 2] > 0.2


def test_lift_gamma_gain_lift_brightens_blacks():
    black = np.full((1, 1, 3), 0.0, dtype=np.float32)
    out = apply_lift_gamma_gain(black, lift=0.2, gamma=1.0, gain=1.0)
    assert out[0, 0, 0] > 0.0


def test_channel_mixer_identity_unchanged():
    img = np.array([[[0.3, 0.6, 0.9]]], dtype=np.float32)
    out = apply_channel_mixer(img, matrix=np.eye(3, dtype=np.float32))
    np.testing.assert_allclose(out, img, atol=1e-6)


def test_tone_curve_monotonic_passthrough():
    img = np.array([[[0.25, 0.5, 0.75]]], dtype=np.float32)
    out = apply_tone_curve(img, points=[(0.0, 0.0), (1.0, 1.0)])
    np.testing.assert_allclose(out, img, atol=1e-3)


def test_clip_levels_pulls_blacks_and_whites():
    img = np.array([[[0.0, 0.5, 1.0]]], dtype=np.float32)
    out = apply_clip_levels(img, black=0.1, white=0.9)
    assert out[0, 0, 0] == 0.0
    np.testing.assert_allclose(out[0, 0, 2], 1.0, atol=1e-3)


def test_monochrome_with_weights():
    img = np.array([[[1.0, 0.0, 0.0]]], dtype=np.float32)
    out = apply_monochrome(img, weights=(1.0, 0.0, 0.0))
    np.testing.assert_allclose(out[0, 0, 0], out[0, 0, 1], atol=1e-3)
    np.testing.assert_allclose(out[0, 0, 1], out[0, 0, 2], atol=1e-3)
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
cd scripts/filters && source .venv/bin/activate && PYTHONPATH=../.. pytest tests/test_transforms.py -v
```

Expected: every test errors with `ImportError: cannot import name 'apply_temperature' from 'scripts.filters.transforms'`.

- [ ] **Step 3: Implement the transforms**

Write `scripts/filters/transforms.py`:
```python
from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np


def _clip01(arr: np.ndarray) -> np.ndarray:
    return np.clip(arr, 0.0, 1.0)


def apply_temperature(image: np.ndarray, amount: float) -> np.ndarray:
    factor = amount / 100.0
    shift = np.array([factor, factor * 0.1, -factor], dtype=np.float32) * 0.5
    return _clip01(image + shift)


def apply_tint(image: np.ndarray, amount: float) -> np.ndarray:
    factor = amount / 100.0
    shift = np.array([-factor * 0.25, factor * 0.5, -factor * 0.25], dtype=np.float32)
    return _clip01(image + shift)


def apply_exposure(image: np.ndarray, stops: float) -> np.ndarray:
    return _clip01(image * (2.0 ** stops))


def apply_contrast(image: np.ndarray, curve: str, amount: float) -> np.ndarray:
    if curve == "linear":
        return _clip01((image - 0.5) * amount + 0.5)
    if curve == "gamma":
        return _clip01(np.power(image, 1.0 / max(amount, 1e-6)))
    if curve == "s_curve":
        x = image
        k = (amount - 1.0) * 3.0 + 1.0
        return _clip01(0.5 + (np.tanh(k * (x - 0.5)) / np.tanh(k * 0.5)) * 0.5)
    raise ValueError(f"Unknown contrast curve: {curve}")


def apply_saturation(image: np.ndarray, amount: float) -> np.ndarray:
    luma = np.dot(image[..., :3], np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
    luma = np.expand_dims(luma, axis=-1)
    return _clip01(luma + (image - luma) * amount)


def apply_vibrance(image: np.ndarray, amount: float) -> np.ndarray:
    max_c = image.max(axis=-1, keepdims=True)
    min_c = image.min(axis=-1, keepdims=True)
    saturation = max_c - min_c
    weight = 1.0 - saturation
    boosted = apply_saturation(image, amount=1.0 + amount)
    return _clip01(image * (1.0 - weight) + boosted * weight)


def apply_hue_shift(image: np.ndarray, **per_channel: float) -> np.ndarray:
    angles = {
        "reds": per_channel.get("reds", 0.0),
        "greens": per_channel.get("greens", 0.0),
        "blues": per_channel.get("blues", 0.0),
        "global": per_channel.get("global", 0.0),
    }
    from colorsys import rgb_to_hsv, hsv_to_rgb

    out = np.empty_like(image)
    flat = image.reshape(-1, 3)
    for idx, (r, g, b) in enumerate(flat):
        h, s, v = rgb_to_hsv(float(r), float(g), float(b))
        h360 = h * 360.0
        shift = angles["global"]
        if 345 <= h360 or h360 < 15:
            shift += angles["reds"]
        elif 90 <= h360 < 150:
            shift += angles["greens"]
        elif 210 <= h360 < 270:
            shift += angles["blues"]
        h = ((h360 + shift) % 360.0) / 360.0
        out.reshape(-1, 3)[idx] = hsv_to_rgb(h, s, v)
    return _clip01(out)


def apply_split_tone(
    image: np.ndarray,
    shadows: Sequence[float],
    highlights: Sequence[float],
    balance: float = 0.0,
) -> np.ndarray:
    luma = np.dot(image[..., :3], np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
    luma = np.expand_dims(luma, axis=-1)
    pivot = 0.5 + balance * 0.5
    shadow_w = np.clip(1.0 - luma / pivot, 0.0, 1.0)
    highlight_w = np.clip((luma - pivot) / (1.0 - pivot + 1e-6), 0.0, 1.0)
    shadow_arr = np.array(shadows, dtype=np.float32).reshape(1, 1, 3)
    highlight_arr = np.array(highlights, dtype=np.float32).reshape(1, 1, 3)
    tinted = image + (shadow_arr - 0.5) * 0.4 * shadow_w + (highlight_arr - 0.5) * 0.4 * highlight_w
    return _clip01(tinted)


def apply_lift_gamma_gain(
    image: np.ndarray,
    lift: float = 0.0,
    gamma: float = 1.0,
    gain: float = 1.0,
) -> np.ndarray:
    x = image + lift * (1.0 - image)
    x = np.power(_clip01(x), 1.0 / max(gamma, 1e-6))
    return _clip01(x * gain)


def apply_channel_mixer(image: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    flat = image.reshape(-1, 3)
    out = flat @ matrix.T.astype(np.float32)
    return _clip01(out.reshape(image.shape))


def apply_tone_curve(image: np.ndarray, points: Iterable[Sequence[float]]) -> np.ndarray:
    arr = np.array(list(points), dtype=np.float32)
    arr = arr[arr[:, 0].argsort()]
    xs, ys = arr[:, 0], arr[:, 1]
    out = np.interp(image, xs, ys).astype(np.float32)
    return _clip01(out)


def apply_clip_levels(image: np.ndarray, black: float = 0.0, white: float = 1.0) -> np.ndarray:
    return _clip01((image - black) / max(white - black, 1e-6))


def apply_monochrome(image: np.ndarray, weights: Sequence[float] = (0.2126, 0.7152, 0.0722)) -> np.ndarray:
    w = np.array(weights, dtype=np.float32)
    w = w / max(w.sum(), 1e-6)
    luma = np.dot(image[..., :3], w)
    return _clip01(np.stack([luma, luma, luma], axis=-1))
```

- [ ] **Step 4: Re-run tests, verify they pass**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/test_transforms.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/filters/transforms.py scripts/filters/tests/test_transforms.py
git commit -m "feat(filters): color transforms with unit tests"
```

---

### Task 0.4: 33³ identity LUT + `.cube` writer

**Files:**
- Create: `scripts/filters/tests/test_lut.py`
- Create: `scripts/filters/lut.py`

- [ ] **Step 1: Write the failing tests**

Write `scripts/filters/tests/test_lut.py`:
```python
import numpy as np

from scripts.filters.lut import (
    identity_lut,
    apply_transforms_to_lut,
    write_cube,
    LUT_SIZE,
)
from scripts.filters.transforms import apply_exposure


def test_identity_lut_shape():
    lut = identity_lut()
    assert lut.shape == (LUT_SIZE, LUT_SIZE, LUT_SIZE, 3)


def test_identity_lut_corner_values():
    lut = identity_lut()
    np.testing.assert_allclose(lut[0, 0, 0], [0.0, 0.0, 0.0])
    np.testing.assert_allclose(lut[-1, -1, -1], [1.0, 1.0, 1.0], atol=1e-5)


def test_apply_transforms_lifts_lut_when_exposure_positive():
    lut = identity_lut()
    out = apply_transforms_to_lut(lut, [(apply_exposure, {"stops": 0.5})])
    assert out[10, 10, 10, 0] > lut[10, 10, 10, 0]


def test_write_cube_format(tmp_path):
    lut = identity_lut()
    target = tmp_path / "id.cube"
    write_cube(lut, target, title="Identity")
    contents = target.read_text()
    assert contents.startswith("TITLE")
    assert f"LUT_3D_SIZE {LUT_SIZE}" in contents
    lines = [ln for ln in contents.splitlines() if ln and not ln.startswith("#") and not ln.startswith(("TITLE", "DOMAIN", "LUT_3D_SIZE"))]
    assert len(lines) == LUT_SIZE ** 3
    first = list(map(float, lines[0].split()))
    np.testing.assert_allclose(first, [0.0, 0.0, 0.0], atol=1e-5)
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/test_lut.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement the LUT module**

Write `scripts/filters/lut.py`:
```python
from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable, Tuple

import numpy as np

LUT_SIZE = 33

TransformStep = Tuple[Callable[..., np.ndarray], dict]


def identity_lut() -> np.ndarray:
    axis = np.linspace(0.0, 1.0, LUT_SIZE, dtype=np.float32)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    return np.stack([r, g, b], axis=-1)


def apply_transforms_to_lut(lut: np.ndarray, steps: Iterable[TransformStep]) -> np.ndarray:
    flat = lut.reshape(-1, 1, 3).astype(np.float32)
    for fn, kwargs in steps:
        flat = fn(flat, **kwargs)
    return flat.reshape(lut.shape).astype(np.float32)


def write_cube(lut: np.ndarray, path: Path, title: str) -> None:
    if lut.shape != (LUT_SIZE, LUT_SIZE, LUT_SIZE, 3):
        raise ValueError(f"Expected {LUT_SIZE}^3 LUT, got {lut.shape}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        fh.write(f"TITLE \"{title}\"\n")
        fh.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        fh.write("DOMAIN_MAX 1.0 1.0 1.0\n")
        fh.write(f"LUT_3D_SIZE {LUT_SIZE}\n")
        for b in range(LUT_SIZE):
            for g in range(LUT_SIZE):
                for r in range(LUT_SIZE):
                    px = lut[r, g, b]
                    fh.write(f"{px[0]:.6f} {px[1]:.6f} {px[2]:.6f}\n")
```

- [ ] **Step 4: Re-run tests, verify they pass**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/test_lut.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/filters/lut.py scripts/filters/tests/test_lut.py
git commit -m "feat(filters): 33-cubed LUT builder and .cube writer"
```

---

### Task 0.5: Recipe loader + manifest emitter

**Files:**
- Create: `scripts/filters/manifest_schema.json`
- Create: `scripts/filters/tests/test_recipe_loader.py`
- Create: `scripts/filters/recipe.py`
- Create: `scripts/filters/manifest.py`

- [ ] **Step 1: Write the JSON schema for the manifest**

Write `scripts/filters/manifest_schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["version", "filters", "categories"],
  "properties": {
    "version": {"type": "string"},
    "minClientVersion": {"type": "string"},
    "filters": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "category", "accent", "sort", "cubeUrl", "sha256", "bytes"],
        "properties": {
          "id": {"type": "string"},
          "name": {"type": "string"},
          "category": {"type": "string"},
          "accent": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
          "sort": {"type": "integer"},
          "cubeUrl": {"type": "string", "format": "uri"},
          "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
          "bytes": {"type": "integer", "minimum": 1},
          "oldIds": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "categories": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "sort"],
        "properties": {
          "id": {"type": "string"},
          "name": {"type": "string"},
          "sort": {"type": "integer"}
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write recipe loader tests**

Write `scripts/filters/tests/test_recipe_loader.py`:
```python
from pathlib import Path

import pytest

from scripts.filters.recipe import Recipe, load_recipe, recipe_to_transform_steps


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
```

- [ ] **Step 3: Write manifest emitter tests**

Append to `scripts/filters/tests/test_recipe_loader.py`:
```python
import hashlib
import json

from scripts.filters.manifest import build_manifest_entry, write_manifest


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
```

- [ ] **Step 4: Run tests, verify they fail**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/test_recipe_loader.py -v
```

Expected: ImportError on `scripts.filters.recipe`.

- [ ] **Step 5: Implement the recipe module**

Write `scripts/filters/recipe.py`:
```python
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Tuple

import yaml

from scripts.filters import transforms


STEP_REGISTRY = {
    "temperature": ("apply_temperature", lambda v: {"amount": float(v)}),
    "tint": ("apply_tint", lambda v: {"amount": float(v)}),
    "exposure": ("apply_exposure", lambda v: {"stops": float(v)}),
    "contrast": ("apply_contrast", lambda v: {"curve": str(v["curve"]), "amount": float(v["amount"])}),
    "saturation": ("apply_saturation", lambda v: {"amount": float(v)}),
    "vibrance": ("apply_vibrance", lambda v: {"amount": float(v)}),
    "hue_shift": ("apply_hue_shift", lambda v: {k: float(x) for k, x in v.items()}),
    "split_tone": (
        "apply_split_tone",
        lambda v: {
            "shadows": _parse_color(v["shadows"]),
            "highlights": _parse_color(v["highlights"]),
            "balance": float(v.get("balance", 0.0)),
        },
    ),
    "lift_gamma_gain": (
        "apply_lift_gamma_gain",
        lambda v: {k: float(v.get(k, 0.0 if k == "lift" else 1.0)) for k in ("lift", "gamma", "gain")},
    ),
    "channel_mixer": ("apply_channel_mixer", lambda v: {"matrix": _parse_matrix(v)}),
    "tone_curve": ("apply_tone_curve", lambda v: {"points": [tuple(p) for p in v]}),
    "clip": ("apply_clip_levels", lambda v: {"black": float(v.get("black", 0.0)), "white": float(v.get("white", 1.0))}),
    "monochrome": ("apply_monochrome", lambda v: {"weights": tuple(float(x) for x in v.get("weights", (0.2126, 0.7152, 0.0722)))}),
}


def _parse_color(value: Any) -> tuple[float, float, float]:
    if isinstance(value, str) and value.startswith("#") and len(value) == 7:
        r = int(value[1:3], 16) / 255.0
        g = int(value[3:5], 16) / 255.0
        b = int(value[5:7], 16) / 255.0
        return (r, g, b)
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return tuple(float(x) for x in value)
    raise ValueError(f"Bad color: {value!r}")


def _parse_matrix(value: Any):
    import numpy as np

    return np.array(value, dtype="float32")


@dataclass
class Recipe:
    id: str
    name: str
    category: str
    accent: str
    sort: int
    steps: List[Any] = field(default_factory=list)


def load_recipe(path: Path) -> Recipe:
    raw = yaml.safe_load(path.read_text())
    return Recipe(
        id=raw["id"],
        name=raw["name"],
        category=raw["category"],
        accent=raw["accent"],
        sort=int(raw.get("sort", 0)),
        steps=list(raw.get("steps", [])),
    )


def recipe_to_transform_steps(recipe: Recipe) -> List[Tuple[Any, dict]]:
    out: List[Tuple[Any, dict]] = []
    for step in recipe.steps:
        if not isinstance(step, dict) or len(step) != 1:
            raise ValueError(f"Bad step shape: {step!r}")
        ((key, value),) = step.items()
        if key not in STEP_REGISTRY:
            raise ValueError(f"Unknown step: {key}")
        fn_name, mapper = STEP_REGISTRY[key]
        fn = getattr(transforms, fn_name)
        out.append((fn, mapper(value)))
    return out
```

- [ ] **Step 6: Implement the manifest module**

Write `scripts/filters/manifest.py`:
```python
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Iterable, List

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
    if min_client_version:
        payload["minClientVersion"] = min_client_version
    schema = json.loads(SCHEMA_PATH.read_text())
    jsonschema.validate(payload, schema)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
```

- [ ] **Step 7: Re-run tests, verify they pass**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/test_recipe_loader.py -v
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/filters/recipe.py scripts/filters/manifest.py scripts/filters/manifest_schema.json scripts/filters/tests/test_recipe_loader.py
git commit -m "feat(filters): recipe loader + manifest emitter with schema"
```

---

### Task 0.6: `generate.py` CLI + golden-file regression test

**Files:**
- Create: `scripts/filters/recipes/cinematic/teal_orange.yaml`
- Create: `scripts/filters/generate.py`
- Create: `scripts/filters/tests/test_generate.py`
- Create: `scripts/filters/tests/fixtures/sample.yaml`
- Create: `scripts/filters/tests/fixtures/sample.cube` (committed after first green run)

- [ ] **Step 1: Write the Phase 1 hero recipe (Teal & Orange)**

Write `scripts/filters/recipes/cinematic/teal_orange.yaml`:
```yaml
id: cinematic.teal_orange
name: Teal & Orange
category: cinematic
accent: "#38BDF8"
sort: 10
steps:
  - temperature: -8
  - tint: 3
  - contrast:
      curve: s_curve
      amount: 1.15
  - split_tone:
      shadows: "#1E3A5F"
      highlights: "#FFA94D"
      balance: 0.0
  - saturation: 1.10
  - hue_shift:
      reds: -5
```

- [ ] **Step 2: Write the generator CLI**

Write `scripts/filters/generate.py`:
```python
from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Iterable

from scripts.filters.lut import LUT_SIZE, apply_transforms_to_lut, identity_lut, write_cube
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
    entry = build_manifest_entry(recipe=recipe, cube_path=cube_path, base_url=DEFAULT_BASE_URL)
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
    print(f"Wrote {len(filters_meta)} filters at LUT_3D_SIZE={LUT_SIZE} → {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Add the golden-file fixture recipe**

Write `scripts/filters/tests/fixtures/sample.yaml`:
```yaml
id: test.sample
name: Sample
category: cinematic
accent: "#FFFFFF"
sort: 1
steps:
  - exposure: 0.5
  - saturation: 0.8
```

- [ ] **Step 4: Write the golden-file regression test**

Write `scripts/filters/tests/test_generate.py`:
```python
from pathlib import Path

import pytest

from scripts.filters.generate import generate_one

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_CUBE = FIXTURES / "sample.cube"


def test_sample_generates_expected_cube(tmp_path: Path):
    cube_dir = tmp_path / "cube"
    cube_dir.mkdir()
    cube_path, _ = generate_one(FIXTURES / "sample.yaml", cube_dir)
    actual = cube_path.read_text()
    if not GOLDEN_CUBE.exists():
        GOLDEN_CUBE.write_text(actual)
        pytest.skip("seeded golden file; rerun")
    expected = GOLDEN_CUBE.read_text()
    if actual != expected:
        diff_path = tmp_path / "actual.cube"
        diff_path.write_text(actual)
        raise AssertionError(
            f"Golden mismatch.\nExpected: {GOLDEN_CUBE}\nActual:   {diff_path}\nIf intentional: copy actual over golden and commit."
        )
```

- [ ] **Step 5: Run the test once to seed the golden file**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/test_generate.py -v
```

Expected: `SKIPPED [1] seeded golden file; rerun`. The file `tests/fixtures/sample.cube` now exists.

- [ ] **Step 6: Run again to confirm the golden test passes**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/test_generate.py -v
```

Expected: PASS.

- [ ] **Step 7: Generate the real catalog (just the one recipe so far)**

Run:
```bash
cd scripts/filters && PYTHONPATH=../.. python generate.py
ls out/cube/
cat out/manifest.json
```

Expected: `cinematic.teal_orange.cube` present; manifest contains one entry.

- [ ] **Step 8: Commit**

```bash
git add scripts/filters/generate.py scripts/filters/recipes/cinematic/teal_orange.yaml scripts/filters/tests/test_generate.py scripts/filters/tests/fixtures/sample.yaml scripts/filters/tests/fixtures/sample.cube
git commit -m "feat(filters): generate.py + golden-file regression"
```

---

### Task 0.7: Upload script + first deploy to R2

**Files:**
- Create: `scripts/filters/deploy.sh`

- [ ] **Step 1: Write the deploy script**

Write `scripts/filters/deploy.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

BUCKET="${OPENREEL_FILTERS_BUCKET:-openreel-filters}"
OUT="${OUT_DIR:-out}"

if [[ ! -f "$OUT/manifest.json" ]]; then
  echo "Run generate.py first (no $OUT/manifest.json)." >&2
  exit 1
fi

echo "Uploading .cube files..."
for cube in "$OUT"/cube/*.cube; do
  key="cube/$(basename "$cube")"
  npx wrangler r2 object put "$BUCKET/$key" --file "$cube" --content-type "text/plain"
done

echo "Uploading manifest..."
npx wrangler r2 object put "$BUCKET/manifest.json" --file "$OUT/manifest.json" --content-type "application/json"

echo "Done. https://filters.openreel.video/manifest.json"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/filters/deploy.sh
```

- [ ] **Step 3: Run the upload**

```bash
cd scripts/filters && ./deploy.sh
```

Expected: one `.cube` uploaded, then `manifest.json`, both via wrangler. No Worker deploy needed — R2 public domain serves directly.

- [ ] **Step 4: Smoke-test the live routes**

```bash
curl -s https://filters.openreel.video/manifest.json | head -20
curl -sI https://filters.openreel.video/cube/cinematic.teal_orange.cube | head -10
```

Expected: JSON manifest (one filter); 200 with an ETag header. (R2 sets `Cache-Control` on upload via the `--cache-control` flag if you want long-cache headers — see Step 5 below.)

- [ ] **Step 5: (Optional but recommended) Re-upload with explicit cache headers**

Wrangler's `r2 object put` supports `--cache-control`. Update the deploy script's upload lines:

```bash
npx wrangler r2 object put "$BUCKET/$key" --file "$cube" --content-type "text/plain" --cache-control "public, max-age=31536000, immutable"
```

For the manifest:
```bash
npx wrangler r2 object put "$BUCKET/manifest.json" --file "$OUT/manifest.json" --content-type "application/json" --cache-control "public, max-age=300, s-maxage=3600"
```

Re-run `./deploy.sh`. `curl -sI https://filters.openreel.video/cube/cinematic.teal_orange.cube` should now include `Cache-Control: public, max-age=31536000, immutable`.

- [ ] **Step 6: Commit**

```bash
git add scripts/filters/deploy.sh
git commit -m "chore(filters): deploy script for R2 sync"
```

---

## Phase 1 — One filter, end-to-end (iOS + Android)

### Task 1.1 (iOS): `AppliedFilter` model + extend `Clip`

**Files:**
- Create: `Openreel Video/Openreel Video/Core/Filters/AppliedFilter.swift`
- Modify: `Openreel Video/Openreel Video/Core/Models/OpenReelProject.swift` (the `Clip` struct — add an optional `filter` field; do NOT change any other fields)

- [ ] **Step 1: Create the `AppliedFilter` type**

Write `Openreel Video/Openreel Video/Core/Filters/AppliedFilter.swift`:
```swift
import Foundation

nonisolated struct AppliedFilter: Codable, Equatable, Sendable {
    var id: String
    var intensity: Float

    init(id: String, intensity: Float = 1.0) {
        self.id = id
        self.intensity = min(max(intensity, 0.0), 1.0)
    }
}
```

- [ ] **Step 2: Extend the `Clip` struct**

In `Openreel Video/Openreel Video/Core/Models/OpenReelProject.swift`, locate the `Clip` struct and add the new optional field. Make it the last stored property; decode-default to nil for project backwards compatibility:

```swift
// Inside extension OpenReelProject { ... struct Clip: ... } add:
var filter: AppliedFilter? = nil
```

And in the `Clip` `init(from decoder:)` (if present), default missing key to nil. If `Clip` uses synthesized Codable, also add `case filter` to its `CodingKeys` enum so encode round-trips.

- [ ] **Step 3: Build and verify**

Run:
```bash
cd "Openreel Video" && xcodebuild -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/openreel-ios-build build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video/Openreel Video/Core/Filters/AppliedFilter.swift" "Openreel Video/Openreel Video/Core/Models/OpenReelProject.swift"
git commit -m "feat(ios): AppliedFilter model + Clip.filter field"
```

---

### Task 1.2 (iOS): `FilterCatalogService` — manifest fetch + reconcile

**Files:**
- Create: `Openreel Video/Openreel Video/Core/Filters/FilterCatalog.swift`
- Create: `Openreel Video/Openreel Video/Core/Filters/FilterCatalogService.swift`
- Create: `Openreel Video/Openreel VideoTests/FilterCatalogServiceTests.swift`

- [ ] **Step 1: Define the data shapes**

Write `Openreel Video/Openreel Video/Core/Filters/FilterCatalog.swift`:
```swift
import Foundation

nonisolated struct FilterCatalog: Codable, Equatable, Sendable {
    var version: String
    var minClientVersion: String?
    var filters: [FilterEntry]
    var categories: [FilterCategory]
}

nonisolated struct FilterEntry: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var category: String
    var accent: String
    var sort: Int
    var cubeUrl: String
    var sha256: String
    var bytes: Int
    var oldIds: [String]?
}

nonisolated struct FilterCategory: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var sort: Int
}

nonisolated enum FilterCatalogState: Equatable, Sendable {
    case loading
    case ready(FilterCatalog)
    case error(String)
}
```

- [ ] **Step 2: Write the failing test**

Write `Openreel Video/Openreel VideoTests/FilterCatalogServiceTests.swift`:
```swift
import XCTest
@testable import Openreel_Video

final class FilterCatalogServiceTests: XCTestCase {
    func makeManifest(version: String, filterIds: [String]) -> Data {
        let filters = filterIds.map { id -> [String: Any] in
            [
                "id": id,
                "name": id.capitalized,
                "category": "cinematic",
                "accent": "#38BDF8",
                "sort": 10,
                "cubeUrl": "https://filters.openreel.video/cube/\(id).cube",
                "sha256": String(repeating: "a", count: 64),
                "bytes": 100,
            ]
        }
        let payload: [String: Any] = [
            "version": version,
            "filters": filters,
            "categories": [["id": "cinematic", "name": "Cinematic", "sort": 1]],
        ]
        return try! JSONSerialization.data(withJSONObject: payload)
    }

    @MainActor
    func testReconcileLoadsManifestFromNetwork() async throws {
        let session = StubURLSession()
        let manifest = makeManifest(version: "v1", filterIds: ["cinematic.demo"])
        session.stub(url: URL(string: "https://example.com/filters/manifest")!, status: 200, data: manifest)

        let storage = InMemoryCatalogStore()
        let service = FilterCatalogService(
            manifestURL: URL(string: "https://example.com/filters/manifest")!,
            urlSession: session,
            store: storage
        )

        await service.refresh()

        guard case let .ready(catalog) = service.state else {
            XCTFail("expected ready, got \(service.state)")
            return
        }
        XCTAssertEqual(catalog.version, "v1")
        XCTAssertEqual(catalog.filters.count, 1)
        XCTAssertNotNil(storage.savedManifest)
    }

    @MainActor
    func testReconcilePrefersOnDiskWhenNetworkFails() async throws {
        let session = StubURLSession()
        session.stub(url: URL(string: "https://example.com/filters/manifest")!, error: URLError(.notConnectedToInternet))

        let cached = makeManifest(version: "vCached", filterIds: ["cached.one"])
        let storage = InMemoryCatalogStore(seed: cached)

        let service = FilterCatalogService(
            manifestURL: URL(string: "https://example.com/filters/manifest")!,
            urlSession: session,
            store: storage
        )

        await service.refresh()

        guard case let .ready(catalog) = service.state else {
            XCTFail("expected ready, got \(service.state)")
            return
        }
        XCTAssertEqual(catalog.version, "vCached")
    }

    @MainActor
    func testReconcileHandlesETag304() async throws {
        let session = StubURLSession()
        let manifest = makeManifest(version: "v1", filterIds: ["cinematic.demo"])
        let url = URL(string: "https://example.com/filters/manifest")!
        session.stub(url: url, status: 200, data: manifest, headers: ["ETag": "tag-1"])

        let storage = InMemoryCatalogStore()
        let service = FilterCatalogService(manifestURL: url, urlSession: session, store: storage)
        await service.refresh()

        session.stub(url: url, status: 304, data: Data())
        await service.refresh()

        guard case let .ready(catalog) = service.state else { return XCTFail() }
        XCTAssertEqual(catalog.version, "v1")
        XCTAssertEqual(session.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "tag-1")
    }
}
```

Plus the test doubles. Append to the same file:
```swift
final class StubURLSession: URLSessionProtocol, @unchecked Sendable {
    private var stubs: [URL: (Int, Data?, [String: String], Error?)] = [:]
    var requests: [URLRequest] = []

    func stub(url: URL, status: Int = 200, data: Data? = nil, headers: [String: String] = [:], error: Error? = nil) {
        stubs[url] = (status, data, headers, error)
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        guard let url = request.url, let entry = stubs[url] else {
            throw URLError(.fileDoesNotExist)
        }
        if let error = entry.3 { throw error }
        let response = HTTPURLResponse(url: url, statusCode: entry.0, httpVersion: "HTTP/1.1", headerFields: entry.2)!
        return (entry.1 ?? Data(), response)
    }
}

final class InMemoryCatalogStore: FilterCatalogStore, @unchecked Sendable {
    var savedManifest: FilterCatalog?
    var savedETag: String?
    init(seed: Data? = nil) {
        if let seed, let catalog = try? JSONDecoder().decode(FilterCatalog.self, from: seed) {
            savedManifest = catalog
        }
    }
    func loadCatalog() -> FilterCatalog? { savedManifest }
    func loadETag() -> String? { savedETag }
    func save(catalog: FilterCatalog, etag: String?) {
        savedManifest = catalog
        savedETag = etag
    }
}
```

- [ ] **Step 3: Run tests, verify they fail (compile errors)**

Run:
```bash
cd "Openreel Video" && xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:"Openreel VideoTests/FilterCatalogServiceTests" 2>&1 | tail -10
```

Expected: compile errors — `FilterCatalogService`, `URLSessionProtocol`, `FilterCatalogStore` not defined.

- [ ] **Step 4: Implement the service**

Write `Openreel Video/Openreel Video/Core/Filters/FilterCatalogService.swift`:
```swift
import Foundation

@MainActor
protocol URLSessionProtocol: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: URLSessionProtocol {}

protocol FilterCatalogStore: Sendable {
    func loadCatalog() -> FilterCatalog?
    func loadETag() -> String?
    func save(catalog: FilterCatalog, etag: String?)
}

@MainActor
final class FilterCatalogService: ObservableObject {
    @Published private(set) var state: FilterCatalogState = .loading

    private let manifestURL: URL
    private let urlSession: URLSessionProtocol
    private let store: FilterCatalogStore
    private let decoder: JSONDecoder

    init(
        manifestURL: URL,
        urlSession: URLSessionProtocol = URLSession.shared,
        store: FilterCatalogStore
    ) {
        self.manifestURL = manifestURL
        self.urlSession = urlSession
        self.store = store
        self.decoder = JSONDecoder()
        if let cached = store.loadCatalog() {
            state = .ready(cached)
        }
    }

    func refresh() async {
        var request = URLRequest(url: manifestURL)
        if let etag = store.loadETag() {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }

        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { return }

            if http.statusCode == 304, let cached = store.loadCatalog() {
                state = .ready(cached)
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                if case .ready = state { return }
                state = .error("HTTP \(http.statusCode)")
                return
            }

            let catalog = try decoder.decode(FilterCatalog.self, from: data)
            let etag = http.value(forHTTPHeaderField: "ETag")
            store.save(catalog: catalog, etag: etag)
            state = .ready(catalog)
        } catch {
            if case .ready = state { return }
            if let cached = store.loadCatalog() {
                state = .ready(cached)
            } else {
                state = .error(error.localizedDescription)
            }
        }
    }
}
```

- [ ] **Step 5: Re-run tests, verify they pass**

Run:
```bash
cd "Openreel Video" && xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:"Openreel VideoTests/FilterCatalogServiceTests" 2>&1 | tail -10
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video/Openreel Video/Core/Filters/" "Openreel Video/Openreel VideoTests/FilterCatalogServiceTests.swift"
git commit -m "feat(ios): FilterCatalogService with ETag + offline-fallback"
```

---

### Task 1.3 (iOS): `FilterLutCache` — fetch, sha verify, disk LRU

**Files:**
- Create: `Openreel Video/Openreel Video/Core/Filters/FilterLutCache.swift`
- Create: `Openreel Video/Openreel VideoTests/FilterLutCacheTests.swift`

- [ ] **Step 1: Write the failing tests**

Write `Openreel Video/Openreel VideoTests/FilterLutCacheTests.swift`:
```swift
import XCTest
import CryptoKit
@testable import Openreel_Video

final class FilterLutCacheTests: XCTestCase {
    @MainActor
    func testFetchDownloadsParsesAndCaches() async throws {
        let payload = Self.makeCubeData(linearShift: 0.0)
        let entry = makeEntry(sha: Self.sha(payload))
        let session = StubURLSession()
        session.stub(url: URL(string: entry.cubeUrl)!, status: 200, data: payload)

        let cache = FilterLutCache(directory: tempDir(), urlSession: session, maxBytes: 1_000_000)
        let lut = try await cache.fetch(entry: entry)
        XCTAssertEqual(lut.size, 33)

        let again = cache.get(id: entry.id)
        XCTAssertNotNil(again)
    }

    @MainActor
    func testFetchFailsOnShaMismatch() async {
        let payload = Self.makeCubeData(linearShift: 0.0)
        var entry = makeEntry(sha: Self.sha(payload))
        entry = FilterEntry(
            id: entry.id, name: entry.name, category: entry.category, accent: entry.accent,
            sort: entry.sort, cubeUrl: entry.cubeUrl, sha256: String(repeating: "f", count: 64),
            bytes: entry.bytes, oldIds: nil
        )
        let session = StubURLSession()
        session.stub(url: URL(string: entry.cubeUrl)!, status: 200, data: payload)
        let cache = FilterLutCache(directory: tempDir(), urlSession: session, maxBytes: 1_000_000)
        do {
            _ = try await cache.fetch(entry: entry)
            XCTFail("expected throw")
        } catch let error as FilterLutCacheError {
            XCTAssertEqual(error, .integrity)
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    @MainActor
    func testEvictionAtCap() async throws {
        let dir = tempDir()
        let session = StubURLSession()
        let cache = FilterLutCache(directory: dir, urlSession: session, maxBytes: 300_000)

        for i in 0..<10 {
            let payload = Self.makeCubeData(linearShift: Float(i) / 100.0)
            let entry = makeEntry(sha: Self.sha(payload), id: "f\(i)")
            session.stub(url: URL(string: entry.cubeUrl)!, status: 200, data: payload)
            _ = try await cache.fetch(entry: entry)
        }

        let bytes = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])
            .reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        XCTAssertLessThanOrEqual(bytes, 300_000)
    }

    private func makeEntry(sha: String, id: String = "x") -> FilterEntry {
        FilterEntry(
            id: id, name: id, category: "cinematic", accent: "#000000", sort: 1,
            cubeUrl: "https://example.com/cube/\(id).cube", sha256: sha, bytes: 0, oldIds: nil
        )
    }

    private func tempDir() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("lut-cache-test-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func makeCubeData(linearShift: Float) -> Data {
        var s = "TITLE \"x\"\nLUT_3D_SIZE 33\n"
        for b in 0..<33 {
            for g in 0..<33 {
                for r in 0..<33 {
                    let rf = min(max(Float(r) / 32.0 + linearShift, 0), 1)
                    let gf = Float(g) / 32.0
                    let bf = Float(b) / 32.0
                    s += "\(rf) \(gf) \(bf)\n"
                }
            }
        }
        return Data(s.utf8)
    }

    static func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
```

- [ ] **Step 2: Run tests, verify they fail (compile errors)**

Run:
```bash
cd "Openreel Video" && xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:"Openreel VideoTests/FilterLutCacheTests" 2>&1 | tail -8
```

Expected: compile errors on `FilterLutCache` and `FilterLutCacheError`.

- [ ] **Step 3: Implement the cache**

Write `Openreel Video/Openreel Video/Core/Filters/FilterLutCache.swift`:
```swift
import Foundation
import CryptoKit

enum FilterLutCacheError: Error, Equatable {
    case integrity
    case network(Int)
    case decode
}

struct FilterLutData: Equatable, Sendable {
    let id: String
    let size: Int
    let samples: [Float]
}

@MainActor
final class FilterLutCache {
    private let directory: URL
    private let urlSession: URLSessionProtocol
    private let maxBytes: Int
    private var memory: [String: FilterLutData] = [:]
    private var inflight: [String: Task<FilterLutData, Error>] = [:]

    init(directory: URL, urlSession: URLSessionProtocol, maxBytes: Int = 50 * 1_024 * 1_024) {
        self.directory = directory
        self.urlSession = urlSession
        self.maxBytes = maxBytes
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func get(id: String) -> FilterLutData? { memory[id] }

    func fetch(entry: FilterEntry) async throws -> FilterLutData {
        if let cached = memory[entry.id] { return cached }
        if let task = inflight[entry.id] { return try await task.value }

        let task = Task<FilterLutData, Error> { [weak self] in
            guard let self else { throw FilterLutCacheError.decode }
            return try await self.doFetch(entry: entry)
        }
        inflight[entry.id] = task
        defer { inflight[entry.id] = nil }
        let value = try await task.value
        memory[entry.id] = value
        return value
    }

    private func doFetch(entry: FilterEntry) async throws -> FilterLutData {
        let local = directory.appendingPathComponent("\(entry.id).cube")
        let data: Data
        if let onDisk = try? Data(contentsOf: local), Self.sha(onDisk) == entry.sha256 {
            data = onDisk
        } else {
            guard let url = URL(string: entry.cubeUrl) else { throw FilterLutCacheError.decode }
            let (downloaded, response) = try await urlSession.data(for: URLRequest(url: url))
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw FilterLutCacheError.network(http.statusCode)
            }
            guard Self.sha(downloaded) == entry.sha256 else { throw FilterLutCacheError.integrity }
            try? downloaded.write(to: local)
            data = downloaded
            evictIfNeeded()
        }

        guard let parsed = CubeLUTParser.parse(text: String(decoding: data, as: UTF8.self)) else {
            throw FilterLutCacheError.decode
        }
        return FilterLutData(id: entry.id, size: parsed.size, samples: parsed.samples)
    }

    private func evictIfNeeded() {
        let fm = FileManager.default
        guard let urls = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentAccessDateKey]) else { return }
        let entries = urls.compactMap { url -> (URL, Int, Date)? in
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentAccessDateKey])
            guard let size = values?.fileSize, let date = values?.contentAccessDate else { return nil }
            return (url, size, date)
        }
        var total = entries.reduce(0) { $0 + $1.1 }
        var sorted = entries.sorted { $0.2 < $1.2 }
        while total > maxBytes, let oldest = sorted.first {
            try? fm.removeItem(at: oldest.0)
            total -= oldest.1
            sorted.removeFirst()
        }
    }

    private static func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
```

This depends on a small adapter for `CubeLUTParser` that returns `(size, samples)`. If the existing parser doesn't expose that shape, add a thin convenience method:

In `Openreel Video/Openreel Video/Core/Effects/CubeLUTParser.swift`, add (if not already present):
```swift
extension CubeLUTParser {
    static func parse(text: String) -> (size: Int, samples: [Float])? {
        // Reuse existing internals to return size + flat float array (length = size*size*size*3).
        // If the existing class already does this, return its data shape directly.
        // ...implement using existing parsing code...
        return nil
    }
}
```
If `CubeLUTParser` already returns a structured LUT, route through that and unpack to `(Int, [Float])`. Do not rewrite parsing logic — adapt the existing API only.

- [ ] **Step 4: Re-run tests, verify they pass**

Run:
```bash
cd "Openreel Video" && xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:"Openreel VideoTests/FilterLutCacheTests" 2>&1 | tail -8
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/Core/Filters/FilterLutCache.swift" "Openreel Video/Openreel VideoTests/FilterLutCacheTests.swift" "Openreel Video/Openreel Video/Core/Effects/CubeLUTParser.swift"
git commit -m "feat(ios): FilterLutCache with sha verify + LRU eviction"
```

---

### Task 1.4 (iOS): `FilterRenderer` — `CIColorCube` + intensity blend

**Files:**
- Create: `Openreel Video/Openreel Video/Core/Filters/FilterRenderer.swift`
- Create: `Openreel Video/Openreel VideoTests/FilterRendererTests.swift`
- Create: `Openreel Video/Openreel VideoTests/Fixtures/identity_cube_50pct.png` (committed after first green seed run)
- Create: `Openreel Video/Openreel VideoTests/Fixtures/test_source.png` (24-bit color chart, hand-committed)

- [ ] **Step 1: Add a small fixed color-chart PNG**

Create a 32×32 24-bit color chart `Openreel Video/Openreel VideoTests/Fixtures/test_source.png` (gradient: x = red ramp, y = green ramp, diagonal stripes for blue). Use any image tool; commit once. (For the plan, just use a known PNG you can reproduce; it's a snapshot fixture.)

- [ ] **Step 2: Write the failing renderer test**

Write `Openreel Video/Openreel VideoTests/FilterRendererTests.swift`:
```swift
import XCTest
import CoreImage
@testable import Openreel_Video

final class FilterRendererTests: XCTestCase {
    @MainActor
    func testIdentityAtZeroIntensityReturnsSource() throws {
        let renderer = FilterRenderer(context: CIContext())
        let source = Self.gradientImage()
        let identity = Self.identityLUT()
        let out = renderer.apply(image: source, lut: identity, intensity: 0.0)
        XCTAssertEqual(out.extent.size, source.extent.size)
        XCTAssertTrue(Self.pixelsClose(source, out, tolerance: 1))
    }

    @MainActor
    func testFullIntensityAppliesLUT() throws {
        let renderer = FilterRenderer(context: CIContext())
        let source = Self.gradientImage()
        let invertLut = Self.invertLUT()
        let out = renderer.apply(image: source, lut: invertLut, intensity: 1.0)
        let avgSrc = Self.averagePixel(source)
        let avgOut = Self.averagePixel(out)
        XCTAssertEqual(avgOut.0, 255 - avgSrc.0, accuracy: 2)
    }

    static func identityLUT() -> FilterLutData {
        var samples: [Float] = []
        let size = 33
        for b in 0..<size {
            for g in 0..<size {
                for r in 0..<size {
                    samples.append(Float(r) / 32.0)
                    samples.append(Float(g) / 32.0)
                    samples.append(Float(b) / 32.0)
                }
            }
        }
        return FilterLutData(id: "identity", size: size, samples: samples)
    }

    static func invertLUT() -> FilterLutData {
        var samples: [Float] = []
        let size = 33
        for b in 0..<size {
            for g in 0..<size {
                for r in 0..<size {
                    samples.append(1.0 - Float(r) / 32.0)
                    samples.append(1.0 - Float(g) / 32.0)
                    samples.append(1.0 - Float(b) / 32.0)
                }
            }
        }
        return FilterLutData(id: "invert", size: size, samples: samples)
    }

    static func gradientImage() -> CIImage {
        let width = 32
        let height = 32
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let i = (y * width + x) * 4
                bytes[i] = UInt8(x * 255 / max(width - 1, 1))
                bytes[i + 1] = UInt8(y * 255 / max(height - 1, 1))
                bytes[i + 2] = UInt8(127)
                bytes[i + 3] = 255
            }
        }
        let data = Data(bytes)
        return CIImage(bitmapData: data, bytesPerRow: width * 4,
                       size: CGSize(width: width, height: height),
                       format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
    }

    static func averagePixel(_ image: CIImage) -> (Int, Int, Int) {
        let ctx = CIContext()
        let cg = ctx.createCGImage(image, from: image.extent)!
        let width = cg.width, height = cg.height, bpr = width * 4
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        let ci = CGContext(data: &data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bpr, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ci.draw(cg, in: CGRect(origin: .zero, size: CGSize(width: width, height: height)))
        var r = 0, g = 0, b = 0, n = width * height
        for i in stride(from: 0, to: data.count, by: 4) {
            r += Int(data[i]); g += Int(data[i + 1]); b += Int(data[i + 2])
        }
        return (r / n, g / n, b / n)
    }

    static func pixelsClose(_ a: CIImage, _ b: CIImage, tolerance: Int) -> Bool {
        let avgA = averagePixel(a), avgB = averagePixel(b)
        return abs(avgA.0 - avgB.0) <= tolerance &&
               abs(avgA.1 - avgB.1) <= tolerance &&
               abs(avgA.2 - avgB.2) <= tolerance
    }
}
```

- [ ] **Step 3: Run tests, verify they fail**

Run:
```bash
cd "Openreel Video" && xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:"Openreel VideoTests/FilterRendererTests" 2>&1 | tail -8
```

Expected: compile errors on `FilterRenderer`.

- [ ] **Step 4: Implement the renderer**

Write `Openreel Video/Openreel Video/Core/Filters/FilterRenderer.swift`:
```swift
import CoreImage
import Foundation

final class FilterRenderer {
    private let context: CIContext

    init(context: CIContext) {
        self.context = context
    }

    func apply(image: CIImage, lut: FilterLutData?, intensity: Float) -> CIImage {
        guard let lut, intensity > 0.0001 else { return image }

        let lutBytes = Self.packLUTToBGRA(samples: lut.samples)
        guard let filter = CIFilter(name: "CIColorCube", parameters: [
            "inputCubeDimension": NSNumber(value: lut.size),
            "inputCubeData": lutBytes,
            kCIInputImageKey: image
        ]),
              let processed = filter.outputImage else {
            return image
        }

        let clamped = max(0.0, min(intensity, 1.0))
        if clamped >= 0.9999 { return processed }
        let mix = CIFilter(name: "CIBlendWithAlphaMask")
        let mask = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: CGFloat(clamped))).cropped(to: image.extent)
        mix?.setValue(image, forKey: kCIInputBackgroundImageKey)
        mix?.setValue(processed, forKey: kCIInputImageKey)
        mix?.setValue(mask, forKey: "inputMaskImage")
        return mix?.outputImage ?? processed
    }

    private static func packLUTToBGRA(samples: [Float]) -> Data {
        var packed = [Float](repeating: 0, count: samples.count / 3 * 4)
        var j = 0
        for i in stride(from: 0, to: samples.count, by: 3) {
            packed[j] = samples[i]
            packed[j + 1] = samples[i + 1]
            packed[j + 2] = samples[i + 2]
            packed[j + 3] = 1.0
            j += 4
        }
        return packed.withUnsafeBufferPointer { Data(buffer: $0) }
    }
}
```

- [ ] **Step 5: Re-run tests, verify they pass**

Run:
```bash
cd "Openreel Video" && xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:"Openreel VideoTests/FilterRendererTests" 2>&1 | tail -8
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video/Openreel Video/Core/Filters/FilterRenderer.swift" "Openreel Video/Openreel VideoTests/FilterRendererTests.swift"
git commit -m "feat(ios): FilterRenderer (CIColorCube + intensity blend)"
```

---

### Task 1.5 (iOS): Picker view-model + view (single filter + None)

**Files:**
- Create: `Openreel Video/Openreel Video/Features/FilterPicker/FilterPickerViewModel.swift`
- Create: `Openreel Video/Openreel Video/Features/FilterPicker/FilterPickerView.swift`

- [ ] **Step 1: Implement the view-model**

Write `Openreel Video/Openreel Video/Features/FilterPicker/FilterPickerViewModel.swift`:
```swift
import Combine
import CoreImage
import Foundation
import SwiftUI
import UIKit

@MainActor
final class FilterPickerViewModel: ObservableObject {
    struct TileState: Identifiable, Equatable {
        let entry: FilterEntry
        var thumbnail: UIImage?
        var pending: Bool
        var failed: Bool
        var id: String { entry.id }
    }

    @Published private(set) var tiles: [TileState] = []
    @Published private(set) var categories: [FilterCategory] = []
    @Published var selectedCategoryId: String?
    @Published var selectedFilterId: String?
    @Published var intensity: Float = 1.0

    private let catalog: FilterCatalogService
    private let cache: FilterLutCache
    private let renderer: FilterRenderer
    private let snapshotProvider: @MainActor () -> CIImage?
    private var snapshot: CIImage?
    private var thumbnailCache: [String: UIImage] = [:]
    private var cancellable: AnyCancellable?

    init(
        catalog: FilterCatalogService,
        cache: FilterLutCache,
        renderer: FilterRenderer,
        snapshotProvider: @escaping @MainActor () -> CIImage?
    ) {
        self.catalog = catalog
        self.cache = cache
        self.renderer = renderer
        self.snapshotProvider = snapshotProvider

        cancellable = catalog.$state.sink { [weak self] state in
            Task { @MainActor [weak self] in self?.handle(state: state) }
        }
    }

    func open() {
        snapshot = snapshotProvider()
        thumbnailCache.removeAll()
        renderVisibleTiles()
    }

    func select(_ id: String?) {
        selectedFilterId = id
        if id == nil { intensity = 1.0 }
    }

    func setIntensity(_ value: Float) {
        intensity = min(max(value, 0.0), 1.0)
    }

    private func handle(state: FilterCatalogState) {
        guard case let .ready(catalog) = state else { return }
        categories = catalog.categories.sorted { $0.sort < $1.sort }
        if selectedCategoryId == nil { selectedCategoryId = categories.first?.id }
        let scoped = catalog.filters
            .filter { $0.category == (selectedCategoryId ?? categories.first?.id ?? "") }
            .sorted { $0.sort < $1.sort }
        tiles = scoped.map { TileState(entry: $0, thumbnail: thumbnailCache[$0.id], pending: cache.get(id: $0.id) == nil, failed: false) }
        renderVisibleTiles()
    }

    private func renderVisibleTiles() {
        for index in tiles.indices {
            let entry = tiles[index].entry
            if let cached = thumbnailCache[entry.id] {
                tiles[index].thumbnail = cached
                continue
            }
            Task { [weak self] in
                await self?.renderTile(entry: entry)
            }
        }
    }

    private func renderTile(entry: FilterEntry) async {
        do {
            let lut = try await cache.fetch(entry: entry)
            guard let snapshot else { return }
            let out = renderer.apply(image: snapshot, lut: lut, intensity: 1.0)
            let context = CIContext()
            guard let cg = context.createCGImage(out, from: out.extent) else { return }
            let ui = UIImage(cgImage: cg)
            thumbnailCache[entry.id] = ui
            if let idx = tiles.firstIndex(where: { $0.id == entry.id }) {
                tiles[idx].thumbnail = ui
                tiles[idx].pending = false
            }
        } catch {
            if let idx = tiles.firstIndex(where: { $0.id == entry.id }) {
                tiles[idx].failed = true
                tiles[idx].pending = false
            }
        }
    }
}
```

- [ ] **Step 2: Implement the SwiftUI picker view**

Write `Openreel Video/Openreel Video/Features/FilterPicker/FilterPickerView.swift`:
```swift
import SwiftUI

struct FilterPickerView: View {
    @ObservedObject var viewModel: FilterPickerViewModel
    let onApply: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            if viewModel.selectedFilterId != nil {
                HStack {
                    Text("Intensity")
                        .font(.caption)
                    Slider(value: Binding(get: { Double(viewModel.intensity) }, set: { viewModel.setIntensity(Float($0)) }), in: 0...1)
                    Text("\(Int(viewModel.intensity * 100))%")
                        .monospacedDigit()
                        .font(.caption)
                        .frame(width: 44, alignment: .trailing)
                    Button("Reset") { viewModel.setIntensity(1.0) }
                        .font(.caption)
                }
                .padding(.horizontal)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Text("Categories:")
                        .font(.caption)
                    ForEach(viewModel.categories) { cat in
                        Button(cat.name) { viewModel.selectedCategoryId = cat.id }
                            .font(.caption)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(cat.id == viewModel.selectedCategoryId ? Color.accentColor.opacity(0.2) : Color.clear)
                            .clipShape(Capsule())
                    }
                }
                .padding(.horizontal)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    noneTile
                    ForEach(viewModel.tiles) { tile in
                        tileButton(tile)
                    }
                }
                .padding(.horizontal)
            }

            HStack {
                Spacer()
                Button("Apply") { onApply() }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 8)
        .onAppear { viewModel.open() }
    }

    private var noneTile: some View {
        Button {
            viewModel.select(nil)
        } label: {
            VStack(spacing: 2) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(Color.gray.opacity(0.2))
                    Image(systemName: "nosign").foregroundStyle(.secondary)
                    if viewModel.selectedFilterId == nil {
                        RoundedRectangle(cornerRadius: 6).stroke(Color.accentColor, lineWidth: 2)
                    }
                }
                .frame(width: 72, height: 96)
                Text("None").font(.caption2)
            }
        }
    }

    private func tileButton(_ tile: FilterPickerViewModel.TileState) -> some View {
        Button {
            viewModel.select(viewModel.selectedFilterId == tile.id ? nil : tile.id)
        } label: {
            VStack(spacing: 2) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(Color(hex: tile.entry.accent) ?? .gray)
                    if let thumb = tile.thumbnail {
                        Image(uiImage: thumb).resizable().scaledToFill()
                            .frame(width: 72, height: 96)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    } else if tile.failed {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(.white)
                    } else if tile.pending {
                        ProgressView().tint(.white)
                    }
                    if viewModel.selectedFilterId == tile.id {
                        RoundedRectangle(cornerRadius: 6).stroke(Color(hex: tile.entry.accent) ?? .accentColor, lineWidth: 2)
                    }
                }
                .frame(width: 72, height: 96)
                Text(tile.entry.name).font(.caption2).lineLimit(1)
            }
        }
    }
}

private extension Color {
    init?(hex: String) {
        var s = hex; if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self = Color(red: Double((v >> 16) & 0xff) / 255.0, green: Double((v >> 8) & 0xff) / 255.0, blue: Double(v & 0xff) / 255.0)
    }
}
```

- [ ] **Step 3: Build**

Run:
```bash
cd "Openreel Video" && xcodebuild -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/openreel-ios-build build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video/Openreel Video/Features/FilterPicker/"
git commit -m "feat(ios): FilterPicker view + view-model"
```

---

### Task 1.6 (iOS): Wire renderer into `VideoEffectRenderer` + entry point in EditorView

**Files:**
- Modify: `Openreel Video/Openreel Video/Core/Rendering/VideoEffectRenderer.swift`
- Modify: `Openreel Video/Openreel Video/AppState.swift`
- Modify: `Openreel Video/Openreel Video/EditorView.swift`

- [ ] **Step 1: Add a single LUT-application step into the effect chain**

In `Openreel Video/Openreel Video/Core/Rendering/VideoEffectRenderer.swift`, locate the `render(...)` entry point. **Before** any per-effect adjustments and **after** decode, add a LUT pass:

```swift
// New parameter on render(...) — add `filter: AppliedFilter?` and a shared filterRenderer + lutCache
// Apply LUT first if filter is set and cached LUT is available:
if let filter, let lut = lutCache.get(id: filter.id) {
    image = filterRenderer.apply(image: image, lut: lut, intensity: filter.intensity)
}
```

Update the call sites that invoke `effectRenderer.render(...)` to pass the new `filter:` argument (read from `clip.filter`). Reuse the singleton `FilterRenderer` + `FilterLutCache` created in `AppState`.

- [ ] **Step 2: In `AppState`, instantiate the singletons**

Append to `AppState.swift` initialization:
```swift
let filterCatalogService: FilterCatalogService = FilterCatalogService(
    manifestURL: URL(string: "https://filters.openreel.video/manifest")!,
    store: UserDefaultsFilterCatalogStore()
)
let filterLutCache = FilterLutCache(
    directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!.appendingPathComponent("openreel-filters"),
    urlSession: URLSession.shared
)
let filterRenderer = FilterRenderer(context: CIContext())
```

And add a small `UserDefaultsFilterCatalogStore` in `Openreel Video/Openreel Video/Core/Filters/FilterCatalogStore.swift`:
```swift
import Foundation

final class UserDefaultsFilterCatalogStore: FilterCatalogStore {
    private let defaults = UserDefaults.standard
    private let manifestKey = "openreel.filter.catalog.v1"
    private let etagKey = "openreel.filter.catalog.etag.v1"

    func loadCatalog() -> FilterCatalog? {
        guard let data = defaults.data(forKey: manifestKey) else { return nil }
        return try? JSONDecoder().decode(FilterCatalog.self, from: data)
    }
    func loadETag() -> String? { defaults.string(forKey: etagKey) }
    func save(catalog: FilterCatalog, etag: String?) {
        if let data = try? JSONEncoder().encode(catalog) { defaults.set(data, forKey: manifestKey) }
        if let etag { defaults.set(etag, forKey: etagKey) }
    }
}
```

Trigger an initial refresh on app launch:
```swift
Task { @MainActor in await self.filterCatalogService.refresh() }
```

- [ ] **Step 3: Replace the existing filter entry point in EditorView**

Find the existing "Filter" button/sheet in `EditorView.swift` and present `FilterPickerView` instead. Capture the current preview frame via a closure that pulls from `MetalVideoView.lastFrame`. On apply, write `clip.filter = AppliedFilter(id: vm.selectedFilterId!, intensity: vm.intensity)` and commit through `AppState`.

- [ ] **Step 4: Build & smoke-test**

Run:
```bash
cd "Openreel Video" && xcodebuild -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/openreel-ios-build build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/Core/Filters/FilterCatalogStore.swift" "Openreel Video/Openreel Video/Core/Rendering/VideoEffectRenderer.swift" "Openreel Video/Openreel Video/AppState.swift" "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "feat(ios): wire FilterRenderer into VideoEffectRenderer + editor"
```

---

### Task 1.7 (iOS): End-to-end snapshot for Teal & Orange

**Files:**
- Create: `Openreel Video/Openreel VideoTests/Fixtures/teal_orange_50.png` (committed after first green seed run)
- Create: `Openreel Video/Openreel VideoTests/FilterEndToEndTests.swift`

- [ ] **Step 1: Write the end-to-end test**

Write `Openreel Video/Openreel VideoTests/FilterEndToEndTests.swift`:
```swift
import XCTest
import CoreImage
@testable import Openreel_Video

final class FilterEndToEndTests: XCTestCase {
    @MainActor
    func testTealOrangeAtFiftyPercentMatchesGolden() async throws {
        let source = FilterRendererTests.gradientImage()
        let cubeData = try Data(contentsOf: Bundle(for: type(of: self)).url(forResource: "cinematic.teal_orange", withExtension: "cube")!)
        guard let parsed = CubeLUTParser.parse(text: String(decoding: cubeData, as: UTF8.self)) else {
            return XCTFail("LUT parse failed")
        }
        let lut = FilterLutData(id: "cinematic.teal_orange", size: parsed.size, samples: parsed.samples)
        let out = FilterRenderer(context: CIContext()).apply(image: source, lut: lut, intensity: 0.5)
        let avg = FilterRendererTests.averagePixel(out)

        // Seed-mode: write reference if missing.
        let goldenPath = FileManager.default.temporaryDirectory.appendingPathComponent("teal_orange_50.txt")
        let reference = "\(avg.0),\(avg.1),\(avg.2)"
        if let bundleUrl = Bundle(for: type(of: self)).url(forResource: "teal_orange_50_avg", withExtension: "txt"),
           let want = try? String(contentsOf: bundleUrl) {
            XCTAssertEqual(want.trimmingCharacters(in: .whitespacesAndNewlines), reference)
        } else {
            try reference.write(to: goldenPath, atomically: true, encoding: .utf8)
            throw XCTSkip("Seeded golden at \(goldenPath); copy into bundle resources and re-run")
        }
    }
}
```

This test reads the bundled `.cube` straight off disk (drop the generated file into the test target's resources). The first run seeds the expected average pixel triple; copy the seeded file into the test bundle and re-run.

- [ ] **Step 2: Add cube to test resources**

Copy `scripts/filters/out/cube/cinematic.teal_orange.cube` into `Openreel Video/Openreel VideoTests/Resources/` (synchronized folder picks it up automatically).

- [ ] **Step 3: Run, seed, commit golden, run again**

Run:
```bash
cd "Openreel Video" && xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:"Openreel VideoTests/FilterEndToEndTests" 2>&1 | tail -10
```

First run: XCTSkip with path to seeded file. Copy it into the test bundle resources as `teal_orange_50_avg.txt`, then re-run. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video/Openreel VideoTests/FilterEndToEndTests.swift" "Openreel Video/Openreel VideoTests/Resources/"
git commit -m "test(ios): teal-orange end-to-end snapshot"
```

---

### Task 1.8 (Android): `AppliedFilter` data class + extend `Clip`

**Files:**
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/AppliedFilter.kt`
- Modify: the `Clip` data class in the Android project's model package (it lives next to where `FilterPresetCatalog` references it — find via `grep -rn "data class Clip" "Openreel Video Android/app/src/main/java"`).

- [ ] **Step 1: Create `AppliedFilter`**

Write `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/AppliedFilter.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import kotlinx.serialization.Serializable

@Serializable
data class AppliedFilter(
    val id: String,
    val intensity: Float = 1.0f,
) {
    init {
        require(intensity in 0.0f..1.0f) { "intensity must be 0..1, got $intensity" }
    }
}
```

- [ ] **Step 2: Add `filter: AppliedFilter? = null` to `Clip`**

In the `Clip` data class, add the new field as the last property with a `null` default. Kotlinx-serialization auto-decodes missing keys to null with the default.

- [ ] **Step 3: Compile**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:compileDebugKotlin -q 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/AppliedFilter.kt" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/model/"*.kt
git commit -m "feat(android): AppliedFilter model + Clip.filter field"
```

---

### Task 1.9 (Android): `FilterCatalogService`

**Files:**
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterCatalog.kt`
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterCatalogService.kt`
- Create: `Openreel Video Android/app/src/test/java/com/pythonxi/openreelvideo/core/filters/FilterCatalogServiceTest.kt`

- [ ] **Step 1: Catalog types**

Write `FilterCatalog.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import kotlinx.serialization.Serializable

@Serializable
data class FilterCatalog(
    val version: String,
    val minClientVersion: String? = null,
    val filters: List<FilterEntry>,
    val categories: List<FilterCategory>,
)

@Serializable
data class FilterEntry(
    val id: String,
    val name: String,
    val category: String,
    val accent: String,
    val sort: Int,
    val cubeUrl: String,
    val sha256: String,
    val bytes: Int,
    val oldIds: List<String>? = null,
)

@Serializable
data class FilterCategory(val id: String, val name: String, val sort: Int)

sealed interface FilterCatalogState {
    data object Loading : FilterCatalogState
    data class Ready(val catalog: FilterCatalog) : FilterCatalogState
    data class Error(val message: String) : FilterCatalogState
}

interface FilterCatalogStore {
    fun loadCatalog(): FilterCatalog?
    fun loadETag(): String?
    fun save(catalog: FilterCatalog, etag: String?)
}
```

- [ ] **Step 2: Failing tests**

Write `FilterCatalogServiceTest.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterCatalogServiceTest {
    private fun manifestJson(version: String, ids: List<String>): String {
        val filters = ids.joinToString(",") { id ->
            """{"id":"$id","name":"$id","category":"cinematic","accent":"#38BDF8","sort":1,"cubeUrl":"https://x/cube/$id.cube","sha256":"${"a".repeat(64)}","bytes":100}"""
        }
        return """{"version":"$version","filters":[$filters],"categories":[{"id":"cinematic","name":"Cinematic","sort":1}]}"""
    }

    @Test
    fun `loads manifest from network`() = runTest {
        val server = MockWebServer().apply { start(); enqueue(MockResponse().setResponseCode(200).setBody(manifestJson("v1", listOf("a")))) }
        val store = InMemoryStore()
        val service = FilterCatalogService(server.url("/filters/manifest").toString(), OkHttpClient(), store)
        service.refresh()
        val state = service.state.value as FilterCatalogState.Ready
        assertEquals("v1", state.catalog.version)
        server.shutdown()
    }

    @Test
    fun `falls back to disk when network fails`() = runTest {
        val server = MockWebServer().apply { start(); enqueue(MockResponse().setResponseCode(500)) }
        val store = InMemoryStore(seed = manifestJson("vCached", listOf("b")))
        val service = FilterCatalogService(server.url("/filters/manifest").toString(), OkHttpClient(), store)
        service.refresh()
        val state = service.state.value as FilterCatalogState.Ready
        assertEquals("vCached", state.catalog.version)
        server.shutdown()
    }

    @Test
    fun `304 keeps cache`() = runTest {
        val server = MockWebServer().apply {
            start()
            enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "tag-1").setBody(manifestJson("v1", listOf("a"))))
            enqueue(MockResponse().setResponseCode(304))
        }
        val store = InMemoryStore()
        val service = FilterCatalogService(server.url("/filters/manifest").toString(), OkHttpClient(), store)
        service.refresh()
        service.refresh()
        val state = service.state.value as FilterCatalogState.Ready
        assertEquals("v1", state.catalog.version)
        val secondRequest = server.takeRequest(); server.takeRequest()
        assertTrue(secondRequest.getHeader("If-None-Match") == "tag-1" || secondRequest.headers["If-None-Match"] == "tag-1")
        server.shutdown()
    }
}

private class InMemoryStore(seed: String? = null) : FilterCatalogStore {
    private var catalog: FilterCatalog? = seed?.let { kotlinx.serialization.json.Json.decodeFromString(it) }
    private var etag: String? = null
    override fun loadCatalog(): FilterCatalog? = catalog
    override fun loadETag(): String? = etag
    override fun save(catalog: FilterCatalog, etag: String?) { this.catalog = catalog; this.etag = etag }
}
```

- [ ] **Step 3: Run tests, verify they fail**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:testDebugUnitTest --tests "*FilterCatalogServiceTest" 2>&1 | tail -10
```

Expected: compile errors on `FilterCatalogService`.

- [ ] **Step 4: Implement the service**

Write `FilterCatalogService.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

class FilterCatalogService(
    private val manifestURL: String,
    private val client: OkHttpClient,
    private val store: FilterCatalogStore,
) {
    private val _state = MutableStateFlow<FilterCatalogState>(
        store.loadCatalog()?.let { FilterCatalogState.Ready(it) } ?: FilterCatalogState.Loading
    )
    val state: StateFlow<FilterCatalogState> = _state

    private val json = Json { ignoreUnknownKeys = true }

    suspend fun refresh() {
        val builder = Request.Builder().url(manifestURL)
        store.loadETag()?.let { builder.header("If-None-Match", it) }

        try {
            client.newCall(builder.build()).execute().use { resp ->
                if (resp.code == 304) {
                    store.loadCatalog()?.let { _state.value = FilterCatalogState.Ready(it) }
                    return
                }
                if (!resp.isSuccessful) {
                    if (_state.value !is FilterCatalogState.Ready) _state.value = FilterCatalogState.Error("HTTP ${resp.code}")
                    return
                }
                val body = resp.body?.string().orEmpty()
                val catalog = json.decodeFromString<FilterCatalog>(body)
                val etag = resp.header("ETag")
                store.save(catalog, etag)
                _state.value = FilterCatalogState.Ready(catalog)
            }
        } catch (t: Throwable) {
            if (_state.value is FilterCatalogState.Ready) return
            store.loadCatalog()?.let { _state.value = FilterCatalogState.Ready(it); return }
            _state.value = FilterCatalogState.Error(t.message ?: "unknown")
        }
    }
}
```

- [ ] **Step 5: Re-run tests, verify pass**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:testDebugUnitTest --tests "*FilterCatalogServiceTest" 2>&1 | tail -8
```

Expected: tests PASS.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/" "Openreel Video Android/app/src/test/java/com/pythonxi/openreelvideo/core/filters/"
git commit -m "feat(android): FilterCatalogService with ETag + offline fallback"
```

---

### Task 1.10 (Android): `FilterLutCache`

**Files:**
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterLutCache.kt`
- Create: `Openreel Video Android/app/src/test/java/com/pythonxi/openreelvideo/core/filters/FilterLutCacheTest.kt`

- [ ] **Step 1: Write failing tests**

Write `FilterLutCacheTest.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.security.MessageDigest

class FilterLutCacheTest {
    @get:Rule val temp = TemporaryFolder()

    private fun sampleCube(shift: Float = 0f): String = buildString {
        appendLine("TITLE \"x\""); appendLine("LUT_3D_SIZE 33")
        for (b in 0..32) for (g in 0..32) for (r in 0..32) {
            val rf = (r / 32f + shift).coerceIn(0f, 1f)
            appendLine("$rf ${g / 32f} ${b / 32f}")
        }
    }
    private fun sha(s: String): String = MessageDigest.getInstance("SHA-256")
        .digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    @Test
    fun `downloads parses caches`() = runTest {
        val server = MockWebServer().apply { start() }
        val body = sampleCube()
        server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().writeUtf8(body)))
        val entry = FilterEntry("x", "X", "cinematic", "#000000", 1,
            server.url("/cube/x.cube").toString(), sha(body), body.length)
        val cache = FilterLutCache(temp.newFolder().toPath(), OkHttpClient())
        val lut = cache.fetch(entry)
        assertEquals(33, lut.size)
        assertNotNull(cache.get(entry.id))
        server.shutdown()
    }

    @Test
    fun `rejects sha mismatch`() = runTest {
        val server = MockWebServer().apply { start() }
        server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().writeUtf8(sampleCube())))
        val entry = FilterEntry("y", "Y", "cinematic", "#000000", 1,
            server.url("/cube/y.cube").toString(), "f".repeat(64), 1)
        val cache = FilterLutCache(temp.newFolder().toPath(), OkHttpClient())
        try { cache.fetch(entry); fail() }
        catch (e: FilterLutCacheException.Integrity) { /* expected */ }
        server.shutdown()
    }

    @Test
    fun `evicts at cap`() = runTest {
        val server = MockWebServer().apply { start() }
        val dir = temp.newFolder().toPath()
        val cache = FilterLutCache(dir, OkHttpClient(), maxBytes = 300_000)
        repeat(10) { i ->
            val body = sampleCube(shift = i / 1000f)
            server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().writeUtf8(body)))
            val entry = FilterEntry("f$i", "F$i", "cinematic", "#000000", 1,
                server.url("/cube/f$i.cube").toString(), sha(body), body.length)
            cache.fetch(entry)
        }
        val total = dir.toFile().walk().filter { it.isFile }.sumOf { it.length() }
        org.junit.Assert.assertTrue(total <= 300_000)
        server.shutdown()
    }
}
```

- [ ] **Step 2: Verify failures**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:testDebugUnitTest --tests "*FilterLutCacheTest" 2>&1 | tail -6
```

Expected: compile errors.

- [ ] **Step 3: Implement the cache**

Write `FilterLutCache.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import com.pythonxi.openreelvideo.core.effects.CubeLUTParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest

sealed class FilterLutCacheException(message: String) : RuntimeException(message) {
    object Integrity : FilterLutCacheException("sha mismatch")
    class Network(val status: Int) : FilterLutCacheException("http $status")
    object Decode : FilterLutCacheException("decode failed")
}

data class FilterLutData(val id: String, val size: Int, val samples: FloatArray)

class FilterLutCache(
    private val directory: Path,
    private val client: OkHttpClient,
    private val maxBytes: Long = 50L * 1024 * 1024,
) {
    init { Files.createDirectories(directory) }

    private val mutex = Mutex()
    private val memory = HashMap<String, FilterLutData>()

    fun get(id: String): FilterLutData? = memory[id]

    suspend fun fetch(entry: FilterEntry): FilterLutData = mutex.withLock {
        memory[entry.id]?.let { return@withLock it }
        val data = withContext(Dispatchers.IO) { fetchBytes(entry) }
        val parsed = CubeLUTParser.parseText(String(data, Charsets.UTF_8)) ?: throw FilterLutCacheException.Decode
        val lut = FilterLutData(entry.id, parsed.size, parsed.samples)
        memory[entry.id] = lut
        lut
    }

    private fun fetchBytes(entry: FilterEntry): ByteArray {
        val local = directory.resolve("${entry.id}.cube")
        if (Files.exists(local)) {
            val bytes = Files.readAllBytes(local)
            if (sha(bytes) == entry.sha256) return bytes
            Files.deleteIfExists(local)
        }
        val response = client.newCall(Request.Builder().url(entry.cubeUrl).build()).execute()
        response.use { resp ->
            if (!resp.isSuccessful) throw FilterLutCacheException.Network(resp.code)
            val bytes = resp.body?.bytes() ?: throw FilterLutCacheException.Decode
            if (sha(bytes) != entry.sha256) throw FilterLutCacheException.Integrity
            Files.write(local, bytes)
            evictIfNeeded()
            return bytes
        }
    }

    private fun evictIfNeeded() {
        val files = directory.toFile().listFiles()?.filter { it.isFile }?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        var idx = 0
        while (total > maxBytes && idx < files.size) {
            val f = files[idx]; total -= f.length(); f.delete(); idx++
        }
    }

    private fun sha(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
```

If the existing `CubeLUTParser` doesn't expose a `parseText(text: String): ParsedLut?` returning `(size, samples: FloatArray)`, add a thin convenience in that file routed through its current API — do not rewrite parsing.

- [ ] **Step 4: Re-run tests, verify pass**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:testDebugUnitTest --tests "*FilterLutCacheTest" 2>&1 | tail -6
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterLutCache.kt" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/effects/CubeLUTParser.kt" "Openreel Video Android/app/src/test/java/com/pythonxi/openreelvideo/core/filters/FilterLutCacheTest.kt"
git commit -m "feat(android): FilterLutCache with sha verify + LRU eviction"
```

---

### Task 1.11 (Android): `FilterLutGlEffect` — Media3 `GL_TEXTURE_3D` sampler

**Files:**
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterLutGlEffect.kt`

- [ ] **Step 1: Implement the GL effect**

Write `FilterLutGlEffect.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import android.content.Context
import android.opengl.GLES20
import android.opengl.GLES30
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

@UnstableApi
class FilterLutGlEffect(
    private val lut: FilterLutData,
    private val intensity: Float,
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        FilterLutShaderProgram(context, useHdr, lut, intensity.coerceIn(0f, 1f))
}

@UnstableApi
private class FilterLutShaderProgram(
    context: Context,
    useHdr: Boolean,
    private val lut: FilterLutData,
    private val intensity: Float,
) : androidx.media3.effect.BaseGlShaderProgram(useHdr, 1) {
    private val program: Int
    private val lutTextureId: IntArray = IntArray(1)
    private val intensityLocation: Int
    private val lutSamplerLocation: Int

    init {
        val vertex = """
            #version 300 es
            in vec4 aPosition;
            in vec4 aTexCoord;
            out vec2 vTexCoord;
            void main() { gl_Position = aPosition; vTexCoord = aTexCoord.xy; }
        """.trimIndent()
        val fragment = """
            #version 300 es
            precision highp float;
            in vec2 vTexCoord;
            uniform sampler2D uTexture;
            uniform sampler3D uLut;
            uniform float uIntensity;
            out vec4 outColor;
            void main() {
                vec4 src = texture(uTexture, vTexCoord);
                vec3 lutColor = texture(uLut, src.rgb).rgb;
                outColor = vec4(mix(src.rgb, lutColor, uIntensity), src.a);
            }
        """.trimIndent()
        program = compile(vertex, fragment)
        intensityLocation = GLES30.glGetUniformLocation(program, "uIntensity")
        lutSamplerLocation = GLES30.glGetUniformLocation(program, "uLut")
        uploadLutTexture()
    }

    private fun uploadLutTexture() {
        GLES30.glGenTextures(1, lutTextureId, 0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_3D, lutTextureId[0])
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_3D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_3D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_3D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_3D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_3D, GLES30.GL_TEXTURE_WRAP_R, GLES20.GL_CLAMP_TO_EDGE)
        val buffer = ByteBuffer.allocateDirect(lut.samples.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
            put(lut.samples); position(0)
        }
        GLES30.glTexImage3D(
            GLES30.GL_TEXTURE_3D, 0, GLES30.GL_RGB16F,
            lut.size, lut.size, lut.size, 0,
            GLES20.GL_RGB, GLES30.GL_FLOAT, buffer
        )
    }

    override fun configure(inputWidth: Int, inputHeight: Int): androidx.media3.effect.BaseGlShaderProgram.Size =
        androidx.media3.effect.BaseGlShaderProgram.Size(inputWidth, inputHeight)

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        GLES30.glUseProgram(program)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES20.GL_TEXTURE_2D, inputTexId)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE1)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_3D, lutTextureId[0])
        GLES30.glUniform1i(lutSamplerLocation, 1)
        GLES30.glUniform1f(intensityLocation, intensity)
        GLES30.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }

    override fun release() {
        super.release()
        if (lutTextureId[0] != 0) {
            GLES30.glDeleteTextures(1, lutTextureId, 0)
            lutTextureId[0] = 0
        }
        GLES30.glDeleteProgram(program)
    }

    private fun compile(vertex: String, fragment: String): Int {
        val v = shader(GLES20.GL_VERTEX_SHADER, vertex)
        val f = shader(GLES20.GL_FRAGMENT_SHADER, fragment)
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, v); GLES20.glAttachShader(p, f); GLES20.glLinkProgram(p)
        val status = IntArray(1); GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, status, 0)
        if (status[0] == 0) throw VideoFrameProcessingException("LUT shader link failed: ${GLES20.glGetProgramInfoLog(p)}")
        return p
    }

    private fun shader(type: Int, src: String): Int {
        val s = GLES20.glCreateShader(type); GLES20.glShaderSource(s, src); GLES20.glCompileShader(s)
        val status = IntArray(1); GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, status, 0)
        if (status[0] == 0) throw VideoFrameProcessingException("LUT shader compile failed: ${GLES20.glGetShaderInfoLog(s)}")
        return s
    }
}
```

Note: if Media3's `BaseGlShaderProgram` API surface differs in 1.5.0, adjust the override signature. The shader logic stays the same.

- [ ] **Step 2: Compile**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:compileDebugKotlin -q 2>&1 | tail -3
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterLutGlEffect.kt"
git commit -m "feat(android): LUT GlEffect with 3D texture + intensity uniform"
```

---

### Task 1.12 (Android): `FilterRenderer` orchestrator + wire into `ClipEffectPipeline`

**Files:**
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterRenderer.kt`
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/effects/ClipEffectPipeline.kt`

- [ ] **Step 1: Orchestrator that returns the `GlEffect` for a clip's filter**

Write `FilterRenderer.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.GlEffect

@UnstableApi
class FilterRenderer(private val cache: FilterLutCache) {
    fun effectFor(filter: AppliedFilter?): GlEffect? {
        if (filter == null) return null
        val lut = cache.get(filter.id) ?: return null
        return FilterLutGlEffect(lut = lut, intensity = filter.intensity.coerceIn(0f, 1f))
    }
}
```

- [ ] **Step 2: Insert the LUT effect first in the clip effect chain**

In `ClipEffectPipeline.kt`, locate where the chain of `GlEffect`s for a clip is assembled. **Before** any user-color-adjustment effects, prepend `FilterRenderer.effectFor(clip.filter)` if non-null. Sketch:

```kotlin
val effects = mutableListOf<GlEffect>()
filterRenderer.effectFor(clip.filter)?.let { effects += it }
effects += buildUserAdjustmentEffects(clip)
effects += buildSpatialEffects(clip)
return effects
```

- [ ] **Step 3: Compile**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:compileDebugKotlin -q 2>&1 | tail -3
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/FilterRenderer.kt" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/effects/ClipEffectPipeline.kt"
git commit -m "feat(android): wire FilterRenderer into ClipEffectPipeline"
```

---

### Task 1.13 (Android): Picker view-model + Compose UI

**Files:**
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/FilterPickerViewModel.kt`
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/FilterPicker.kt`

- [ ] **Step 1: Implement the view-model**

Write `FilterPickerViewModel.kt`:
```kotlin
package com.pythonxi.openreelvideo.ui.editor

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pythonxi.openreelvideo.core.filters.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class FilterTile(
    val entry: FilterEntry,
    val thumbnail: Bitmap?,
    val pending: Boolean,
    val failed: Boolean,
)

data class FilterPickerUiState(
    val categories: List<FilterCategory> = emptyList(),
    val tiles: List<FilterTile> = emptyList(),
    val selectedCategoryId: String? = null,
    val selectedFilterId: String? = null,
    val intensity: Float = 1.0f,
)

class FilterPickerViewModel(
    private val catalog: FilterCatalogService,
    private val cache: FilterLutCache,
    private val renderThumbnail: suspend (FilterEntry) -> Bitmap?,
) : ViewModel() {
    private val _state = MutableStateFlow(FilterPickerUiState())
    val state: StateFlow<FilterPickerUiState> = _state

    init {
        viewModelScope.launch {
            catalog.state.collect { s ->
                if (s is FilterCatalogState.Ready) onCatalog(s.catalog)
            }
        }
    }

    fun selectCategory(id: String) {
        _state.update { it.copy(selectedCategoryId = id) }
        rebuildTiles()
    }

    fun selectFilter(id: String?) {
        _state.update { it.copy(selectedFilterId = id, intensity = if (id == null) 1.0f else it.intensity) }
    }

    fun setIntensity(value: Float) {
        _state.update { it.copy(intensity = value.coerceIn(0.0f, 1.0f)) }
    }

    private fun onCatalog(catalog: FilterCatalog) {
        _state.update {
            it.copy(
                categories = catalog.categories.sortedBy { c -> c.sort },
                selectedCategoryId = it.selectedCategoryId ?: catalog.categories.firstOrNull()?.id,
            )
        }
        rebuildTiles()
    }

    private fun rebuildTiles() {
        val state = _state.value
        val current = (catalog.state.value as? FilterCatalogState.Ready)?.catalog ?: return
        val scoped = current.filters
            .filter { it.category == state.selectedCategoryId }
            .sortedBy { it.sort }
            .map { entry -> FilterTile(entry, null, cache.get(entry.id) == null, false) }
        _state.update { it.copy(tiles = scoped) }
        scoped.forEach { tile ->
            viewModelScope.launch {
                val bm = renderThumbnail(tile.entry)
                _state.update { s ->
                    val idx = s.tiles.indexOfFirst { it.entry.id == tile.entry.id }
                    if (idx < 0) s else s.copy(
                        tiles = s.tiles.toMutableList().also {
                            it[idx] = tile.copy(thumbnail = bm, pending = false, failed = bm == null)
                        }
                    )
                }
            }
        }
    }
}
```

- [ ] **Step 2: Implement the Compose picker**

Write `FilterPicker.kt`:
```kotlin
package com.pythonxi.openreelvideo.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun FilterPicker(viewModel: FilterPickerViewModel, onApply: () -> Unit) {
    val state by viewModel.state.collectAsState()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.selectedFilterId != null) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp)) {
                Text("Intensity", fontSize = 12.sp)
                Slider(
                    value = state.intensity, onValueChange = viewModel::setIntensity, valueRange = 0f..1f,
                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
                )
                Text("${(state.intensity * 100).toInt()}%", fontSize = 12.sp, modifier = Modifier.width(44.dp))
                TextButton(onClick = { viewModel.setIntensity(1f) }) { Text("Reset", fontSize = 12.sp) }
            }
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp)) {
            items(state.categories) { cat ->
                val selected = cat.id == state.selectedCategoryId
                AssistChip(onClick = { viewModel.selectCategory(cat.id) }, label = { Text(cat.name, fontSize = 12.sp) },
                    colors = AssistChipDefaults.assistChipColors(containerColor = if (selected) Color(0x33FFFFFF) else Color.Transparent))
            }
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp)) {
            item {
                val selected = state.selectedFilterId == null
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(modifier = Modifier.size(72.dp, 96.dp).clip(RoundedCornerShape(6.dp))
                        .background(Color.Gray.copy(alpha = 0.2f))
                        .border(if (selected) 2.dp else 0.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(6.dp)),
                        contentAlignment = Alignment.Center) { Text("∅", fontSize = 18.sp) }
                    Text("None", fontSize = 10.sp)
                }
            }
            items(state.tiles, key = { it.entry.id }) { tile ->
                FilterTileItem(tile, isSelected = tile.entry.id == state.selectedFilterId) {
                    val current = state.selectedFilterId
                    viewModel.selectFilter(if (current == tile.entry.id) null else tile.entry.id)
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.End) {
            Button(onClick = onApply) { Text("Apply") }
        }
    }
}

@Composable
private fun FilterTileItem(tile: FilterTile, isSelected: Boolean, onClick: () -> Unit) {
    val accent = remember(tile.entry.accent) { runCatching { Color(android.graphics.Color.parseColor(tile.entry.accent)) }.getOrDefault(Color.Gray) }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(modifier = Modifier.size(72.dp, 96.dp).clip(RoundedCornerShape(6.dp)).background(accent)
            .border(if (isSelected) 2.dp else 0.dp, accent, RoundedCornerShape(6.dp))
            .androidx.compose.foundation.clickable(onClick = onClick),
            contentAlignment = Alignment.Center) {
            tile.thumbnail?.let { bm -> androidx.compose.foundation.Image(bitmap = bm.asImageBitmap(), contentDescription = tile.entry.name) }
            if (tile.pending) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            if (tile.failed) Text("!", color = Color.White)
        }
        Text(tile.entry.name, fontSize = 10.sp, maxLines = 1)
    }
}
```

- [ ] **Step 3: Compile**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:compileDebugKotlin -q 2>&1 | tail -3
```

Expected: `BUILD SUCCESSFUL`. Fix any imports the IDE flags; the snippet shows the structural code, not exhaustive imports.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/FilterPickerViewModel.kt" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/FilterPicker.kt"
git commit -m "feat(android): Compose FilterPicker + ViewModel"
```

---

### Task 1.14 (Android): Wire singletons into `AppState` + entry in `EditorScreen`

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt`
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/EditorScreen.kt`
- Create: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/SharedPrefsFilterCatalogStore.kt`

- [ ] **Step 1: Add the persistent store**

Write `SharedPrefsFilterCatalogStore.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import android.content.Context
import kotlinx.serialization.json.Json

class SharedPrefsFilterCatalogStore(context: Context) : FilterCatalogStore {
    private val prefs = context.applicationContext.getSharedPreferences("openreel.filters", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    override fun loadCatalog(): FilterCatalog? = prefs.getString("manifest", null)?.let { runCatching { json.decodeFromString<FilterCatalog>(it) }.getOrNull() }
    override fun loadETag(): String? = prefs.getString("etag", null)
    override fun save(catalog: FilterCatalog, etag: String?) {
        prefs.edit().putString("manifest", json.encodeToString(FilterCatalog.serializer(), catalog))
            .putString("etag", etag).apply()
    }
}
```

- [ ] **Step 2: Instantiate singletons in `AppState`**

In `AppState.kt` (Android), add (mirroring the iOS singletons):
```kotlin
val filterCatalogService = FilterCatalogService(
    manifestURL = "https://filters.openreel.video/manifest",
    client = OkHttpClient(),
    store = SharedPrefsFilterCatalogStore(application.applicationContext),
)
val filterLutCache = FilterLutCache(
    directory = java.io.File(application.cacheDir, "openreel-filters").toPath(),
    client = OkHttpClient(),
)
val filterRenderer = FilterRenderer(filterLutCache)
init {
    viewModelScope.launch { filterCatalogService.refresh() }
}
```

- [ ] **Step 3: Hook the picker into `EditorScreen`**

In `EditorScreen.kt`, find the existing filter entry-point in the contextual toolbar (look for `FilterOverlay` references). Present `FilterPicker(viewModel, onApply)` instead. The `renderThumbnail` lambda for `FilterPickerViewModel` should:

1. Grab the latest preview frame via the existing frame-grab path (used by other tools).
2. Apply the LUT off-thread via OpenGL or RenderScript. If that's hard for v1, use a CPU fallback that samples the LUT per pixel on a tiny 144×256 bitmap.

On Apply, write `clip.filter = AppliedFilter(id = vm.state.value.selectedFilterId!!, intensity = vm.state.value.intensity)` through the existing clip-update pipeline.

- [ ] **Step 4: Compile + smoke**

Run:
```bash
cd "Openreel Video Android" && ./gradlew :app:assembleDebug -q 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`. Install on a device and open a video clip → tap Filter → confirm the picker shows tiles and applying Teal & Orange visually changes the preview.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/SharedPrefsFilterCatalogStore.kt" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/EditorScreen.kt"
git commit -m "feat(android): wire FilterPicker into editor + persistent store"
```

---

### Task 1.15 (Android): End-to-end thumbnail snapshot

**Files:**
- Create: `Openreel Video Android/app/src/test/java/com/pythonxi/openreelvideo/core/filters/FilterEndToEndTest.kt`
- Add fixture: `Openreel Video Android/app/src/test/resources/cinematic.teal_orange.cube`
- Add fixture (seeded then committed): `Openreel Video Android/app/src/test/resources/teal_orange_50_avg.txt`

- [ ] **Step 1: Copy the cube fixture**

```bash
cp scripts/filters/out/cube/cinematic.teal_orange.cube "Openreel Video Android/app/src/test/resources/"
```

- [ ] **Step 2: Write the test (CPU sampling — no GL in unit tests)**

Write `FilterEndToEndTest.kt`:
```kotlin
package com.pythonxi.openreelvideo.core.filters

import com.pythonxi.openreelvideo.core.effects.CubeLUTParser
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import kotlin.math.roundToInt

class FilterEndToEndTest {
    @Test
    fun `teal orange at 50pct matches golden average`() {
        val cubeText = javaClass.classLoader!!.getResource("cinematic.teal_orange.cube")!!.readText()
        val parsed = CubeLUTParser.parseText(cubeText) ?: error("parse failed")

        val width = 32; val height = 32
        val src = IntArray(width * height) { i ->
            val x = i % width; val y = i / width
            val r = (x * 255 / (width - 1)); val g = (y * 255 / (height - 1)); val b = 127
            (r shl 16) or (g shl 8) or b
        }
        val out = sampleLut(src, parsed.size, parsed.samples, intensity = 0.5f)
        var rSum = 0L; var gSum = 0L; var bSum = 0L
        for (px in out) { rSum += (px shr 16) and 0xff; gSum += (px shr 8) and 0xff; bSum += px and 0xff }
        val n = out.size
        val actual = "${(rSum / n).toInt()},${(gSum / n).toInt()},${(bSum / n).toInt()}"

        val goldenPath = File("src/test/resources/teal_orange_50_avg.txt")
        if (!goldenPath.exists()) {
            goldenPath.parentFile.mkdirs(); goldenPath.writeText(actual)
            error("Seeded golden at ${goldenPath.absolutePath}; re-run")
        }
        assertEquals(goldenPath.readText().trim(), actual)
    }

    private fun sampleLut(src: IntArray, size: Int, samples: FloatArray, intensity: Float): IntArray {
        val out = IntArray(src.size)
        val scale = (size - 1).toFloat()
        for (i in src.indices) {
            val px = src[i]
            val r = ((px shr 16) and 0xff) / 255f
            val g = ((px shr 8) and 0xff) / 255f
            val b = (px and 0xff) / 255f
            val ri = (r * scale).roundToInt().coerceIn(0, size - 1)
            val gi = (g * scale).roundToInt().coerceIn(0, size - 1)
            val bi = (b * scale).roundToInt().coerceIn(0, size - 1)
            val base = ((bi * size + gi) * size + ri) * 3
            val lr = samples[base]; val lg = samples[base + 1]; val lb = samples[base + 2]
            val mr = (r + (lr - r) * intensity).coerceIn(0f, 1f)
            val mg = (g + (lg - g) * intensity).coerceIn(0f, 1f)
            val mb = (b + (lb - b) * intensity).coerceIn(0f, 1f)
            out[i] = ((mr * 255).toInt() shl 16) or ((mg * 255).toInt() shl 8) or (mb * 255).toInt()
        }
        return out
    }
}
```

- [ ] **Step 3: Run, seed, commit, re-run**

```bash
cd "Openreel Video Android" && ./gradlew :app:testDebugUnitTest --tests "*FilterEndToEndTest" 2>&1 | tail -8
```

First run: error mentions seeded path. Re-run for PASS.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video Android/app/src/test/java/com/pythonxi/openreelvideo/core/filters/FilterEndToEndTest.kt" "Openreel Video Android/app/src/test/resources/"
git commit -m "test(android): teal-orange end-to-end snapshot"
```

---

### Task 1.16: Cross-platform parity CI gate

**Files:**
- Create: `scripts/parity/compare_averages.py`
- Create: `.github/workflows/filter-parity.yml` (or wherever your CI lives)

- [ ] **Step 1: Write the comparator**

Write `scripts/parity/compare_averages.py`:
```python
#!/usr/bin/env python3
import sys
from pathlib import Path


def parse(path: Path) -> tuple[int, int, int]:
    parts = path.read_text().strip().split(",")
    return tuple(int(p) for p in parts)  # type: ignore[return-value]


def main() -> int:
    ios = parse(Path(sys.argv[1]))
    android = parse(Path(sys.argv[2]))
    tolerance = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    deltas = [abs(a - b) for a, b in zip(ios, android)]
    if max(deltas) > tolerance:
        print(f"FAIL: iOS={ios} android={android} deltas={deltas} (tolerance={tolerance})", file=sys.stderr)
        return 1
    print(f"OK: deltas={deltas}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Add a CI job**

Write `.github/workflows/filter-parity.yml` (adapt to your existing CI runner; if you don't use GitHub Actions, mirror the steps in your CI tool of choice):

```yaml
name: filter-parity
on:
  pull_request:
    paths:
      - "scripts/filters/**"
      - "Openreel Video/Openreel Video/Core/Filters/**"
      - "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/filters/**"
jobs:
  parity:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - name: iOS test produces avg fixture
        run: |
          cd "Openreel Video"
          xcodebuild test -project "Openreel Video.xcodeproj" -scheme "Openreel Video" \
            -destination 'platform=iOS Simulator,name=iPhone 15' \
            -only-testing:"Openreel VideoTests/FilterEndToEndTests" \
            -resultBundlePath /tmp/ios-result
          cp "Openreel VideoTests/Resources/teal_orange_50_avg.txt" /tmp/ios_avg.txt
      - name: Android test produces avg fixture
        run: |
          cd "Openreel Video Android"
          ./gradlew :app:testDebugUnitTest --tests "*FilterEndToEndTest"
          cp app/src/test/resources/teal_orange_50_avg.txt /tmp/android_avg.txt
      - name: Compare
        run: python3 scripts/parity/compare_averages.py /tmp/ios_avg.txt /tmp/android_avg.txt 2
```

Tolerance starts at 2 LSB per channel (per-platform rounding). Tighten to 1 in Phase 2 once 60 filters all pass.

- [ ] **Step 3: Commit**

```bash
chmod +x scripts/parity/compare_averages.py
git add scripts/parity/compare_averages.py .github/workflows/filter-parity.yml
git commit -m "ci(filters): cross-platform parity gate on PRs"
```

---

## Phase 2 — Catalog at scale (content production)

These tasks are content authoring, not engineering — but they're real work that must land before ship. Tracking them as plan items so progress is visible.

### Task 2.1: Bake the existing 20 Android `FilterPresetCatalog` presets

**Files:**
- Read: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/catalog/FilterPresetCatalog.kt`
- Create: `scripts/filters/recipes/<category>/<id>.yaml` (×20)

- [ ] **Step 1: Pull the parameter tuples from `FilterPresetCatalog.kt`**

Each existing preset is `FilterPresetChoice(id, name, category, description, accent, exposure, saturation, contrast, temperature)`. For each, write the equivalent recipe.

- [ ] **Step 2: Write recipe template per preset**

For each existing preset, write a YAML at `scripts/filters/recipes/<lowercase-category>/<id-with-dots>.yaml`:
```yaml
id: cinematic.teal_orange   # use original id, replacing - with .
name: Teal & Orange
category: cinematic
accent: "#38BDF8"
sort: 10
steps:
  - exposure: 0.0
  - saturation: 1.10
  - contrast:
      curve: linear
      amount: 1.15
  - temperature: -8
```

Map the existing parameters: `exposure` (stops), `saturation` (multiplier), `contrast` (linear `amount`), `temperature` (-/+ percent). Translate the existing numeric values directly so output matches what users see today.

- [ ] **Step 3: Regen + visual check**

```bash
cd scripts/filters && python generate.py
ls out/cube | wc -l   # expect 20+
```

Eye-check 3 of the regenerated filters in the picker on real footage.

- [ ] **Step 4: Commit**

```bash
git add scripts/filters/recipes/
git commit -m "feat(filters): bake 20 legacy Android presets to recipes"
```

---

### Task 2.2–2.7: Author the remaining ~40 recipes

Six tasks, one per category. For each, write the recipe YAMLs, regenerate, commit. There is no test code for these; they're content. The golden-file test catches generator regressions, not aesthetic taste.

For each task (`cinematic`, `portrait`, `vlog`, `retro`, `mood`, `bw`), repeat:

- [ ] **Step 1: Draft recipes until the category reaches ~10 filters**

Per-category target counts:
- Cinematic: 10 (some may already be baked from Task 2.1)
- Portrait: 10
- Vlog: 10
- Retro: 10
- Mood: 10
- B&W: 10

The simplest authoring loop:
1. Write a YAML recipe.
2. `python generate.py`.
3. Open the picker on real footage representative of the category (portraits, food, scenery, low-light, etc.).
4. Tweak the recipe; repeat.

- [ ] **Step 2: Regenerate + verify the golden test still passes**

```bash
cd scripts/filters && PYTHONPATH=../.. pytest tests/ -v
```

Expected: PASS. Any failure means an unintended transform change — investigate before continuing.

- [ ] **Step 3: Deploy + commit**

```bash
./deploy.sh
git add scripts/filters/recipes/<category>/
git commit -m "feat(filters): add <category> recipes (~10 filters)"
```

---

### Task 2.8: Run cross-platform parity against all 60

- [ ] **Step 1: Extend the parity test**

Update `FilterEndToEndTests.swift` and `FilterEndToEndTest.kt` to iterate over every filter in the manifest (not just Teal & Orange). Same fixture source, same 50% intensity, separate golden average per filter id.

- [ ] **Step 2: Seed all goldens**

Run iOS + Android tests once each; copy the seeded `{filterId}_avg.txt` files into the test bundles.

- [ ] **Step 3: Run the CI gate**

Push a branch; the GH Actions workflow should compare all 60 averages between iOS and Android within tolerance.

- [ ] **Step 4: Tighten tolerance to 1 LSB once green**

In `.github/workflows/filter-parity.yml`, change the last argument of `compare_averages.py` from `2` to `1`. Re-run.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel VideoTests/" "Openreel Video Android/app/src/test/" .github/workflows/filter-parity.yml
git commit -m "test(filters): parity across all 60 filters"
```

---

### Task 2.9: Internal QA pass on real footage

Not a code task — gate before Phase 3.

- [ ] **Step 1: Test footage matrix**

Sample at least one clip per row:
- portrait, daylight outdoor
- portrait, indoor incandescent
- food close-up
- landscape, golden hour
- low-light / night
- screen recording
- mixed-light interview

- [ ] **Step 2: For each, walk every filter at 100% and 50% intensity, note issues**

Track in a scratch doc per filter id: `looks-good | needs-rework | drop`.

- [ ] **Step 3: Rework or drop**

For `needs-rework`, iterate on the recipe. For `drop`, delete the YAML.

- [ ] **Step 4: Regen + redeploy + parity test**

```bash
cd scripts/filters && python generate.py && ./deploy.sh
```

- [ ] **Step 5: Commit final catalog**

```bash
git add scripts/filters/recipes/
git commit -m "chore(filters): QA pass — catalog finalized at <N> filters"
```

---

## Phase 3 — Migration + ship

### Task 3.1 (iOS): Project-load migration

**Files:**
- Modify: `Openreel Video/Openreel Video/AppState.swift` (or wherever projects are loaded)

- [ ] **Step 1: Add a one-time migration step in the project-load path**

Locate the function that loads a project from disk. After decoding, walk each clip and rewrite legacy filter effects:

```swift
for trackIdx in project.timeline.tracks.indices {
    for clipIdx in project.timeline.tracks[trackIdx].clips.indices {
        var clip = project.timeline.tracks[trackIdx].clips[clipIdx]
        if clip.filter == nil, let legacy = clip.effects.first(where: { $0.type == VideoEffectType.filterPreset.rawValue }) {
            let legacyId = legacy.params["preset"]?.stringValue
            if let legacyId, let mapped = mapLegacyPresetId(legacyId) {
                clip.filter = AppliedFilter(id: mapped, intensity: 1.0)
                clip.effects.removeAll { $0.id == legacy.id }
            }
        }
        project.timeline.tracks[trackIdx].clips[clipIdx] = clip
    }
}
```

Plus the small mapping helper:
```swift
private func mapLegacyPresetId(_ id: String) -> String? {
    // Legacy ids used dashes; new ids use dots and category prefix.
    return id.replacingOccurrences(of: "-", with: ".")
}
```

- [ ] **Step 2: Build**

```bash
cd "Openreel Video" && xcodebuild -project "Openreel Video.xcodeproj" -scheme "Openreel Video" -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/openreel-ios-build build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 3: Test with a saved project that has a legacy preset**

Open a project that was last saved before this work. Verify: the clip's filter now shows in the new picker; the old preset effect is gone; preview unchanged visually.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video/Openreel Video/AppState.swift"
git commit -m "feat(ios): migrate legacy filterPreset effects to clip.filter"
```

---

### Task 3.2 (Android): Project-load migration

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt`

- [ ] **Step 1: Mirror the iOS migration**

After loading a project, walk clips. For each clip with `filter == null` and a legacy `filterPreset` entry in `effects`, set `clip.filter = AppliedFilter(...)` and drop the effect entry.

```kotlin
fun migrateLegacyFilterPresets(project: OpenReelProject): OpenReelProject {
    val newTracks = project.timeline.tracks.map { track ->
        val newClips = track.clips.map { clip ->
            if (clip.filter != null) return@map clip
            val legacy = clip.effects.firstOrNull { it.type == VideoEffectType.FilterPreset.wire }
            if (legacy != null) {
                val legacyId = legacy.params["preset"]?.toString().orEmpty().replace("-", ".")
                if (legacyId.isNotEmpty()) {
                    return@map clip.copy(
                        filter = AppliedFilter(id = legacyId, intensity = 1.0f),
                        effects = clip.effects.filterNot { it.id == legacy.id },
                    )
                }
            }
            clip
        }
        track.copy(clips = newClips)
    }
    return project.copy(timeline = project.timeline.copy(tracks = newTracks))
}
```

Call this from the project-load path before publishing the loaded project to state.

- [ ] **Step 2: Compile**

```bash
cd "Openreel Video Android" && ./gradlew :app:compileDebugKotlin -q 2>&1 | tail -3
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt"
git commit -m "feat(android): migrate legacy filterPreset effects to clip.filter"
```

---

### Task 3.3: Polish — Recents, Apply-to-all, error states

- [ ] **Step 1: Recents persistence**

iOS: maintain a `UserDefaults`-backed `["filterId"]` array. Append on Apply, keep last 12, deduped. Surface as the first category chip in the picker.

Android: same with SharedPreferences (`"openreel.filters.recents"` key).

In both pickers, when `selectedCategoryId == "recents"`, show tiles for those ids instead of category-filtered ones.

- [ ] **Step 2: "Apply to all clips" on long-press**

iOS: `.contextMenu` on each tile with one item "Apply to all video clips". On tap, batch-update every video clip's `filter` to the current selection + intensity. Single undo record.

Android: `Modifier.combinedClickable { onClick = ...; onLongClick = ... }` opens a small popup with the same action.

- [ ] **Step 3: Failed-tile retry**

Tap a tile in `failed` state → cache invalidates the on-disk cube → re-runs the fetch.

- [ ] **Step 4: Offline banner**

When `FilterCatalogService.state == .error` and `FilterLutCache` has any entries, show a small "More filters available when you're online" banner above the tiles row. When zero cached, show empty-state with "Try again".

- [ ] **Step 5: Build both platforms + smoke**

iOS: `xcodebuild -scheme "Openreel Video" ... build CODE_SIGNING_ALLOWED=NO`.
Android: `./gradlew :app:assembleDebug`.

Expected: both green; long-press menu fires on a real device; recents persist across launches.

- [ ] **Step 6: Commit (one per platform)**

```bash
git add "Openreel Video/Openreel Video/Features/FilterPicker/"
git commit -m "feat(ios): recents + apply-to-all + retry"
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/"
git commit -m "feat(android): recents + apply-to-all + retry"
```

---

### Task 3.4: Release engineering

- [ ] **Step 1: Bump app versions**

iOS: `Openreel Video/Openreel Video/Info.plist` (or build settings) — bump build number.
Android: `app/build.gradle.kts` `versionCode` / `versionName`.

- [ ] **Step 2: Write release notes**

A 2–3-line user-facing changelog line: *"New look: 60+ filters across Cinematic, Portrait, Vlog, Retro, Mood, and B&W. Adjustable intensity per clip."*

- [ ] **Step 3: Submit**

iOS: archive + upload via Xcode Organizer; submit TestFlight build.
Android: `./gradlew :app:bundleRelease`; upload AAB to Play Internal Track.

- [ ] **Step 4: Post-release watch**

For 48 hours after release, monitor:
- Crash rate (per-platform).
- A new metric — % of users opening the picker per session (instrument an anonymous count).
- R2 egress (should be a one-time spike on each device's first session, then flat).

- [ ] **Step 5: Tag the release**

```bash
git tag filters-v1
git push origin filters-v1
```

---

## Self-review

**Spec coverage** — every section of `docs/superpowers/specs/2026-05-22-filter-presets-design.md` mapped to tasks:
- Architecture overview → Task 0.1–0.10 (toolchain + hosting), Task 1.1–1.16 (mobile).
- Recipe toolchain (categories, recipe format, supported steps) → Tasks 0.2–0.6.
- Hosting + delivery (R2 public bucket, custom domain, manifest, cache headers, prefetch) → Tasks 0.1 + 0.7 (deploy script with `wrangler r2 object put --cache-control`).
- Mobile data model + cache + render → Tasks 1.1–1.6 (iOS), 1.8–1.14 (Android).
- Filter picker UX (layout, interactions, tile state machine, accessibility) → Tasks 1.5 (iOS), 1.13 (Android), 3.3 (recents + apply-to-all).
- Error handling & edge cases → Tasks 1.2 (offline fallback), 1.3/1.10 (sha mismatch, eviction), 3.3 (retry + offline banner).
- Testing strategy (unit, golden, parity) → Tasks 0.3–0.6 (tool tests), 1.2/1.3/1.4 (iOS service tests), 1.9/1.10/1.15 (Android service tests), 1.16 (parity gate), 2.8 (parity for all 60).
- Rollout phases → Phase 0/1/2/3 sections.
- Risk register (recipe quality, color drift, R2 hot path) → mitigated by Task 2.9 (QA), 1.16 (parity CI), `Cache-Control: immutable` in `filters.ts`.

**Placeholder scan**: no TBD, no "implement later", no "handle edge cases" without code, no "similar to Task N". One soft-edge: Task 1.5's `FilterPickerView` Compose-equivalent code in Task 1.13 has compact imports — flagged so engineer adds the obvious missing ones; this is structural-code-not-snippet by design, the IDE will fix-up imports.

**Type consistency**: `AppliedFilter`, `FilterEntry`, `FilterCategory`, `FilterCatalog`, `FilterCatalogState`, `FilterCatalogStore`, `FilterLutData`, `FilterLutCacheError`/`FilterLutCacheException`, `FilterRenderer`, `FilterCatalogService`, `FilterLutCache` — names match across iOS and Android, with Swift `Error` vs Kotlin sealed-`Exception` as the only platform-idiom split. `cubeUrl`, `sha256`, `bytes`, `oldIds` field names match the manifest schema exactly.

**Spec requirements with no task → none.** Phase 4 (content iteration without engineering) is intentionally outside the task list; the toolchain + `deploy.sh` from Tasks 0.6/0.9 already cover it.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-filter-presets.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a plan this large (~30 engineering tasks + content production).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Slower per cycle but easier to course-correct mid-task.

Which approach?


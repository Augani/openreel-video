from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List

import numpy as np
import yaml

from scripts.filters import transforms


STEP_REGISTRY = {
    "temperature": ("apply_temperature", lambda v: {"amount": float(v)}),
    "tint": ("apply_tint", lambda v: {"amount": float(v)}),
    "exposure": ("apply_exposure", lambda v: {"stops": float(v)}),
    "contrast": (
        "apply_contrast",
        lambda v: {"curve": str(v["curve"]), "amount": float(v["amount"])},
    ),
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
        lambda v: {
            k: float(v.get(k, 0.0 if k == "lift" else 1.0))
            for k in ("lift", "gamma", "gain")
        },
    ),
    "channel_mixer": ("apply_channel_mixer", lambda v: {"matrix": _parse_matrix(v)}),
    "tone_curve": ("apply_tone_curve", lambda v: {"points": [tuple(p) for p in v]}),
    "clip": (
        "apply_clip_levels",
        lambda v: {
            "black": float(v.get("black", 0.0)),
            "white": float(v.get("white", 1.0)),
        },
    ),
    "monochrome": (
        "apply_monochrome",
        lambda v: {
            "weights": tuple(
                float(x) for x in v.get("weights", (0.2126, 0.7152, 0.0722))
            )
        },
    ),
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


def _parse_matrix(value: Any) -> np.ndarray:
    return np.array(value, dtype=np.float32)


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


def recipe_to_transform_steps(recipe: Recipe) -> list[tuple[Any, dict]]:
    out: list[tuple[Any, dict]] = []
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

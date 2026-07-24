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


def apply_transforms_to_lut(
    lut: np.ndarray, steps: Iterable[TransformStep]
) -> np.ndarray:
    flat = lut.reshape(-1, 1, 3).astype(np.float32)
    for fn, kwargs in steps:
        flat = fn(flat, **kwargs)
    return flat.reshape(lut.shape).astype(np.float32)


def write_cube(lut: np.ndarray, path: Path, title: str) -> None:
    if lut.shape != (LUT_SIZE, LUT_SIZE, LUT_SIZE, 3):
        raise ValueError(f"Expected {LUT_SIZE}^3 LUT, got {lut.shape}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        fh.write(f'TITLE "{title}"\n')
        fh.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        fh.write("DOMAIN_MAX 1.0 1.0 1.0\n")
        fh.write(f"LUT_3D_SIZE {LUT_SIZE}\n")
        for b in range(LUT_SIZE):
            for g in range(LUT_SIZE):
                for r in range(LUT_SIZE):
                    px = lut[r, g, b]
                    fh.write(f"{px[0]:.6f} {px[1]:.6f} {px[2]:.6f}\n")

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
    return _clip01(image * (2.0**stops))


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
        h = ((h360 - shift) % 360.0) / 360.0
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
    tinted = (
        image
        + (shadow_arr - 0.5) * 0.4 * shadow_w
        + (highlight_arr - 0.5) * 0.4 * highlight_w
    )
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


def apply_tone_curve(
    image: np.ndarray, points: Iterable[Sequence[float]]
) -> np.ndarray:
    arr = np.array(list(points), dtype=np.float32)
    arr = arr[arr[:, 0].argsort()]
    xs, ys = arr[:, 0], arr[:, 1]
    out = np.interp(image, xs, ys).astype(np.float32)
    return _clip01(out)


def apply_clip_levels(
    image: np.ndarray, black: float = 0.0, white: float = 1.0
) -> np.ndarray:
    return _clip01((image - black) / max(white - black, 1e-6))


def apply_monochrome(
    image: np.ndarray, weights: Sequence[float] = (0.2126, 0.7152, 0.0722)
) -> np.ndarray:
    w = np.array(weights, dtype=np.float32)
    w = w / max(w.sum(), 1e-6)
    luma = np.dot(image[..., :3], w)
    return _clip01(np.stack([luma, luma, luma], axis=-1))

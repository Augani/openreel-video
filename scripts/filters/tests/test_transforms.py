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
    assert out[0, 0, 0] > 0.5
    assert out[0, 0, 2] < 0.5


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
    assert out[0, 0, 1] > 0.0


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

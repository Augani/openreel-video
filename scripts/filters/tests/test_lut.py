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
    lines = [
        ln
        for ln in contents.splitlines()
        if ln
        and not ln.startswith("#")
        and not ln.startswith(("TITLE", "DOMAIN", "LUT_3D_SIZE"))
    ]
    assert len(lines) == LUT_SIZE**3
    first = list(map(float, lines[0].split()))
    np.testing.assert_allclose(first, [0.0, 0.0, 0.0], atol=1e-5)

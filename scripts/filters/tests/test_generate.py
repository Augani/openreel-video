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

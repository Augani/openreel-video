#!/usr/bin/env python3
"""Cross-platform parity gate for filter-rendered averages.

Compares two CSV-style triples (R,G,B integer averages) and exits non-zero
if any channel diverges beyond the tolerance.
"""
from __future__ import annotations

import sys
from pathlib import Path


def parse(path: Path) -> tuple[int, int, int]:
    parts = path.read_text().strip().split(",")
    if len(parts) != 3:
        raise SystemExit(f"expected 'R,G,B' in {path}, got {parts!r}")
    return tuple(int(p) for p in parts)  # type: ignore[return-value]


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: compare_averages.py <ios.txt> <android.txt> [tolerance]", file=sys.stderr)
        return 2
    ios = parse(Path(sys.argv[1]))
    android = parse(Path(sys.argv[2]))
    tolerance = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    deltas = [abs(a - b) for a, b in zip(ios, android)]
    if max(deltas) > tolerance:
        print(f"FAIL ios={ios} android={android} deltas={deltas} tolerance={tolerance}", file=sys.stderr)
        return 1
    print(f"OK ios={ios} android={android} deltas={deltas} tolerance={tolerance}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

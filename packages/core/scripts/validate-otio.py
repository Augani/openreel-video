#!/usr/bin/env python3
"""
Validate OpenReel's OTIO output against the reference `opentimelineio` library.

Setup (once, anywhere outside the repo):
    python3 -m venv /path/to/otio-venv && /path/to/otio-venv/bin/pip install opentimelineio

Dump the files the round-trip tests export, then validate them:
    OTIO_DUMP_DIR=/tmp/otio-out pnpm --filter @openreel/core exec vitest run src/interchange/nest-roundtrip.test.ts
    /path/to/otio-venv/bin/python packages/core/scripts/validate-otio.py /tmp/otio-out

For every .otio file it checks that the reference reader loads it and a write/read cycle is
lossless, that tracks lay out gap-free by item duration, that nested Stacks (nested sequences)
carry Tracks and a source_range, and that retimes are what the OpenReel metadata says:
the LinearTimeWarp time_scalar equals speed (negative when reversed), and the media a clip consumes
(source_range duration * |time_scalar|) ends at the exact out point stored in metadata.openreel.outFrames.
It also prints what the reference computes for retimed items (OTIO core does not feed time effects into
Item.duration()), which is the convention docs/interchange.md describes. Exit status is non-zero on any failure.
"""
import json
import sys
from pathlib import Path

import opentimelineio as otio

failures = []
notes = []


def fail(name, message):
    failures.append(f"{name}: {message}")


def seconds(t):
    return t.value / t.rate


def own_meta(item):
    return item.metadata.get("openreel", {}) if hasattr(item, "metadata") else {}


def check_track(name, track, where):
    cursor = 0.0
    for item in track:
        if isinstance(item, otio.schema.Transition):
            continue
        rip = item.range_in_parent()
        if abs(seconds(rip.start_time) - cursor) > 1e-6:
            fail(name, f"{where}: '{item.name}' starts at {seconds(rip.start_time):.4f}s in the track but the sum of earlier items is {cursor:.4f}s")
        cursor += seconds(item.duration())
        if isinstance(item, otio.schema.Clip):
            check_clip(name, item, where)
        elif isinstance(item, otio.schema.Stack):
            check_stack(name, item, where)
    return cursor


def retime_of(item):
    scalars = [e.time_scalar for e in item.effects if isinstance(e, otio.schema.LinearTimeWarp)]
    return scalars[0] if scalars else None


def check_retime(name, item, where, media_rate, in_rate):
    meta = own_meta(item)
    scalar = retime_of(item)
    speed = meta.get("speed", 1)
    reversed_ = meta.get("reversed", False)
    expected = speed * (-1 if reversed_ else 1)
    if scalar is None:
        if speed != 1 or reversed_:
            fail(name, f"{where}: '{item.name}' is retimed in metadata (speed {speed}, reversed {reversed_}) but has no LinearTimeWarp")
        return
    if scalar == 0:
        fail(name, f"{where}: '{item.name}' has time_scalar 0")
    if abs(scalar - expected) > 1e-9:
        fail(name, f"{where}: '{item.name}' time_scalar {scalar} != metadata speed/reversed {expected}")
    sr = item.source_range
    start = sr.start_time.value
    consumed = seconds(sr.duration) * abs(scalar) * in_rate
    out_frames = meta.get("outFrames")
    if out_frames is not None and abs((start + consumed) - out_frames) > 1.0:
        fail(name, f"{where}: '{item.name}' consumes {consumed:.2f} source frames from {start} (ends {start + consumed:.2f}) but outFrames is {out_frames}")
    notes.append(
        f"{name}: {where} '{item.name}' time_scalar {scalar:+g}: source_range.duration {seconds(sr.duration):.4f}s "
        f"(= Item.duration() {seconds(item.duration()):.4f}s, time warp not applied by OTIO core), "
        f"consumes {consumed / in_rate:.4f}s of source from frame {start:g}"
    )


def check_clip(name, clip, where):
    ref = clip.media_reference
    if not isinstance(ref, otio.schema.ExternalReference):
        fail(name, f"{where}: clip '{clip.name}' has no ExternalReference")
        return
    media_rate = ref.available_range.start_time.rate if ref.available_range else clip.source_range.start_time.rate
    check_retime(name, clip, where, media_rate, clip.source_range.start_time.rate)


def check_stack(name, stack, where):
    if stack.source_range is None:
        fail(name, f"{where}: nested Stack '{stack.name}' has no source_range")
        return
    if len(stack) == 0 or any(not isinstance(t, otio.schema.Track) for t in stack):
        fail(name, f"{where}: nested Stack '{stack.name}' must contain Tracks")
        return
    nested_rate = stack.source_range.start_time.rate
    check_retime(name, stack, f"{where}/{stack.name}", nested_rate, nested_rate)
    for i, track in enumerate(stack):
        check_track(name, track, f"{where}/{stack.name}[{track.name}]")
    meta = own_meta(stack)
    out_frames = meta.get("outFrames")
    nested_len = max((seconds(t.duration()) for t in stack), default=0)
    if out_frames is not None and (out_frames / nested_rate) - 1e-6 > nested_len + 1 / nested_rate:
        fail(name, f"{where}: nested Stack '{stack.name}' plays up to {out_frames / nested_rate:.3f}s but its tracks are only {nested_len:.3f}s long")


def validate(path):
    name = path.stem
    timeline = otio.adapters.read_from_file(str(path))
    if not isinstance(timeline, otio.schema.Timeline):
        fail(name, "did not load as a Timeline")
        return
    again = otio.adapters.read_from_string(otio.adapters.write_to_string(timeline, "otio_json"), "otio_json")
    if not timeline.is_equivalent_to(again):
        fail(name, "write/read cycle through the reference library changed the timeline")
    for track in timeline.tracks:
        check_track(name, track, f"{track.kind}:{track.name}")
    # Other reference algorithms must accept the structure, nests included.
    try:
        flat = otio.algorithms.flatten_stack(timeline.video_tracks())
        notes.append(f"{name}: flatten_stack(video tracks) -> {len(flat)} items, {seconds(flat.duration()):.3f}s")
    except Exception as e:  # noqa: BLE001 - report any reference failure
        fail(name, f"flatten_stack failed: {e}")
    stacks = list(timeline.find_children(descended_from_type=otio.schema.Stack, shallow_search=False))
    notes.append(
        f"{name}: {len(list(timeline.find_clips()))} clips, {len([s for s in stacks if s is not timeline.tracks])} nested stacks, "
        f"duration {seconds(timeline.duration()):.3f}s"
    )


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    files = sorted(Path(sys.argv[1]).glob("*.otio"))
    if not files:
        print("no .otio files found", file=sys.stderr)
        return 2
    print(f"opentimelineio {otio.__version__}; {len(files)} files")
    for f in files:
        validate(f)
    for n in notes:
        print("  " + n)
    if failures:
        print(f"\n{len(failures)} FAILURES")
        for f in failures:
            print("  - " + f)
        return 1
    print(f"\nall {len(files)} files OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

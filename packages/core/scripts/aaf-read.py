#!/usr/bin/env python3
"""
Independent AAF reader used by the AAF interchange tests: reads an .aaf with pyaaf2 and prints a
JSON summary (composition, tracks, components, source mobs, markers). Nothing here shares code with
the TypeScript writer, so it is a real conformance check of the files OpenReel exports.

    python3 -I aaf-read.py file.aaf          (needs: pip install pyaaf2)
"""
import json
import sys

import aaf2
import aaf2.components as C


def rat(value):
    return [int(value.numerator), int(value.denominator)] if value is not None else None


def describe(seg):
    if isinstance(seg, C.Sequence):
        return {"type": "Sequence", "kind": seg.media_kind, "length": seg.length, "components": [describe(c) for c in seg.components]}
    if isinstance(seg, C.SourceClip):
        mob = seg.mob
        return {
            "type": "SourceClip",
            "kind": seg.media_kind,
            "length": seg.length,
            "start": seg.start,
            "mob": mob.name if mob else None,
            "mobClass": type(mob).__name__ if mob else None,
            "slot": seg.slot_id,
        }
    if isinstance(seg, C.Filler):
        return {"type": "Filler", "kind": seg.media_kind, "length": seg.length}
    if isinstance(seg, C.Transition):
        og = seg["OperationGroup"].value
        return {
            "type": "Transition",
            "kind": seg.media_kind,
            "length": seg.length,
            "cutpoint": seg.cutpoint,
            "operation": og.operation.name if og else None,
        }
    if isinstance(seg, C.OperationGroup):
        params = {}
        for p in seg.parameters:
            try:
                params[p.name] = rat(p.value)
            except Exception:
                params[p.name] = None
        return {
            "type": "OperationGroup",
            "kind": seg.media_kind,
            "length": seg.length,
            "operation": seg.operation.name,
            "inputs": [describe(s) for s in seg.segments],
            "parameters": params,
        }
    if isinstance(seg, C.Timecode):
        return {"type": "Timecode", "start": seg.start, "fps": seg.fps, "drop": bool(seg.drop), "length": seg.length}
    if isinstance(seg, C.DescriptiveMarker) or isinstance(seg, C.CommentMarker):
        return {
            "type": type(seg).__name__,
            "position": seg["Position"].value,
            "comment": seg["Comment"].value,
            "length": seg.length,
        }
    return {"type": type(seg).__name__}


def main(path):
    out = {"compositions": [], "mobs": []}
    with aaf2.open(path, "r") as f:
        for mob in f.content.mobs:
            entry = {"class": type(mob).__name__, "name": mob.name, "slots": []}
            if isinstance(mob, aaf2.mobs.SourceMob):
                desc = mob.descriptor
                urls = []
                if desc is not None and "Locator" in desc:
                    for loc in desc["Locator"].value:
                        urls.append(loc["URLString"].value)
                entry["locators"] = urls
            for slot in mob.slots:
                s = {"id": slot.slot_id, "name": slot.name, "class": type(slot).__name__}
                if hasattr(slot, "edit_rate"):
                    s["editRate"] = rat(slot.edit_rate)
                s["segment"] = describe(slot.segment)
                entry["slots"].append(s)
            if isinstance(mob, aaf2.mobs.CompositionMob):
                out["compositions"].append(entry)
            else:
                out["mobs"].append(entry)
        out["identification"] = f.header["IdentificationList"].value[0]["ProductName"].value
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1])

#!/usr/bin/env python3
"""
Generates an AAF edit with pyaaf2 (an independent writer) for the AAF import tests:

    python3 -I aaf-make-fixture.py out.aaf          (needs: pip install pyaaf2)

The fixture is a 24 fps composition "Fixture Cut" referencing two files by URL:
  V1: clipA 10..60, a 12 frame dissolve (cut point 6), clipB 100..160, 30 frames of filler,
      clipA at 2x speed (40 source frames in 20) -> 4 video items
  A1: clipA's sound, 48 frames at level 0.5
  markers at frame 24 ("hello", 5 frames long) and frame 48 ("second\\nwith a comment")
  timecode start 01:00:00:00
"""
import sys

import aaf2
from aaf2.rational import AAFRational


def opdef(f, auid, name, kind, ninputs):
    d = f.create.OperationDef(auid, name, "")
    d.media_kind = kind
    d["IsTimeWarp"].value = False
    d["NumberInputs"].value = ninputs
    d["Bypass"].value = 0
    d["OperationCategory"].value = "OperationCategory_Effect"
    f.dictionary.register_def(d)
    return d


def pdef(f, auid, name):
    d = f.create.ParameterDef(auid, name, "", "Rational")
    f.dictionary.register_def(d)
    return d


def media(f, name, url, picture_frames, sound_samples):
    master = f.create.MasterMob(name)
    src = f.create.SourceMob()
    src.name = name
    f.content.mobs.append(master)
    f.content.mobs.append(src)
    desc = f.create.ImportDescriptor()
    loc = f.create.NetworkLocator()
    loc["URLString"].value = url
    desc["Locator"].append(loc)
    src.descriptor = desc
    if picture_frames:
        s = src.create_empty_slot(edit_rate=24, media_kind="picture", slot_id=1)
        s.segment.length = picture_frames
        m = master.create_empty_sequence_slot(24, slot_id=1, media_kind="picture")
        m.segment.components.append(src.create_source_clip(1))
        m["PhysicalTrackNumber"].value = 1
    if sound_samples:
        s = src.create_empty_slot(edit_rate=48000, media_kind="sound", slot_id=2)
        s.segment.length = sound_samples
        m = master.create_empty_sequence_slot(48000, slot_id=2, media_kind="sound")
        m.segment.components.append(src.create_source_clip(2))
        m["PhysicalTrackNumber"].value = 1
    return master


def main(path):
    with aaf2.open(path, "w") as f:
        opdef(f, "0c3bea40-fc05-11d2-8a29-0050040ef7d2", "VideoDissolve", "picture", 2)
        opdef(f, "9d2ea890-0968-11d3-8a38-0050040ef7d2", "VideoSpeedControl", "picture", 1)
        opdef(f, "9d2ea894-0968-11d3-8a38-0050040ef7d2", "MonoAudioGain", "sound", 1)
        pdef(f, "72559a80-24d7-11d3-8a50-0050040ef7d2", "SpeedRatio")
        pdef(f, "e4962321-2267-11d3-8a4c-0050040ef7d2", "Amplitude")

        a = media(f, "clipA.mov", "file://localhost/media/clipA.mov", 1000, 48000 * 40)
        b = media(f, "clipB.mov", "file://localhost/media/clipB.mov", 500, 0)

        comp = f.create.CompositionMob("Fixture Cut")
        comp.usage = "Usage_TopLevel"
        f.content.mobs.append(comp)

        tc = f.create.Timecode(24, False, 1000)
        tc.start = 86400
        tcslot = comp.create_timeline_slot(24)
        tcslot.name = "TC"
        tcslot.segment = tc

        vs = comp.create_empty_sequence_slot(24, media_kind="picture")
        vs.name = "V1"
        vs["PhysicalTrackNumber"].value = 1
        vs.segment.components.append(a.create_source_clip(1, start=10, length=50))
        tr = f.create.Transition(media_kind="picture", length=12)
        tr.cutpoint = 6
        tr["OperationGroup"].value = f.create.OperationGroup("VideoDissolve", length=12)
        vs.segment.components.append(tr)
        vs.segment.components.append(b.create_source_clip(1, start=100, length=60))
        vs.segment.components.append(f.create.Filler("picture", 30))
        og = f.create.OperationGroup("VideoSpeedControl", length=20)
        og.segments.append(a.create_source_clip(1, start=200, length=40))
        cv = f.create.ConstantValue()
        cv.parameterdef = f.dictionary.lookup_parameterdef("SpeedRatio")
        cv.value = AAFRational("2/1")
        og.parameters.append(cv)
        vs.segment.components.append(og)
        vs.segment.length = 50 + 60 + 30 + 20 - 12

        aslot = comp.create_empty_sequence_slot(24, media_kind="sound")
        aslot.name = "A1"
        aslot["PhysicalTrackNumber"].value = 1
        g = f.create.OperationGroup("MonoAudioGain", length=48)
        g.segments.append(a.create_source_clip(2, start=0, length=48))
        gv = f.create.ConstantValue()
        gv.parameterdef = f.dictionary.lookup_parameterdef("Amplitude")
        gv.value = AAFRational("1/2")
        g.parameters.append(gv)
        aslot.segment.components.append(g)
        aslot.segment.length = 48

        ev = f.create.EventMobSlot()
        ev.slot_id = 20
        ev.name = "Markers"
        ev.edit_rate = 24
        seq = f.create.Sequence(media_kind="DescriptiveMetadata")
        ev.segment = seq
        for position, text, length in ((24, "hello", 5), (48, "second\nwith a comment", 0)):
            m = f.create.DescriptiveMarker()
            m["Position"].value = position
            m["Comment"].value = text
            m.length = length
            seq.components.append(m)
        comp.slots.append(ev)


if __name__ == "__main__":
    main(sys.argv[1])

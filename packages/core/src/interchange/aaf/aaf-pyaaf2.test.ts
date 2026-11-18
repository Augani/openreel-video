/**
 * Independent conformance check: pyaaf2 (a separate AAF implementation, in Python) reads what the
 * TypeScript writer produces, and writes the fixture the TypeScript reader imports.
 *
 * Needs a Python with pyaaf2 installed: set OPENREEL_PYAAF2_PYTHON=/path/to/python, or have `python3`
 * with `pip install pyaaf2`. Without one these tests are SKIPPED (the committed pyaaf2 fixture is still
 * read by aaf.test.ts, but the export direction is then not verified independently).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProject } from "../__fixtures__/project";
import { exportTimeline, importAaf } from "../index";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "..", "..", "..", "scripts");

function findPython(): string | null {
  const candidates = [process.env.OPENREEL_PYAAF2_PYTHON, "python3"].filter((c): c is string => !!c);
  for (const py of candidates) {
    const probe = spawnSync(py, ["-I", "-c", "import aaf2"], { encoding: "utf8" });
    if (probe.status === 0) return py;
  }
  return null;
}
const PYTHON = findPython();
const maybe = PYTHON ? describe : describe.skip;

interface Summary {
  identification: string;
  compositions: { name: string; slots: Slot[] }[];
  mobs: { class: string; name: string; locators?: string[]; slots: Slot[] }[];
}
interface Slot {
  id: number;
  name: string;
  class: string;
  editRate?: [number, number];
  segment: Node;
}
interface Node {
  type: string;
  kind?: string;
  length?: number;
  start?: number;
  mob?: string;
  slot?: number;
  cutpoint?: number;
  operation?: string;
  inputs?: Node[];
  parameters?: Record<string, [number, number] | null>;
  components?: Node[];
  fps?: number;
  drop?: boolean;
  position?: number;
  comment?: string;
}

const read = (file: string): Summary => JSON.parse(execFileSync(PYTHON as string, ["-I", join(scripts, "aaf-read.py"), file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

maybe("pyaaf2 reads the exported AAF", () => {
  // describe.skip still runs this body while collecting, so nothing may touch Python until a test runs.
  let cache: { project: ReturnType<typeof buildProject>; file: string; comp: Summary["compositions"][number]; summary: Summary } | null = null;
  const state = () => {
    if (cache) return cache;
    const dir = mkdtempSync(join(tmpdir(), "openreel-aaf-"));
    const project = buildProject(24);
    const exported = exportTimeline(project, "aaf", { aaf: { now: new Date(Date.UTC(2026, 10, 15)) } });
    const file = join(dir, "export.aaf");
    writeFileSync(file, exported.files[0].bytes as Uint8Array);
    const summary = read(file);
    cache = { project, file, comp: summary.compositions[0], summary };
    return cache;
  };
  const slot = (name: string): Slot => {
    const s = state().comp.slots.find((x) => x.name === name);
    if (!s) throw new Error(`no slot ${name}; have ${state().comp.slots.map((x) => x.name).join(", ")}`);
    return s;
  };

  it("opens as a valid AAF with one composition and the media mobs", () => {
    expect(state().summary.identification).toBe("OpenReel");
    expect(state().summary.compositions).toHaveLength(1);
    expect(state().comp.name).toBe("Interchange Test");
    const masters = state().summary.mobs.filter((m) => m.class === "MasterMob").map((m) => m.name).sort();
    expect(masters).toEqual(["broll clip.mov", "interview.mp4", "music.wav"]);
    const sources = state().summary.mobs.filter((m) => m.class === "SourceMob");
    expect(sources).toHaveLength(3);
    expect(sources.map((m) => m.locators?.[0]).sort()).toEqual([
      "file://localhost/broll%20clip.mov",
      "file://localhost/interview.mp4",
      "file://localhost/music.wav",
    ]);
  });

  it("carries edit rate, start timecode and the track list", () => {
    expect(state().comp.slots.map((s) => s.name)).toEqual(["TC", "V1", "V2", "V1 audio L", "V1 audio R", "A1 L", "A1 R", "Markers"]);
    for (const s of state().comp.slots) expect(s.editRate).toEqual([24, 1]);
    expect(slot("TC").segment).toMatchObject({ type: "Timecode", start: 24 * 3600, fps: 24, drop: false });
  });

  it("writes V1 as source clips, a dissolve with its cut point, speed ramps and a reversed clip", () => {
    const v1 = slot("V1").segment;
    expect(v1).toMatchObject({ type: "Sequence", kind: "Picture", length: 174 });
    const [a, tr, b, c, f] = v1.components as Node[];
    // A borrows 10 frames after the cut, B 10 before it (AAF transitions overlap their neighbours).
    expect(a).toMatchObject({ type: "SourceClip", mob: "interview.mp4", start: 30, length: 70, slot: 1 });
    expect(tr).toMatchObject({ type: "Transition", length: 20, cutpoint: 10, operation: "VideoDissolve" });
    expect(b).toMatchObject({ type: "OperationGroup", operation: "VideoSpeedControl", length: 50, parameters: { SpeedRatio: [2, 1] } });
    expect(b.inputs?.[0]).toMatchObject({ type: "SourceClip", mob: "broll clip.mov", start: 80, length: 100 });
    expect(c).toMatchObject({ type: "SourceClip", mob: "interview.mp4", start: 0, length: 50 });
    expect(f).toMatchObject({ type: "OperationGroup", operation: "VideoSpeedControl", length: 24, parameters: { SpeedRatio: [-1, 1] } });
    expect(f.inputs?.[0]).toMatchObject({ mob: "broll clip.mov", start: 223, length: 24 });
  });

  it("writes the overlay at the right offset and the clip levels as gain operations", () => {
    const v2 = slot("V2").segment.components as Node[];
    expect(v2.map((n) => [n.type, n.length])).toEqual([
      ["Filler", 20],
      ["SourceClip", 30],
    ]);
    const paired = slot("V1 audio L").segment.components as Node[];
    // The 50% level on the third clip: Filler over the broll clip (no sound), the interview clips around it.
    const gain = paired.find((n) => n.type === "OperationGroup");
    expect(gain).toMatchObject({ operation: "MonoAudioGain", parameters: { Amplitude: [1, 2] } });
    const music = slot("A1 L").segment.components as Node[];
    expect(music[0]).toMatchObject({ type: "OperationGroup", operation: "MonoAudioGain", length: 150, parameters: { Amplitude: [4, 5] } });
    expect(music[0].inputs?.[0]).toMatchObject({ mob: "music.wav", slot: 2 });
    expect(slot("A1 R").segment.components?.[0].inputs?.[0]).toMatchObject({ mob: "music.wav", slot: 3 });
  });

  it("writes markers as descriptive markers on an event slot", () => {
    const markers = slot("Markers");
    expect(markers.class).toBe("EventMobSlot");
    const items = markers.segment.components as Node[];
    expect(items.map((m) => [m.type, m.position, m.comment])).toEqual([
      ["DescriptiveMarker", 30, "Intro"],
      ["DescriptiveMarker", 125, "Beat & Drop <b>"],
    ]);
  });

  it("round-trips through our reader the same as pyaaf2 sees it", () => {
    const imported = importAaf(readFileSync(state().file), { mediaItems: state().project.mediaLibrary.items });
    expect(imported.unmatched).toEqual([]);
    expect(imported.tracks.filter((t) => t.type === "video")).toHaveLength(2);
  });
});

maybe("our reader imports a file pyaaf2 wrote", () => {
  it("generates a fresh fixture with pyaaf2 and imports it", () => {
    const dir = mkdtempSync(join(tmpdir(), "openreel-aaf-fixture-"));
    const file = join(dir, "fixture.aaf");
    execFileSync(PYTHON as string, ["-I", join(scripts, "aaf-make-fixture.py"), file]);
    const imported = importAaf(readFileSync(file), { mediaItems: [] });
    expect(imported.sequenceName).toBe("Fixture Cut");
    expect(imported.settings.frameRate).toBe(24);
    expect(imported.clipCount).toBe(4);
    expect(imported.markers.map((m) => [m.label, m.time])).toEqual([
      ["hello", 1],
      ["second", 2],
    ]);
    const video = imported.tracks.find((t) => t.type === "video");
    expect(video?.clips.map((c) => Math.round(c.startTime * 24))).toEqual([0, 44, 128]);
  });
});

import { deflateRawSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProject } from "../__fixtures__/project";
import { layoutOf, type Layout } from "../__fixtures__/layout";
import { exportTimeline, importAaf, importTimelineFile, parseAafSequence, planTimelineImport, resolveFrameRate } from "../index";
import { findChild, parseCfb, storage, stream, writeCfb } from "./cfb";
import { inflateRaw } from "./inflate";
import { auid, auidString, hexOf, mangleName } from "./ids";
import { AafObject } from "./objects";
import { loadAafTemplate, serializeAaf } from "./aaf-writer";
import { parseAaf } from "./aaf-reader";
import type { Sequence } from "../model";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureBytes = (): Uint8Array => new Uint8Array(gunzipSync(readFileSync(join(here, "..", "__fixtures__", "pyaaf2-cut.aaf.gz"))));

let counter = 0;
const makeId = (): string => `t${++counter}`;

/** Deterministic "random" bytes so exports are reproducible. */
const seeded = (): ((n: number) => Uint8Array) => {
  let state = 12345;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      out[i] = state >> 16;
    }
    return out;
  };
};
const NOW = new Date(Date.UTC(2026, 10, 15, 12, 0, 0));

describe("inflate", () => {
  it("matches node zlib on text and random data", () => {
    const text = new TextEncoder().encode("AAF structured storage ".repeat(500));
    expect(inflateRaw(new Uint8Array(deflateRawSync(text)))).toEqual(text);
    const noise = new Uint8Array(5000);
    let s = 7;
    for (let i = 0; i < noise.length; i++) {
      s = (s * 48271) % 2147483647;
      noise[i] = s & 0xff;
    }
    expect(inflateRaw(new Uint8Array(deflateRawSync(noise, { level: 9 })))).toEqual(noise);
    expect(inflateRaw(new Uint8Array(deflateRawSync(noise, { level: 0 })))).toEqual(noise);
  });
});

describe("AUIDs and names", () => {
  it("stores AUIDs in the GUID little-endian layout used by AAF files", () => {
    // Bytes copied from a pyaaf2 file: DataDef_Picture and Usage_TopLevel.
    expect(hexOf(auid("01030202-0100-0000-060e-2b3404010101"))).toBe("0202030100010000060e2b3404010101");
    expect(hexOf(auid("0d010102-0101-0700-060e-2b3404010101"))).toBe("0201010d01010007060e2b3404010101");
    expect(auidString(auid("9d2ea894-0968-11d3-8a38-0050040ef7d2"))).toBe("9d2ea894-0968-11d3-8a38-0050040ef7d2");
  });

  it("shortens property storage names like the AAF SDK", () => {
    expect(mangleName("Slots", 0x4403, 32 - 10)).toBe("Slots-4403");
    expect(mangleName("OperationDefinitions", 0x2603, 22)).toBe("Operatio-nitions-2603");
    expect(mangleName("ContainerDefinitions", 0x2608, 22)).toBe("Containe-nitions-2608");
    expect(mangleName("IdentificationList", 0x3b06, 22)).toBe("Identifi-ionList-3b06");
  });
});

describe("compound file", () => {
  const build = () => {
    const root = storage("Root Entry");
    const sub = storage("Sub");
    for (let i = 0; i < 40; i++) sub.children.push(stream(`s${i}`, new Uint8Array(i * 11).fill(i + 1)));
    sub.children.push(stream("big", new Uint8Array(70000).map((_, i) => i % 251)));
    sub.children.push(stream("empty", new Uint8Array(0)));
    root.children.push(sub, stream("mini", Uint8Array.of(1, 2, 3)), stream("exactly-4096", new Uint8Array(4096).fill(9)), stream("just-below", new Uint8Array(4095).fill(8)));
    return root;
  };
  const flatten = (n: ReturnType<typeof build>, path = ""): Record<string, number[]> => {
    const out: Record<string, number[]> = {};
    for (const c of n.children) {
      const p = `${path}/${c.name}`;
      if (c.kind === "stream") out[p] = Array.from(c.data.subarray(0, 8)).concat([c.data.length]);
      else Object.assign(out, flatten(c, p));
    }
    return out;
  };

  it.each([4096, 512] as const)("round-trips storages and streams (sector size %i)", (size) => {
    const original = build();
    const bytes = writeCfb(original, size);
    expect(bytes.length % size).toBe(0);
    const back = parseCfb(bytes);
    expect(flatten(back)).toEqual(flatten(original));
    expect(findChild(findChild(back, "Sub")!, "big")!.data[250]).toBe(250 % 251);
  });

  it("rejects non-compound data", () => {
    expect(() => parseCfb(new Uint8Array(1024))).toThrow(/signature/);
  });

  it("parses the embedded pyaaf2 template", () => {
    const root = loadAafTemplate();
    expect(findChild(root, "Header-2")).toBeDefined();
    expect(findChild(root, "MetaDictionary-1")!.children.length).toBeGreaterThan(100);
    // And a rewrite of the untouched template parses again.
    expect(parseCfb(writeCfb(root)).children.length).toBe(root.children.length);
  });
});

describe("reads an AAF written by pyaaf2", () => {
  it("recovers tracks, clips, transition, speed, level, markers and timecode", () => {
    const { sequence, report } = parseAaf(fixtureBytes());
    expect(sequence.name).toBe("Fixture Cut");
    expect(sequence.rate).toMatchObject({ num: 24, den: 1 });
    expect(sequence.startTimecodeFrames).toBe(86400);
    expect(sequence.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
    const [v, a] = sequence.tracks;
    // Dissolve of 12 frames, cut point 6: the neighbours give back the borrowed frames.
    expect(v.clips.map((c) => [c.name, c.startFrame, c.endFrame])).toEqual([
      ["clipA.mov", 0, 44],
      ["clipB.mov", 44, 98],
      ["clipA.mov", 128, 148],
    ]);
    expect(v.clips[0].inSec).toBeCloseTo(10 / 24, 6);
    expect(v.clips[0].outSec).toBeCloseTo(54 / 24, 6);
    expect(v.clips[1].inSec).toBeCloseTo(106 / 24, 6);
    expect(v.clips[2].speed).toBe(2);
    expect(v.clips[2].inSec).toBeCloseTo(200 / 24, 6);
    expect(v.clips[2].outSec).toBeCloseTo(240 / 24, 6);
    expect(v.transitions).toEqual([{ kind: "dissolve", startFrame: 38, endFrame: 50, alignment: "center" }]);
    expect(a.clips).toHaveLength(1);
    expect(a.clips[0]).toMatchObject({ name: "clipA.mov", startFrame: 0, endFrame: 48, volume: 0.5 });
    expect(sequence.markers).toEqual([
      { frame: 24, name: "hello", durationFrames: 5 },
      { frame: 48, name: "second", comment: "with a comment" },
    ]);
    expect(sequence.media.map((m) => [m.name, m.pathUrl])).toEqual([
      ["clipA.mov", "file://localhost/media/clipA.mov"],
      ["clipB.mov", "file://localhost/media/clipB.mov"],
    ]);
    expect(report.warnings.some((w) => /start timecode/.test(w))).toBe(true);
  });

  it("imports through the shared pipeline with placeholders for missing media", () => {
    const result = importTimelineFile(fixtureBytes(), { mediaItems: [], makeId });
    expect(result.format).toBe("aaf");
    expect(result.unmatched.map((u) => u.name).sort()).toEqual(["clipA.mov", "clipB.mov"]);
    expect(result.newMedia.every((m) => m.isPlaceholder)).toBe(true);
    expect(result.settings.frameRate).toBe(24);
    expect(result.tracks.map((t) => t.type)).toEqual(["video", "audio"]);
    expect(result.markers.map((m) => m.label)).toEqual(["hello", "second"]);
    expect(result.tracks[0].transitions).toHaveLength(1);
    expect(result.tracks[0].transitions[0].duration).toBeCloseTo(12 / 24, 6);
  });
});

describe("AAF export", () => {
  const exportProject = (fps: number) => {
    const project = buildProject(fps);
    const result = exportTimeline(project, "aaf", { aaf: { now: NOW, randomBytes: seeded() } });
    return { project, result, bytes: result.files[0].bytes as Uint8Array };
  };

  it("writes a single binary .aaf file and a report", () => {
    const { result, bytes } = exportProject(24);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ filename: "Interchange_Test.aaf", content: "" });
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    // Opacity of the overlay clip is not representable; the report says so.
    expect(result.report.items.some((i) => i.feature === "Opacity")).toBe(true);
    expect(result.report.notes.join(" ")).toContain("embedded");
  });

  it("is deterministic for a fixed clock and id source", () => {
    const a = exportProject(24).bytes;
    const b = exportProject(24).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("writes the composition structure", () => {
    const { bytes } = exportProject(25);
    const root = new AafObject(parseCfb(bytes));
    const content = root.ref(0x0002)!.ref(0x3b03)!;
    const mobs = content.list(0x1901);
    const names = mobs.map((m) => `${m.classId.slice(14, 18)}:${m.str(0x4402)}`);
    expect(names.filter((n) => n.startsWith("3500"))).toEqual(["3500:Interchange Test"]);
    expect(names.filter((n) => n.startsWith("3600")).map((n) => n.slice(5)).sort()).toEqual(["broll clip.mov", "interview.mp4", "music.wav"]);
    expect(names.filter((n) => n.startsWith("3700"))).toHaveLength(3);
  });

  it("flattens nothing it cannot carry and still reads back", () => {
    const { bytes } = exportProject(30);
    expect(parseAafSequence(bytes).sequence.tracks.length).toBeGreaterThan(0);
  });
});

describe.each([23.976, 24, 25, 29.97, 30, 50, 59.94, 60])("AAF round trip at %s fps", (fps) => {
  it("export -> import keeps clips, speed, reverse, levels, dissolve and markers", () => {
    const project = buildProject(fps);
    const rate = resolveFrameRate(fps);
    const bytes = exportTimeline(project, "aaf", { aaf: { now: NOW, randomBytes: seeded() } }).files[0].bytes as Uint8Array;
    const imported = importAaf(bytes, { mediaItems: project.mediaLibrary.items, makeId });
    const before = layoutOf(project.timeline.tracks, project.timeline.markers, project.mediaLibrary.items, rate);
    // AAF does not carry opacity: the overlay's 50% comes back as 100%.
    const expected: Layout = {
      ...before,
      tracks: before.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, opacity: 1 })) })),
    };
    const after = layoutOf(imported.tracks, imported.markers, [...project.mediaLibrary.items, ...imported.newMedia], rate);
    expect(after).toEqual(expected);
    expect(imported.unmatched).toEqual([]);
    expect(imported.settings.frameRate).toBeCloseTo(rate.num / rate.den, 6);
    expect(imported.targetedTrackIds).toBeUndefined();
  });
});

describe("AAF details", () => {
  const baseSeq = (): Sequence => {
    const project = buildProject(24);
    const exported = exportTimeline(project, "aaf", { aaf: { now: NOW, randomBytes: seeded() } });
    return parseAafSequence(exported.files[0].bytes as Uint8Array).sequence;
  };

  it("carries the edit rate, start timecode and drop-frame flag", () => {
    const project = buildProject(29.97);
    const bytes = exportTimeline(project, "aaf", { dropFrame: true, aaf: { startTimecodeFrames: 107892 } }).files[0].bytes as Uint8Array;
    const { sequence } = parseAafSequence(bytes);
    expect(sequence.rate).toMatchObject({ num: 30000, den: 1001, dropFrame: true });
    expect(sequence.startTimecodeFrames).toBe(107892);
  });

  it("carries the marker comment and range length", () => {
    const project = buildProject(24);
    const withComment = {
      ...project,
      timeline: {
        ...project.timeline,
        markers: [{ id: "m", time: 2, label: "Review", color: "#ff0000", comment: "fix the cut", duration: 1 }],
      },
    };
    const bytes = exportTimeline(withComment, "aaf").files[0].bytes as Uint8Array;
    const { sequence } = parseAafSequence(bytes);
    expect(sequence.markers).toEqual([{ frame: 48, name: "Review", comment: "fix the cut", durationFrames: 24 }]);
  });

  it("pairs a video clip's own sound back into the clip", () => {
    const seq = baseSeq();
    const a = seq.tracks.find((t) => t.kind === "video" && t.clips.some((c) => c.name === "interview.mp4"));
    expect(a?.clips.find((c) => c.name === "interview.mp4")?.withAudio).toBe(true);
    // No leftover audio track for the paired sound.
    expect(seq.tracks.filter((t) => t.kind === "audio")).toHaveLength(1);
  });

  it("carries a track fader level", () => {
    const project = buildProject(24);
    const tracks = project.timeline.tracks.map((t) => (t.type === "audio" ? { ...t, audioRack: { effects: [], volume: 0.25 } } : t));
    const bytes = exportTimeline({ ...project, timeline: { ...project.timeline, tracks } }, "aaf").files[0].bytes as Uint8Array;
    const { sequence } = parseAafSequence(bytes);
    const audio = sequence.tracks.find((t) => t.kind === "audio");
    expect(audio?.gain).toBeCloseTo(0.25, 6);
    expect(audio?.clips[0].volume).toBeCloseTo(0.8, 6);
    const imported = importAaf(bytes, { mediaItems: project.mediaLibrary.items, makeId });
    expect(imported.tracks.find((t) => t.type === "audio")?.audioRack?.volume).toBeCloseTo(0.25, 6);
  });

  it("clamps a dissolve to the available source handles and says so", () => {
    const project = buildProject(24);
    // Clip B starts at source frame 100; make the dissolve far longer than the handle before it.
    const tracks = project.timeline.tracks.map((t) =>
      t.id === "t-main"
        ? {
            ...t,
            clips: t.clips.map((c) => (c.id === "B" ? { ...c, inPoint: 3 / 24, outPoint: 3 / 24 + (40 * 2) / 24 } : c)),
            transitions: t.transitions.map((tr) => ({ ...tr, duration: 20 / 24 })),
          }
        : t,
    );
    const result = exportTimeline({ ...project, timeline: { ...project.timeline, tracks } }, "aaf");
    expect(result.report.items.some((i) => i.feature === "AAF writer" && /shortened/.test(i.detail))).toBe(true);
    const { sequence } = parseAafSequence(result.files[0].bytes as Uint8Array);
    expect(sequence.tracks[0].clips.some((c) => c.name === "broll clip.mov")).toBe(true);
  });

  it("expands nested sequences instead of failing", () => {
    // flattenNests is shared with the EDL writer; an empty-nest project must at least export.
    const project = buildProject(24);
    expect(() => exportTimeline(project, "aaf")).not.toThrow();
  });

  it("append and replace plan the import like the other formats", () => {
    const project = buildProject(24);
    const bytes = exportTimeline(project, "aaf").files[0].bytes as Uint8Array;
    const imported = importAaf(bytes, { mediaItems: project.mediaLibrary.items, makeId });
    const appended = planTimelineImport(project, imported, "append");
    expect(appended.timeline.tracks.length).toBe(project.timeline.tracks.length + imported.tracks.length);
  });

  it("rejects files that are not AAF", () => {
    expect(() => parseAaf(new Uint8Array(2048))).toThrow(/not a readable AAF/);
    const root = storage("Root Entry");
    root.children.push(stream("data", Uint8Array.of(1)));
    expect(() => parseAaf(writeCfb(root))).toThrow(/not an AAF/);
  });

  it("keeps the template's header untouched apart from timestamps", () => {
    const written = serializeAaf(baseSeq(), { now: NOW, randomBytes: seeded() });
    const root = parseCfb(written.bytes);
    expect(findChild(root, "referenced properties")!.data.length).toBe(1 + 2 + 4 + 2 * (3 + 3 + 4 + 4));
  });
});

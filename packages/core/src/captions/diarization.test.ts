import { describe, expect, it } from "vitest";
import {
  applySpeakerStyles,
  clusterEmbeddings,
  ensureSpeakerProfiles,
  labelCuesBySpeaker,
  renameSpeakerProfile,
  SPEAKER_PALETTE,
} from "./diarization";
import { computeSpeakerEmbedding, EMBEDDING_SAMPLE_RATE, SPEAKER_EMBEDDING_DIMENSIONS } from "./speaker-embedding";
import type { Subtitle } from "../types/timeline";

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5);
const voice = (center: number[], noise = 0.05) => Float32Array.from(center, (c) => c + rand() * noise);
const A = [1, 0, 0, 0, 0, 0, 0, 0];
const B = [0, 1, 0, 0, 0, 0, 0, 0];
const C = [0, 0, 1, 0, 0, 0, 0, 0];

describe("clusterEmbeddings", () => {
  it("separates synthetic voices and numbers clusters by first appearance", () => {
    const e = [voice(B), voice(A), voice(B), voice(A), voice(C), voice(B)];
    expect(clusterEmbeddings(e)).toEqual([0, 1, 0, 1, 2, 0]);
  });
  it("honours an explicit speaker count and a max", () => {
    const e = [voice(A), voice(B), voice(C), voice(A)];
    expect(new Set(clusterEmbeddings(e, { speakerCount: 2 })).size).toBe(2);
    expect(new Set(clusterEmbeddings(e, { speakerCount: 1 })).size).toBe(1);
    expect(new Set(clusterEmbeddings(e, { maxSpeakers: 2 })).size).toBe(2);
  });
  it("handles empty and single input", () => {
    expect(clusterEmbeddings([])).toEqual([]);
    expect(clusterEmbeddings([voice(A)])).toEqual([0]);
  });
});

describe("automatic speaker count", () => {
  // 26-dim voice-prints: each speaker has a fixed signature; every cue adds "what was said" variation.
  const dims = SPEAKER_EMBEDDING_DIMENSIONS;
  const signature = (id: number) => Float32Array.from({ length: dims }, (_, d) => Math.sin((id + 1) * (d + 1) * 1.7) * 4);
  const cue = (id: number) => Float32Array.from(signature(id), (c) => c + rand() * 3);
  it("finds two voices in a six-passage interview", () => {
    expect(clusterEmbeddings([0, 1, 0, 1, 0, 1].map(cue))).toEqual([0, 1, 0, 1, 0, 1]);
  });
  it("finds three voices and one voice", () => {
    expect(new Set(clusterEmbeddings([0, 1, 2, 0, 1, 2, 0, 1].map(cue))).size).toBe(3);
    expect(new Set(clusterEmbeddings([0, 0, 0, 0, 0, 0].map(cue))).size).toBe(1);
  });
  it("is not fooled by duplicate cues", () => {
    const a = cue(0);
    expect(new Set(clusterEmbeddings([a, a, a, cue(1), cue(1)])).size).toBe(2);
    expect(new Set(clusterEmbeddings([a, a, a, a])).size).toBe(1);
  });
  it("treats fewer than three cues as one voice unless told otherwise", () => {
    expect(clusterEmbeddings([cue(0), cue(1)])).toEqual([0, 0]);
    expect(clusterEmbeddings([cue(0), cue(1)], { speakerCount: 2 })).toEqual([0, 1]);
  });
});

describe("labelCuesBySpeaker", () => {
  const cues = [0, 1, 2, 3, 4].map((i) => ({ startTime: i * 2, endTime: i * 2 + 2 }));
  it("names speakers in order of first appearance and assigns palette colours", () => {
    const { labels, profiles } = labelCuesBySpeaker(cues, [1, 0, 1, 0, 0]);
    expect(labels).toEqual(["Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2", "Speaker 2"]);
    expect(profiles.map((p) => p.color)).toEqual([SPEAKER_PALETTE[0], SPEAKER_PALETTE[1]]);
  });
  it("gives cues without audio the nearest speaker in time", () => {
    const { labels } = labelCuesBySpeaker(cues, [0, null, 1, 1, null]);
    expect(labels[1]).toMatch(/Speaker/);
    expect(labels[4]).toBe(labels[3]);
  });
  it("smooths a short A-B-A flicker", () => {
    const short = [{ startTime: 0, endTime: 2 }, { startTime: 2, endTime: 2.5 }, { startTime: 2.5, endTime: 5 }];
    expect(labelCuesBySpeaker(short, [0, 1, 0]).labels).toEqual(["Speaker 1", "Speaker 1", "Speaker 1"]);
    expect(labelCuesBySpeaker(short, [0, 1, 0], [], { smooth: false }).labels[1]).toBe("Speaker 2");
  });
  it("re-running keeps renamed speakers and their look, and drops stale profiles", () => {
    const existing = [
      { name: "Host", color: "#123456", position: "top" as const },
      { name: "Speaker 2", color: "#654321" },
      { name: "Gone", color: "#abcdef" },
    ];
    const previous = ["Host", "Speaker 2", "Host", "Speaker 2", "Host"];
    const { labels, profiles } = labelCuesBySpeaker(cues, [1, 0, 1, 0, 1], existing, { previous });
    expect(labels).toEqual(["Host", "Speaker 2", "Host", "Speaker 2", "Host"]);
    expect(profiles.map((p) => p.name)).toEqual(["Host", "Speaker 2"]);
    expect(profiles[0]).toEqual(existing[0]);
  });
  it("gives a new voice the lowest free name and an unused colour", () => {
    const existing = [{ name: "Host", color: SPEAKER_PALETTE[0], position: "top" as const }];
    const { labels, profiles } = labelCuesBySpeaker(cues, [0, 1, 0, 1, 1], existing, { previous: ["Host", "Host", "Host", "Host", "Host"] });
    expect(labels).toEqual(["Speaker 1", "Host", "Speaker 1", "Host", "Host"]);
    expect(profiles[1]).toEqual({ name: "Speaker 1", color: SPEAKER_PALETTE[1] });
  });
  it("keeps existing profiles", () => {
    const { profiles } = labelCuesBySpeaker(cues, [0, 0, 0, 0, 0], [{ name: "Speaker 1", color: "#123456" }]);
    expect(profiles).toEqual([{ name: "Speaker 1", color: "#123456" }]);
  });
});

describe("speaker profiles", () => {
  const cue = (id: string, speaker?: string, style?: Subtitle["style"]): Subtitle => ({ id, text: id, startTime: 0, endTime: 1, speaker, style });
  it("ensures a profile per used speaker", () => {
    const p = ensureSpeakerProfiles([cue("a", "Ann"), cue("b", "Bo"), cue("c")], [{ name: "Ann", color: "#111111" }]);
    expect(p.map((x) => x.name)).toEqual(["Ann", "Bo"]);
    expect(p[1].color).toBe(SPEAKER_PALETTE[1]);
  });
  it("renames and merges profiles", () => {
    const base = [{ name: "A", color: "#1" }, { name: "B", color: "#2" }];
    expect(renameSpeakerProfile(base, "A", "Zed")[0].name).toBe("Zed");
    expect(renameSpeakerProfile(base, "A", "B")).toEqual([{ name: "B", color: "#2" }]);
    expect(renameSpeakerProfile(base, "A", "")).toEqual([{ name: "B", color: "#2" }]);
  });
  it("puts the original look back when the speaker is cleared or no longer styles captions", () => {
    const plain = cue("a", "Ann");
    const styled = cue("b", "Bo", { fontFamily: "Inter", fontSize: 40, color: "#eeeeee", backgroundColor: "#000", position: "center" });
    const profiles = [{ name: "Ann", color: "#ff0000", position: "top" as const }, { name: "Bo", color: "#00ff00" }];
    const baked = applySpeakerStyles([plain, styled], profiles);
    expect(baked[0].style?.color).toBe("#ff0000");
    const cleared = applySpeakerStyles(baked.map((c) => ({ ...c, speaker: undefined })), profiles);
    expect(cleared[0].style).toBeUndefined();
    expect(cleared[0].speakerBase).toBeUndefined();
    expect(cleared[1].style).toMatchObject({ color: "#eeeeee", position: "center", fontSize: 40 });
    const off = applySpeakerStyles(baked, [{ ...profiles[1], styleCaptions: false }, { ...profiles[0], styleCaptions: false }]);
    expect(off[1].style?.color).toBe("#eeeeee");
    // Reassigning between speakers keeps the very first original.
    const moved = applySpeakerStyles([{ ...baked[1], speaker: "Ann" }], profiles);
    expect(moved[0].style).toMatchObject({ color: "#ff0000", position: "top" });
    expect(moved[0].speakerBase).toEqual(baked[1].speakerBase);
  });
  it("bakes colour and position onto the speaker's cues only, idempotently", () => {
    const subs = [cue("a", "Ann"), cue("b", "Bo"), cue("c")];
    const profiles = [{ name: "Ann", color: "#ff0000", position: "top" as const }, { name: "Bo", color: "#00ff00", styleCaptions: false }];
    const out = applySpeakerStyles(subs, profiles);
    expect(out[0].style).toMatchObject({ color: "#ff0000", position: "top" });
    expect(out[1]).toBe(subs[1]);
    expect(out[2]).toBe(subs[2]);
    expect(applySpeakerStyles(out, profiles)[0]).toBe(out[0]);
  });
});

describe("computeSpeakerEmbedding", () => {
  const tone = (f0: number, formant: number, seconds = 1) => {
    const n = EMBEDDING_SAMPLE_RATE * seconds;
    return Float32Array.from({ length: n }, (_, i) => {
      const t = i / EMBEDDING_SAMPLE_RATE;
      let v = 0;
      for (let h = 1; h * f0 < 4000; h++) v += Math.exp(-((h * f0 - formant) ** 2) / 600000) * Math.sin(2 * Math.PI * h * f0 * t) / h ** 0.3;
      return v * 0.1 + rand() * 0.002;
    });
  };
  it("returns null for silence and short audio", () => {
    expect(computeSpeakerEmbedding(new Float32Array(16000))).toBeNull();
    expect(computeSpeakerEmbedding(new Float32Array(100))).toBeNull();
  });
  it("clusters synthetic voices with different pitch and formants apart", () => {
    const low = [tone(110, 500), tone(112, 520), tone(108, 490)];
    const high = [tone(220, 1500), tone(224, 1480), tone(218, 1520)];
    const e = [...low, ...high].map((s) => computeSpeakerEmbedding(s) as Float32Array);
    expect(e.every(Boolean)).toBe(true);
    expect(clusterEmbeddings(e, { speakerCount: 2 })).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import {
  applyCaptionBurnIn,
  burnedInSubtitles,
  captionsChangeBurnIn,
  iso6392,
  planEmbeddedCaptions,
  planSidecarFiles,
  subtitlesForRange,
  type CaptionExportSettings,
} from "./caption-export";
import { parseScc } from "./scc";
import { parseStl } from "./ebu-stl";

const cue = (id: string, startTime: number, endTime: number, text: string, track?: string, language?: string): Subtitle => ({
  id,
  text,
  startTime,
  endTime,
  ...(track !== undefined ? { captionTrackId: track } : {}),
  ...(language ? { language } : {}),
});

const cues: Subtitle[] = [
  cue("a", 1, 3, "Hello world", "", "en"),
  cue("b", 4, 6, "Hola mundo", "es", "es"),
];

const settings = (tracks: CaptionExportSettings["tracks"]): CaptionExportSettings => ({ tracks });

describe("burn-in", () => {
  it("burns in everything without settings or for unlisted tracks", () => {
    expect(burnedInSubtitles(cues, undefined)).toHaveLength(2);
    expect(burnedInSubtitles(cues, settings([]))).toHaveLength(2);
  });
  it("never burns in hidden cues, with or without settings", () => {
    const withHidden: Subtitle[] = [cues[0], { ...cues[1], hidden: true }];
    expect(burnedInSubtitles(withHidden, undefined).map((c) => c.id)).toEqual(["a"]);
    expect(burnedInSubtitles(withHidden, settings([{ captionTrackId: "es", burnIn: true, sidecar: "none", embedded: "none" }])).map((c) => c.id)).toEqual(["a"]);
    expect(captionsChangeBurnIn(withHidden, undefined)).toBe(true);
  });
  it("leaves out tracks that are not burned in", () => {
    const s = settings([{ captionTrackId: "es", burnIn: false, sidecar: "none", embedded: "none" }]);
    expect(burnedInSubtitles(cues, s).map((c) => c.id)).toEqual(["a"]);
    expect(captionsChangeBurnIn(cues, s)).toBe(true);
    const project = { timeline: { subtitles: cues }, other: 1 };
    expect(applyCaptionBurnIn(project, s).timeline.subtitles).toHaveLength(1);
    expect(applyCaptionBurnIn(project, undefined)).toBe(project);
  });
});

describe("planEmbeddedCaptions", () => {
  const embedAll = settings([
    { captionTrackId: "", burnIn: true, sidecar: "none", embedded: "subtitle" },
    { captionTrackId: "es", burnIn: true, sidecar: "none", embedded: "subtitle" },
  ]);

  it("browser MP4 gets one WebVTT track per requested caption track with ISO 639-2 languages", () => {
    const plan = planEmbeddedCaptions(cues, embedAll, { format: "mp4", engine: "web", frameRate: 30 });
    expect(plan.warnings).toEqual([]);
    expect(plan.payloads.map((p) => [p.kind, p.captionTrackId, p.language])).toEqual([
      ["webvtt", "", "eng"],
      ["webvtt", "es", "spa"],
    ]);
    expect(plan.payloads[0].data.startsWith("WEBVTT")).toBe(true);
    expect(plan.payloads[0].data).toContain("Hello world");
    expect(plan.payloads[0].data).not.toContain("Hola");
  });

  it("explains what the browser cannot embed", () => {
    const cc = settings([{ captionTrackId: "", burnIn: true, sidecar: "none", embedded: "cea608" }]);
    expect(planEmbeddedCaptions(cues, cc, { format: "mp4", engine: "web", frameRate: 30 }).warnings[0]).toMatch(/desktop/);
    const mov = planEmbeddedCaptions(cues, embedAll, { format: "mov", engine: "web", frameRate: 30 });
    expect(mov.payloads).toEqual([]);
    expect(mov.warnings[0]).toMatch(/MOV/);
  });

  it("desktop MP4 gets SRT for mov_text; MOV with CEA-608 gets SCC that decodes", () => {
    const mp4 = planEmbeddedCaptions(cues, embedAll, { format: "mp4", engine: "native", frameRate: 30 });
    expect(mp4.payloads.map((p) => p.kind)).toEqual(["mov_text", "mov_text"]);
    expect(mp4.payloads[0].data).toContain("00:00:01,000 --> 00:00:03,000");

    const cc = settings([{ captionTrackId: "", burnIn: true, sidecar: "none", embedded: "cea608" }]);
    const mov = planEmbeddedCaptions(cues, cc, { format: "mov", engine: "native", frameRate: 29.97 });
    expect(mov.payloads).toHaveLength(1);
    expect(mov.payloads[0].kind).toBe("cea608");
    const back = parseScc(mov.payloads[0].data, { frameRate: 29.97 });
    expect(back.subtitles[0].text).toBe("Hello world");
    expect(Math.abs(back.subtitles[0].startTime - 1)).toBeLessThan(1 / 29.97);
  });

  it("falls back to mov_text, with a warning, when CEA-608 is asked of an MP4", () => {
    const cc = settings([{ captionTrackId: "", burnIn: true, sidecar: "none", embedded: "cea608" }]);
    const plan = planEmbeddedCaptions(cues, cc, { format: "mp4", engine: "native", frameRate: 30 });
    expect(plan.payloads[0].kind).toBe("mov_text");
    expect(plan.warnings[0]).toMatch(/MOV/);
  });

  it("skips WebM and tracks that were not asked for", () => {
    expect(planEmbeddedCaptions(cues, embedAll, { format: "webm", engine: "native", frameRate: 30 }).payloads).toEqual([]);
    const none = settings([{ captionTrackId: "", burnIn: true, sidecar: "srt", embedded: "none" }]);
    expect(planEmbeddedCaptions(cues, none, { format: "mp4", engine: "web", frameRate: 30 }).payloads).toEqual([]);
  });

  it("surfaces SCC pre-roll warnings", () => {
    const early = [cue("a", 0.1, 2, "Too early to pre-roll")];
    const cc = settings([{ captionTrackId: "", burnIn: true, sidecar: "none", embedded: "cea608" }]);
    const plan = planEmbeddedCaptions(early, cc, { format: "mov", engine: "native", frameRate: 29.97 });
    expect(plan.warnings.some((w) => /late/.test(w))).toBe(true);
  });
});

describe("planSidecarFiles", () => {
  it("writes one file per requested track and format, named by track when several exist", () => {
    const s = settings([
      { captionTrackId: "", burnIn: true, sidecar: "scc", embedded: "none" },
      { captionTrackId: "es", burnIn: true, sidecar: "stl", embedded: "none" },
    ]);
    const files = planSidecarFiles(cues, s, { baseName: "Movie", frameRate: 25 });
    expect(files.map((f) => f.filename)).toEqual(["Movie.default.scc", "Movie.es.stl"]);
    expect(new TextDecoder().decode(files[0].bytes)).toMatch(/^Scenarist_SCC V1\.0/);
    expect(parseStl(files[1].bytes).subtitles.map((c) => c.text)).toEqual(["Hola mundo"]);
  });
  it("omits the track suffix for a single track", () => {
    const only = [cue("a", 1, 3, "Hi")];
    const files = planSidecarFiles(only, settings([{ captionTrackId: "", burnIn: true, sidecar: "vtt", embedded: "none" }]), { baseName: "M", frameRate: 25 });
    expect(files.map((f) => f.filename)).toEqual(["M.vtt"]);
  });
  it("returns nothing without settings", () => {
    expect(planSidecarFiles(cues, undefined, { baseName: "M", frameRate: 25 })).toEqual([]);
  });
});

describe("helpers", () => {
  it("maps languages to ISO 639-2", () => {
    expect(iso6392("en-GB")).toBe("eng");
    expect(iso6392("fr")).toBe("fra");
    expect(iso6392("fil")).toBe("fil");
    expect(iso6392(undefined)).toBe("und");
    expect(iso6392("xx")).toBe("und");
  });
  it("clips and shifts cues to an export range", () => {
    const out = subtitlesForRange([cue("a", 1, 3, "x"), cue("b", 5, 9, "y"), cue("c", 20, 21, "z")], { startTime: 2, endTime: 8 });
    expect(out.map((c) => [c.id, c.startTime, c.endTime])).toEqual([["a", 0, 1], ["b", 3, 6]]);
    expect(subtitlesForRange([cue("a", 1, 3, "x")], undefined)).toHaveLength(1);
  });
});

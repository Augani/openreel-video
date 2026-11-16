import "./install-local-storage-mock";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GraphicsEngine,
  ProjectSerializer,
  TitleEngine,
  activateSequence,
  applySequenceSettings,
  createSequence,
  duplicateSequence,
  ensureSequences,
  getBuiltInGraphicTemplate,
  graphicMemberClipIds,
  insertGraphicTemplate,
  nestClips,
  planDelayCompensation,
  proxyExportReport,
  rackLatencySamples,
  reconcileMulticamAudio,
  type Clip,
  type Project,
  type SequenceEditResult,
  type TrackingData,
} from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { applyMotionTracking, getMotionTrackingTarget, persistMotionTrackingAnalysis, readMotionTrackingApplication } from "../services/motion-tracking-edit";
import { motionTrackingSourceSignature } from "../services/motion-tracking-source";

/**
 * Wave 9 composition. The streams (desktop ingest + proxies, multicam audio, motion tracking, graphics
 * rescale, native smart render) each pass alone; these tests put them in ONE project and check the seams:
 *  - every new optional field survives an import/export cycle, a nest, a duplicate, and older files do not gain any;
 *  - graphics rescale on a frame change INSIDE an opened nest, leaving the parent sequence untouched;
 *  - motion tracking attached to a graphic template member inside an opened nest (one undo step);
 *  - multicam fixed-angle audio on a bus whose rack holds repair effects stays latency-aligned;
 *  - a ready desktop proxy never changes what smart render copies (it reads the full-resolution file).
 */

const FIXTURES = join(__dirname, "fixtures", "compat");
const serializer = new ProjectSerializer({} as never);
const read = (name: string): string => readFileSync(join(FIXTURES, `${name}.openreel.json`), "utf8");

function edited(result: SequenceEditResult): Project {
  if (!result.ok) throw new Error(`sequence edit failed: ${JSON.stringify(result)}`);
  return result.project;
}

/** Fixture JSON, edited loosely before it goes through the serializer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Loose = { project: Record<string, Json> };

const TRACKING_ANALYSIS = "workspaceMotionTrackingAnalysis";

function composed(): string {
  const file = JSON.parse(read("w8")) as Loose;
  const ingest = (JSON.parse(read("w9-desktop-ingest")) as Loose).project;
  const project = file.project;
  project.mediaLibrary.ingestPreset = "proxies";
  project.mediaLibrary.desktopIngest = ingest.mediaLibrary.desktopIngest;
  const [first] = project.mediaLibrary.items;
  const [ingested] = ingest.mediaLibrary.items;
  first.sourceFile = ingested.sourceFile;
  first.copiedFrom = ingested.copiedFrom;
  first.proxy = ingested.proxy;
  const ids = project.mediaLibrary.items.map((m: Json) => m.id as string);
  project.multicamSources = [
    {
      id: "mcsrc_w9", name: "Take", syncMethod: "audio", audio: { mode: "fixed", angleId: "a1" }, createdAt: 1,
      angles: [
        { id: "a1", name: "A", mediaId: ids[0], offset: 0, duration: 6, color: "#ef4444" },
        { id: "a2", name: "B", mediaId: ids[1], offset: 0.5, duration: 6, color: "#22c55e" },
      ],
    },
  ];
  const tracks = project.timeline.tracks as Json[];
  const main = tracks.find((t: Json) => t.name === "Main");
  const loose = main.clips.find((c: Json) => !c.metadata?.nest);
  if (loose) {
    loose.metadata = {
      ...(loose.metadata ?? {}),
      multicam: { sourceId: "mcsrc_w9", angleId: "a1" },
      [TRACKING_ANALYSIS]: {
        version: 1, signature: "sig",
        data: {
          trackId: "t", clipId: loose.id, frameRate: 30, region: { x: 10, y: 10, width: 8, height: 8 },
          confidence: [1, 0.4, 0.9], lostFrames: [1], manualFrames: [2], states: ["tracked", "predicted", "reacquired"],
          keyframes: [{ frame: 0, position: { x: 10, y: 10 } }, { frame: 1, position: { x: 11, y: 10 } }, { frame: 2, position: { x: 12, y: 11 } }],
        },
      },
    };
  }
  project.timeline.audioBuses = [
    {
      id: "bus-dlg", name: "Dialogue", muted: false, solo: false,
      rack: { effects: [{ id: "fx-hum", type: "deHum", params: { frequency: 60, harmonics: 4, q: 30, depth: 1 }, bypassed: false }] },
    },
  ];
  return JSON.stringify(file);
}

function surface(project: Project) {
  const tagged = project.timeline.tracks.flatMap((t) => t.clips).filter((c) => (c.metadata as { multicam?: unknown } | undefined)?.multicam);
  const library = project.mediaLibrary as unknown as { ingestPreset?: string; desktopIngest?: unknown; items: Array<Record<string, unknown>> };
  return JSON.parse(
    JSON.stringify({
      ingestPreset: library.ingestPreset,
      desktopIngest: library.desktopIngest,
      sourceFile: library.items[0].sourceFile,
      copiedFrom: library.items[0].copiedFrom,
      proxy: library.items[0].proxy,
      multicamSources: project.multicamSources,
      tagged: tagged.map((c) => c.metadata),
      graphicInstances: project.graphicInstances,
      buses: project.timeline.audioBuses,
    }),
  );
}

describe("all wave 9 optional fields together", () => {
  const json = composed();

  it("the composed project validates and imports with every field", () => {
    expect(serializer.validateProjectJson(json).valid).toBe(true);
    const s = surface(serializer.importFromJson(json));
    expect(s.desktopIngest).toMatchObject({ proxiesWithCopy: true });
    expect(s.proxy).toMatchObject({ storage: "path", profile: { codec: "prores-proxy" } });
    expect(s.copiedFrom).toBeTruthy();
    expect(s.multicamSources[0].audio).toEqual({ mode: "fixed", angleId: "a1" });
    expect(s.tagged[0][TRACKING_ANALYSIS].data.states).toEqual(["tracked", "predicted", "reacquired"]);
    expect(s.buses[0].rack.effects[0].type).toBe("deHum");
  });

  it("survives export and re-import, the second cycle is stable, and a nest/duplicate keeps it", () => {
    const first = serializer.importFromJson(json);
    const again = serializer.importFromJson(serializer.exportToJson(first));
    expect(surface(again)).toEqual(surface(first));
    const mainId = first.activeSequenceId!;
    const nestId = first.sequences!.find((s) => s.id !== mainId)!.id;
    const nested = edited(activateSequence(first, nestId));
    expect(nested.mediaLibrary).toEqual(first.mediaLibrary);
    expect(nested.multicamSources).toEqual(first.multicamSources);
    const back = edited(activateSequence(nested, mainId));
    expect(surface(back)).toEqual(surface(first));
    const copy = edited(duplicateSequence(back, mainId));
    expect(copy.multicamSources).toEqual(first.multicamSources);
    expect(surface(serializer.importFromJson(serializer.exportToJson(edited(createSequence(copy, { name: "Another" })))))).toMatchObject({
      desktopIngest: surface(first).desktopIngest,
      proxy: surface(first).proxy,
    });
  });

  it("w4-w8 files do not gain any wave 9 field on re-save", () => {
    for (const wave of ["w4", "w5", "w6", "w8", "w8-audio-repair"]) {
      const saved = serializer.exportToJson(serializer.importFromJson(read(wave)));
      for (const key of ["desktopIngest", "copiedFrom", "previewPath", "proxiesWithCopy", "manualFrames", "\"states\""]) {
        expect(saved, `${wave} ${key}`).not.toContain(key);
      }
    }
  });
});

describe("graphics rescale inside an opened nest", () => {
  const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
  const clip = (id: string, trackId: string): Clip => ({
    id, mediaId: "m1", trackId, startTime: 0, duration: 20, inPoint: 0, outPoint: 20,
    effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
  });
  const base = (): Project => ({
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [{ id: "v1", type: "video", name: "V1", mode: "standard", clips: [clip("c1", "v1")], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
      subtitles: [], markers: [], duration: 20,
    },
  }) as unknown as Project;

  const sizes = (project: Project): number[] => (project.textClips ?? []).map((c) => c.style.fontSize);

  it("rescales the nest's graphic with the nest's frame and does not touch the parent's graphics", () => {
    const template = getBuiltInGraphicTemplate("builtin-lt-classic-bar");
    if (!template) throw new Error("missing built-in");
    // A graphic in the parent sequence, then a nest with its own graphic.
    const withParentGraphic = insertGraphicTemplate(base(), template, { startTime: 1 });
    if (!withParentGraphic.ok) throw new Error(withParentGraphic.message);
    const nested = edited(nestClips(ensureSequences(withParentGraphic.project), ["c1"]));
    const mainId = nested.activeSequenceId!;
    const nestId = nested.sequences!.find((s) => s.id !== mainId)!.id;
    const open = edited(activateSequence(nested, nestId));
    const inNest = insertGraphicTemplate(open, template, { startTime: 2 });
    if (!inNest.ok) throw new Error(inNest.message);
    const nestTracks = new Set(inNest.project.timeline.tracks.map((t) => t.id));
    const inActive = (c: { trackId: string }): boolean => nestTracks.has(c.trackId);
    expect(inNest.project.textClips!.some(inActive)).toBe(true);
    expect(inNest.project.textClips!.some((c) => !inActive(c))).toBe(true);

    const scaled = applySequenceSettings(inNest.project, { width: 1280, height: 720 }, { scaleGraphics: true });
    const originalFonts = inNest.project.textClips!.filter(inActive).map((c) => c.style.fontSize);
    const fonts = scaled.textClips!.filter(inActive).map((c) => c.style.fontSize);
    expect(fonts.length).toBe(originalFonts.length);
    fonts.forEach((size, index) => expect(size).toBeCloseTo(originalFonts[index] * (1280 / 1920), 2));
    // The parent sequence's graphic (a different instance on another timeline) is untouched.
    expect(scaled.textClips!.filter((c) => !inActive(c)).map((c) => c.style.fontSize)).toEqual(inNest.project.textClips!.filter((c) => !inActive(c)).map((c) => c.style.fontSize));
    expect(scaled.settings).toMatchObject({ width: 1280, height: 720 });
    // Re-applying the same frame is a no-op for graphics.
    expect(sizes(applySequenceSettings(scaled, { width: 1280, height: 720 }))).toEqual(sizes(scaled));
    // Back in the parent sequence its own settings (and graphics) are what they were.
    const mainAgain = edited(activateSequence(scaled, mainId));
    expect(mainAgain.settings).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe("motion tracking on a graphic inside an opened nest", () => {
  const data: TrackingData = {
    trackId: "measured", clipId: "src", frameRate: 2, region: { x: 40, y: 20, width: 20, height: 20 }, confidence: [1, 1, 1], lostFrames: [],
    keyframes: [{ frame: 0, position: { x: 50, y: 30 } }, { frame: 1, position: { x: 55, y: 32 } }, { frame: 2, position: { x: 60, y: 34 } }],
  };
  const options = { offset: { x: 0, y: 0 }, applyScale: false, applyRotation: false, smoothing: 0, mode: "follow" as const };
  const state = () => useProjectStore.getState();

  beforeEach(() => {
    useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
    useUIStore.setState({ effectApplicationClipId: null, exportState: { isExporting: false, progress: 0, phase: "" } });
    useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused" });
  });

  it("attaches to a template member, in one undo step, and the graphic survives leaving the nest", async () => {
    state().createNewProject("Nested tracking");
    const created = state().project;
    const trackId = created.timeline.tracks.find((t) => t.type === "video")!.id;
    const source: Clip = {
      id: "src", mediaId: "video", trackId, startTime: 0, duration: 2, inPoint: 0, outPoint: 2, volume: 1, effects: [], audioEffects: [], keyframes: [],
      transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
    };
    const media = {
      id: "video", name: "real.mp4", type: "video", blob: new Blob(["real"]), fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { width: 100, height: 50, duration: 5, frameRate: 24, codec: "h264", channels: 0, sampleRate: 0, fileSize: 4 },
    };
    const project: Project = {
      ...created,
      settings: { ...created.settings, width: 200, height: 100, frameRate: 2 },
      timeline: { ...created.timeline, tracks: created.timeline.tracks.map((t) => (t.id === trackId ? { ...t, clips: [source] } : t)) },
      mediaLibrary: { items: [media] } as never,
    };
    const template = getBuiltInGraphicTemplate("builtin-lt-classic-bar");
    if (!template) throw new Error("missing built-in");
    const withGraphic = insertGraphicTemplate(project, template, { startTime: 0, duration: 2 });
    if (!withGraphic.ok) throw new Error(withGraphic.message);
    const members = [...graphicMemberClipIds(withGraphic.project)];
    const nested = edited(nestClips(ensureSequences(withGraphic.project), ["src", members[0]]));
    const mainId = nested.activeSequenceId!;
    const nestId = nested.sequences!.find((s) => s.id !== mainId)!.id;
    const open = edited(activateSequence(nested, nestId));
    // The source clip now lives in the nest's timeline; the nest is the active sequence.
    const sourceInNest = open.timeline.tracks.flatMap((t) => t.clips).find((c) => c.mediaId === "video");
    if (!sourceInNest) throw new Error("source clip not found in the nest");
    const nestTargets = [...(open.textClips ?? []), ...(open.shapeClips ?? [])].filter((c) => open.timeline.tracks.some((t) => t.id === c.trackId));
    expect(nestTargets.length).toBeGreaterThan(0);
    const target = nestTargets[0];

    state().loadProject(open);
    state().actionHistory.clear();
    const live = state().project;
    const sourceClip = state().getClip(sourceInNest.id)!;
    await persistMotionTrackingAnalysis(live.id, {
      version: 1,
      signature: motionTrackingSourceSignature(live, sourceClip, live.mediaLibrary.items[0]),
      data: { ...data, clipId: sourceInNest.id },
    });
    expect(state().actionHistory.getUndoStackSize()).toBe(1);
    await applyMotionTracking(sourceInNest.id, target.id, options);
    expect(state().actionHistory.getUndoStackSize()).toBe(2);
    const applied = getMotionTrackingTarget(state().getFullProject(), target.id)!.clip;
    expect(applied.keyframes.some((k) => k.property === "position.x")).toBe(true);
    expect(readMotionTrackingApplication(target.id)?.sourceClipId).toBe(sourceInNest.id);

    // Undo is exactly one step and leaves the analysis in place.
    await state().undo();
    expect(state().actionHistory.getUndoStackSize()).toBe(1);
    expect(readMotionTrackingApplication(target.id)).toBeNull();
    await state().redo();
    expect(readMotionTrackingApplication(target.id)).not.toBeNull();
  });
});

describe("multicam fixed-angle audio with repair effects in a bus rack", () => {
  it("reconciles derived audio and keeps every path latency-aligned", () => {
    const project = serializer.importFromJson(composed());
    const reconciled = reconcileMulticamAudio(project);
    // Idempotent: a second pass returns the same object.
    expect(reconcileMulticamAudio(reconciled)).toBe(reconciled);
    const bus = reconciled.timeline.audioBuses!.find((b) => b.id === "bus-dlg")!;
    const rackSamples = rackLatencySamples(bus.rack, 48000);
    const tracks = reconciled.timeline.tracks.filter((t) => t.type === "audio");
    const plan = planDelayCompensation(
      tracks.map((t) => ({ id: t.id, latency: 0, output: t.id === tracks[0].id ? "bus-dlg" : null })),
      [{ id: "bus-dlg", latency: rackSamples / 48000 }],
    );
    // Every track arrives at the master at the same aligned latency.
    const arrival = (id: string, output: string | null): number =>
      (plan.trackDelay.get(id) ?? 0) + (output ? (plan.busArrival.get(output) ?? 0) + (plan.busDelay.get(output) ?? 0) : 0);
    const arrivals = tracks.map((t) => arrival(t.id, t.id === tracks[0].id ? "bus-dlg" : null));
    for (const value of arrivals) expect(value).toBeCloseTo(plan.masterLatency, 9);
  });
});

describe("proxies in a multicam project reach no export", () => {
  it("the export report states full-resolution media even though a ready desktop proxy is attached", () => {
    const project = serializer.importFromJson(composed());
    expect((project.mediaLibrary.items[0] as unknown as { proxy?: { status: string } }).proxy?.status).toBe("ready");
    const report = proxyExportReport(project);
    expect(report.usedProxy).toBe(false);
    expect(report.proxiedMedia).toBeGreaterThan(0);
  });
});

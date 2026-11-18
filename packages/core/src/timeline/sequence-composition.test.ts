/**
 * Composition tests: features built in parallel waves (multi-sequence, interchange,
 * captions, render cache, media logging, sync lock) must agree on one rule: they act on
 * the ACTIVE sequence, which may be an opened nest.
 */
import { describe, expect, it } from "vitest";
import { exportTimeline } from "../interchange";
import { planTranscriptCut } from "../captions/transcript-edit";
import { buildTranscript, wordRange } from "../captions/transcript";
import { applyTimelineToolEdits } from "../editing/timeline-tool-edit";
import { planInvalidation } from "../render-cache/invalidation-planner";
import { normalizeProjectStoredFields } from "../storage/project-serializer";
import type { Clip, Project, Track } from "../types";
import type { Subtitle } from "../types/timeline";
import { activateSequence, ensureSequences, nestClips, projectForSequence, syncActiveSequence } from "./sequences";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, mediaId: string, metadata?: Record<string, unknown>): Clip => ({
  id, mediaId, trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...(metadata ? { metadata } : {}),
});
const track = (id: string, type: Track["type"], clips: Clip[], extra: Partial<Track> = {}): Track => ({
  id, type, name: id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra,
});
const media = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `${id}.mp4`, type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
  ...extra,
});
const cue = (id: string, spec: Array<[string, number, number]>, extra: Partial<Subtitle> = {}): Subtitle => ({
  id, text: spec.map((w) => w[0]).join(" "), startTime: spec[0][1], endTime: spec[spec.length - 1][2],
  words: spec.map(([text, startTime, endTime]) => ({ text, startTime, endTime })), ...extra,
});

const SUBS: Subtitle[] = [
  cue("c1", [["Hello", 0.5, 0.9], ["there.", 0.9, 1.4]], { speaker: "Ann", language: "en", captionTrackId: "en-main" }),
  cue("c2", [["Second", 5.0, 5.5], ["line.", 5.5, 6.0]], { speaker: "Bob" }),
];

/** Legacy (pre-sequence) project: linked picture+sound, log metadata, smart bin, caption fields, track flags. */
function legacy(): Project {
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        media("m1", { scene: "12A", shot: "3", take: "2", goodTake: true, description: "wide" }),
        media("m2"),
      ] as unknown as Project["mediaLibrary"]["items"],
    },
    smartBins: [{ id: "sb", name: "Good", query: "good:yes", column: "all" }],
    timeline: {
      tracks: [
        track("v1", "video", [clip("v", "v1", 0, 8, "m1"), clip("v2", "v1", 8, 4, "m2")], { syncLock: true, targeted: true } as Partial<Track>),
        track("a1", "audio", [clip("a", "a1", 0, 8, "m1", { separatedFromClipId: "v" })]),
      ],
      subtitles: SUBS, duration: 12, markers: [],
    },
    textClips: [],
  } as unknown as Project;
}

/** Nest v + a, open the nest; returns the opened-nest project plus its parent. */
function withOpenNest() {
  const migrated = ensureSequences(legacy());
  const nested = nestClips(migrated, ["v", "a"], "Nest");
  if (!nested.ok || !nested.sequenceId) throw new Error("nest failed");
  const opened = activateSequence(nested.project, nested.sequenceId);
  if (!opened.ok) throw new Error("open failed");
  return { parent: nested.project, open: opened.project, nestId: nested.sequenceId };
}

describe("multi-sequence migration keeps optional metadata from the other streams", () => {
  it("preserves log metadata, smart bins, caption fields and track flags through migration, nest and open", () => {
    const old = legacy();
    const migrated = normalizeProjectStoredFields(old);
    expect(migrated.sequences).toHaveLength(1);
    expect(migrated.smartBins).toEqual(old.smartBins);
    const log = migrated.mediaLibrary.items[0] as unknown as Record<string, unknown>;
    expect([log.scene, log.shot, log.take, log.goodTake, log.description]).toEqual(["12A", "3", "2", true, "wide"]);
    expect(migrated.timeline.subtitles).toEqual(SUBS);
    expect(migrated.timeline.tracks[0]).toMatchObject({ syncLock: true, targeted: true });

    const { parent, open, nestId } = withOpenNest();
    for (const project of [parent, open]) {
      expect(project.smartBins).toEqual(old.smartBins);
      expect((project.mediaLibrary.items[0] as unknown as Record<string, unknown>).goodTake).toBe(true);
    }
    // Captions over the nested span travel into the nest with every field intact (and nest-local word times).
    const stored = syncActiveSequence(open).sequences!.find((s) => s.id === nestId)!;
    expect(stored.timeline.subtitles.map((s) => [s.speaker, s.language, s.captionTrackId])).toEqual([
      ["Ann", "en", "en-main"], ["Bob", undefined, undefined],
    ]);
    expect(stored.timeline.subtitles[0].words?.map((w) => [w.startTime, w.endTime])).toEqual([[0.5, 0.9], [0.9, 1.4]]);
    expect(syncActiveSequence(parent).timeline.subtitles).toEqual([]);
  });
});

describe("interchange export follows the active sequence", () => {
  it("exports only the opened nest's content, and the parent when it is active", () => {
    const { parent, open, nestId } = withOpenNest();
    const text = exportTimeline(open, "otio").files[0].content;
    expect(text).toContain("m1.mp4");
    expect(text).not.toContain("m2.mp4");
    expect(exportTimeline(parent, "otio").files[0].content).toContain("m2.mp4");
    // A chosen (not opened) sequence exports the same as opening it.
    const chosen = projectForSequence(parent, nestId)!;
    expect(exportTimeline(chosen, "otio").files[0].content).toBe(text);
  });
});

describe("transcript cuts inside an opened nest", () => {
  // Captions live on the timeline being edited; import them onto the opened nest.
  const withCaptions = (open: Project): Project => ({ ...open, timeline: { ...open.timeline, subtitles: SUBS } });
  const cut = (project: Project) =>
    planTranscriptCut(project, [wordRange(buildTranscript(project.timeline.subtitles), 0, 1)], "op");

  it("ripple-cuts the nest's linked picture and sound together as one plan, leaving the parent alone", () => {
    const { parent, open } = withOpenNest();
    const project = withCaptions(open);
    const after = applyTimelineToolEdits(project, cut(project).edits);
    const lengths = after.timeline.tracks.map((t) => t.clips.map((c) => Math.round(c.duration * 1000) / 1000));
    expect(lengths).toEqual([[0.5, 6.6], [0.5, 6.6]]);
    const stored = syncActiveSequence(parent).sequences!.find((s) => s.id === parent.activeSequenceId)!;
    expect(stored.timeline.tracks.flatMap((t) => t.clips)).toHaveLength(2); // v2 + the nest clip
  });

  it("respects a locked sound track inside the nest", () => {
    const { open } = withOpenNest();
    const project = withCaptions({
      ...open,
      timeline: { ...open.timeline, tracks: open.timeline.tracks.map((t) => (t.type === "audio" ? { ...t, locked: true } : t)) },
    });
    expect(() => cut(project)).toThrow(/locked/);
  });
});

describe("render cache follows the active sequence", () => {
  it("switching sequence invalidates; edits inside the open nest invalidate only their own span", () => {
    const { parent, open } = withOpenNest();
    const toNest = planInvalidation(parent, open);
    expect(toNest.all || toNest.ranges.length > 0).toBe(true);
    const edited: Project = {
      ...open,
      timeline: {
        ...open.timeline,
        tracks: open.timeline.tracks.map((t) =>
          t.type === "video"
            ? { ...t, clips: t.clips.map((c) => ({ ...c, effects: [{ id: "e", type: "blur", params: { radius: 4 }, enabled: true } as never] })) }
            : t),
      },
    };
    const plan = planInvalidation(open, edited);
    expect(plan.all).toBe(false);
    expect(plan.ranges.length).toBeGreaterThan(0);
  });
});

/**
 * Generator for the saved-project compatibility fixtures (see
 * apps/web/src/test/project-compat.test.ts and apps/web/src/test/fixtures/compat/README.md).
 *
 * It is NOT a test of the tree it is committed in. It is copied into a throw-away worktree of the
 * tree whose on-disk format the fixture must represent (w4, w5, w6) and run there with that tree's
 * own serializer:
 *
 *   OPENREEL_COMPAT_OUT=/abs/path/w5.openreel.json OPENREEL_COMPAT_WAVE=w5 \
 *     pnpm --filter @openreel/web exec vitest run --config <cfg including this file>
 *
 * The project is built from plain objects using only fields that tree's types know about, and
 * saved through that tree's ProjectSerializer.exportToJson, so the JSON is byte-for-byte what that
 * tree writes.
 */
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import * as core from "@openreel/core";
import { createEmptyProject } from "../src/stores/project/project-helpers";

const wave = (process.env.OPENREEL_COMPAT_WAVE ?? "w6") as "w4" | "w5" | "w6" | "w8";
const out = process.env.OPENREEL_COMPAT_OUT;

const identity = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const clip = (id: string, trackId: string, mediaId: string, start: number, inPoint: number, duration: number, extra: Record<string, unknown> = {}) => ({
  id,
  mediaId,
  trackId,
  startTime: start,
  duration,
  inPoint,
  outPoint: inPoint + duration,
  effects: [],
  audioEffects: [],
  transform: { ...identity },
  volume: 1,
  keyframes: [],
  ...extra,
});

describe("generate compat fixture", () => {
  it("writes the fixture", async () => {
    if (!out) return;
    const base = createEmptyProject(`Compat ${wave}`, { width: 1280, height: 720, frameRate: 30 }, true) as any;
    const trackId = (name: string) => base.timeline.tracks.find((t: any) => t.name === name).id as string;
    const main = trackId("Main");
    const music = trackId("Music");
    const titles = trackId("Titles");

    const media = [
      {
        id: "media-scenes", name: "three-scenes.mp4", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
        metadata: { duration: 6, width: 640, height: 360, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 120000, hasVideo: true, hasAudio: true },
        sourceFile: { name: "three-scenes.mp4", size: 120000, lastModified: 1_700_000_000_000 },
      },
      {
        id: "media-tone", name: "tone-4s.wav", type: "audio", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
        metadata: { duration: 4, width: 0, height: 0, frameRate: 0, codec: "pcm", sampleRate: 48000, channels: 1, fileSize: 384000, hasAudio: true },
      },
    ] as any[];

    const c1 = clip("clip-1", main, "media-scenes", 0, 0, 2);
    const c2 = clip("clip-2", main, "media-scenes", 2, 2, 2, {
      effects: [{ id: "fx-1", type: "brightness", params: { value: 0.1 }, enabled: true }],
      transform: { ...identity, scale: { x: 1.1, y: 1.1 } },
      keyframes: [],
    });
    const c3 = clip("clip-3", main, "media-scenes", 4, 4, 2, { speed: 1, label: undefined });
    const tone = clip("clip-tone", music, "media-tone", 0, 0, 4, { volume: 0.8, fade: { fadeIn: 0.5, fadeOut: 0.5 } });

    const tracks = base.timeline.tracks.map((t: any) => {
      if (t.id === main) return { ...t, clips: [c1, c2, c3], transitions: [{ id: "tr-1", clipAId: "clip-1", clipBId: "clip-2", type: "crossfade", duration: 0.5, params: {} }] };
      if (t.id === music) {
        const withRack = wave === "w4" || wave === "w5" || wave === "w6" || wave === "w8";
        return {
          ...t,
          clips: [tone],
          ...(withRack ? { audioRack: { effects: [{ id: "rack-eq", type: "eq", params: { lowGain: 2 }, bypassed: false }], volume: 0.9, pan: 0 } } : {}),
          ...(wave !== "w4" ? { syncLock: false } : {}),
        };
      }
      return t;
    });

    const textClip = {
      id: "text-1", trackId: titles, startTime: 1, duration: 3, text: "Compat title",
      style: { ...core.DEFAULT_TEXT_STYLE ?? {}, fontFamily: "Inter", fontSize: 64, color: "#ffffff" },
      transform: { ...identity, position: { x: 0.5, y: 0.8 } },
      keyframes: [],
    };

    let project: any = {
      ...base,
      mediaLibrary: { items: media },
      timeline: { ...base.timeline, tracks, markers: [{ id: "mk-1", time: 1, label: "Marker A", color: "#ff0000" }], duration: 6 },
      textClips: [textClip],
    };

    if (wave !== "w4") {
      project = {
        ...project,
        bins: [{ id: "bin-a", name: "Interviews" }, { id: "bin-b", name: "B-roll", parentId: "bin-a" }],
        smartBins: [{ id: "sb-1", name: "Good takes", query: "good", column: "description" }],
        mediaLibrary: {
          items: media.map((m, i) => (i === 0 ? { ...m, binId: "bin-a", label: "forest", comment: "a comment", scene: "12A", shot: "2", take: "3", goodTake: true, importedAt: 1_700_000_000_000 } : m)),
        },
      };
      project.timeline.tracks = project.timeline.tracks.map((t: any) => (t.id === main ? { ...t, clips: t.clips.map((c: any) => (c.id === "clip-3" ? { ...c, label: "rose" } : c)) } : t));
    }

    if (wave === "w6" || wave === "w8") {
      const seq = (core as any).nestClips(project, ["clip-1", "clip-2"], "Nest 1");
      if (!seq.ok) throw new Error(`nestClips failed: ${seq.message}`);
      project = seq.project;
      const second = (core as any).createSequence(project, { name: "Sequence 2", settings: { width: 1280, height: 720, frameRate: 30 }, activate: false });
      if (!second.ok) throw new Error(`createSequence failed: ${second.message}`);
      project = second.project;
    }

    if (wave === "w8") {
      // Essential Graphics (w8): a lower third with changed exposed controls, placed through the
      // tree's own insertGraphicTemplate so the fixture is exactly what that tree writes.
      const template = (core as any).getBuiltInGraphicTemplate("builtin-lt-classic-bar");
      const inserted = (core as any).insertGraphicTemplate(project, template, {
        startTime: 1, duration: 4, values: { name: "Compat Name", accent: "#22aa66" },
      });
      if (!inserted.ok) throw new Error(`insertGraphicTemplate failed: ${inserted.message}`);
      project = inserted.project;
    }

    // Same stand-in storage the serializer unit tests use: only exportToJson is exercised.
    const serializer = new (core as any).ProjectSerializer({} as unknown);
    writeFileSync(out, serializer.exportToJson(project));
  });
});

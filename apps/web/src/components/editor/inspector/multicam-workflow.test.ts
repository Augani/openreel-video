import { describe, expect, it } from "vitest";
import {
  ActionExecutor,
  type Clip,
  type MediaItem,
  type MultiCamGroup,
  type Project,
} from "@openreel/core";
import {
  createMulticamApplyEditAction,
  buildMulticamManifest,
  findMulticamCalibrationRanges,
  getMulticamAnalysisDuration,
  prepareMulticamAnalysisAudio,
  resolveMulticamSources,
  updateAlignedSourceOffsets,
} from "./multicam-workflow";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

function clip(id: string, trackId: string, mediaId: string): Clip {
  return {
    id,
    trackId,
    mediaId,
    startTime: 2,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    effects: [],
    audioEffects: [],
    transform,
    volume: 1,
    keyframes: [],
  };
}

function media(id: string): MediaItem {
  return {
    id,
    name: id,
    type: "video",
    fileHandle: null,
    blob: new Blob([id]),
    metadata: {
      duration: 8,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48_000,
      channels: 2,
      fileSize: 1,
    },
    thumbnailUrl: null,
    waveformData: null,
  };
}

const group: MultiCamGroup = {
  id: "group-1",
  name: "Interview",
  angles: [
    {
      id: "a",
      name: "Host",
      clipId: "clip-a",
      trackId: "source-a",
      offset: 0,
      color: "#f00",
      isActive: true,
    },
    {
      id: "b",
      name: "Guest",
      clipId: "clip-b",
      trackId: "source-b",
      offset: 0.5,
      color: "#0f0",
      isActive: false,
    },
  ],
  activeAngleId: "a",
  syncPoint: 2,
  duration: 6,
  createdAt: 1,
  outputTrackId: "output-1",
  switches: [],
};

function project(): Project {
  return {
    id: "project-1",
    name: "Podcast",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: { items: [media("media-a"), media("media-b")] },
    timeline: {
      duration: 10,
      subtitles: [],
      markers: [],
      tracks: [
        {
          id: "source-a",
          type: "video",
          name: "Host",
          clips: [clip("clip-a", "source-a", "media-a")],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: "source-b",
          type: "video",
          name: "Guest",
          clips: [clip("clip-b", "source-b", "media-b")],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
    multicamGroups: [],
  };
}

describe("multicam workflow", () => {
  it("downmixes and averages analysis audio before long-form processing", () => {
    const left = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const right = new Float32Array([3, 4, 5, 6, 7, 8, 9, 10]);
    const buffer = {
      length: 8,
      numberOfChannels: 2,
      sampleRate: 8_000,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as AudioBuffer;

    const analysis = prepareMulticamAnalysisAudio(buffer, 2_000);

    expect(analysis.sampleRate).toBe(2_000);
    expect(Array.from(analysis.samples)).toEqual([3.5, 7.5]);
  });

  it("resolves each angle to its clip, track, and media", () => {
    const resolved = resolveMulticamSources(project(), group);

    expect(resolved.map(({ angle, clip, media, track }) => ({
      angle: angle.id,
      clip: clip.id,
      media: media.id,
      track: track.id,
    }))).toEqual([
      { angle: "a", clip: "clip-a", media: "media-a", track: "source-a" },
      { angle: "b", clip: "clip-b", media: "media-b", track: "source-b" },
    ]);
  });

  it("uses the shortest aligned source as the analysis duration", () => {
    const resolved = resolveMulticamSources(project(), group);
    const buffers = new Map([
      ["a", { duration: 8 } as AudioBuffer],
      ["b", { duration: 7 } as AudioBuffer],
    ]);

    expect(getMulticamAnalysisDuration(resolved, buffers)).toBe(6.5);
  });

  it("uses an exact analysis rate for both 44.1kHz and 48kHz cameras", () => {
    for (const sampleRate of [44100, 48000]) {
      const result = prepareMulticamAnalysisAudio({ sampleRate, length: sampleRate,
        numberOfChannels: 1, getChannelData: () => new Float32Array(sampleRate).fill(0.5),
      } as unknown as AudioBuffer, 1000);
      expect(result.sampleRate).toBe(1000);
      expect(result.samples).toHaveLength(1000);
      expect(result.samples[900]).toBe(0.5);
    }
  });

  it("rejects unreliable sync before changing any offsets", () => {
    const live = structuredClone(group);
    expect(() => updateAlignedSourceOffsets(live, resolveMulticamSources(project(), group), new Map([
      ["a", { offset: 0, confidence: 1, method: "audio" as const }],
      ["b", { offset: 9, confidence: 0, method: "manual" as const }],
    ]))).toThrow("Could not reliably sync");
    expect(live.angles).toEqual(group.angles);
  });

  it("translates raw sync offsets into each trimmed clip's source window", () => {
    const target = project();
    const targetClip = target.timeline.tracks[1]?.clips[0] as Clip;
    (targetClip as { inPoint: number }).inPoint = 2;
    const resolved = resolveMulticamSources(target, group);
    const liveGroup = structuredClone(group);

    updateAlignedSourceOffsets(
      liveGroup,
      resolved,
      new Map([
        ["a", { offset: 0, confidence: 1, method: "audio" as const }],
        ["b", { offset: 3, confidence: 0.9, method: "audio" as const }],
      ]),
    );

    expect(liveGroup.angles[1]?.offset).toBe(1);
  });

  it("starts at the common trimmed range when synchronization requires a negative offset", () => {
    const target = project();
    const live = structuredClone(group);
    updateAlignedSourceOffsets(live, resolveMulticamSources(target, live), new Map([
      ["a", { offset: 0, confidence: 1, method: "audio" as const }],
      ["b", { offset: -2, confidence: 0.9, method: "audio" as const }],
    ]));
    expect(live.syncPoint).toBe(4);
    expect(live.angles.map((angle) => angle.offset)).toEqual([2, 0]);
    expect(getMulticamAnalysisDuration(resolveMulticamSources(target, live), new Map([
      ["a", { duration: 20 } as AudioBuffer], ["b", { duration: 20 } as AudioBuffer],
    ]))).toBe(6);
  });

  it("builds a v1 shoot manifest from the selected camera sources", () => {
    const target = project();
    const resolved = resolveMulticamSources(target, group);
    const value = buildMulticamManifest(target, group, resolved, {
      min_shot_ms: 1_800,
      max_shot_ms: 25_000,
      cut_lead_ms: 120,
      reaction_shot_after_ms: 12_000,
      forbid_jump_cut_same_subject: true,
    });

    expect(value.spec).toBe("openreel-multicam/v1");
    expect(value.participants.map((participant) => participant.audio)).toEqual(["a", "b"]);
    expect(value.cameras.map((camera) => camera.clipId)).toEqual(["clip-a", "clip-b"]);
  });

  it("finds isolated speaker and room-silence calibration windows", () => {
    const value = findMulticamCalibrationRanges(new Map([
      ["a", { windowMs: 250, probabilities: new Float32Array([0.1, 0.1, 0.9, 0.9, 0.9, 0.1]) }],
      ["b", { windowMs: 250, probabilities: new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.9]) }],
    ]));

    expect(value.silenceRange).toEqual({ startTime: 0, endTime: 0.5 });
    expect(value.ranges).toContainEqual({ speakerAngleId: "a", startTime: 0.5, endTime: 1.25 });
  });

  it("applies and undoes the generated timeline as one atomic action", async () => {
    const target = project();
    const outputClip = {
      ...clip("generated", "output-1", "media-a"),
      startTime: 2,
      duration: 3,
      outPoint: 3,
    };
    const action = createMulticamApplyEditAction({
      project: target,
      group,
      groups: [{ ...group, switches: [{ id: "s1", groupId: group.id, angleId: "a", time: 0 }] }],
      outputTrackId: "output-1",
      sequence: [{ angleId: "a", clip: outputClip }],
      createId: () => "action-1",
      now: () => 10,
    });
    const executor = new ActionExecutor();
    expect((await executor.execute(action, target)).success).toBe(true);

    expect(target.timeline.tracks.find((track) => track.id === "source-a")).toMatchObject({
      hidden: true,
      muted: true,
    });
    expect(target.timeline.tracks.find((track) => track.id === "output-1")?.clips).toHaveLength(1);
    expect(target.multicamGroups?.[0]?.switches).toHaveLength(1);

    const undo = await executor.undo(target);

    expect(undo.success).toBe(true);
    expect(target.timeline.tracks.map((track) => track.id)).toEqual(["source-a", "source-b"]);
    expect(target.timeline.tracks.every((track) => !track.hidden && !track.muted)).toBe(true);
    expect(target.multicamGroups).toEqual([]);
  });
});

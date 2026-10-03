import { describe, expect, it } from "vitest";
import type { Clip } from "../types/timeline";
import { DEFAULT_MULTICAM_EDIT_POLICY } from "../multicam/automatic-edit";
import { DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS } from "../multicam/manifest";
import { MultiCamEngine, type MultiCamGroup } from "./multicam-engine";

function group(updates: Partial<MultiCamGroup> = {}): MultiCamGroup {
  return {
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
        offset: 0.25,
        color: "#0f0",
        isActive: false,
      },
    ],
    activeAngleId: "a",
    syncPoint: 10,
    duration: 8,
    createdAt: 1,
    ...updates,
  };
}

function clip(id: string): Clip {
  return {
    id,
    mediaId: `media-${id}`,
    trackId: `track-${id}`,
    startTime: 0,
    duration: 12,
    inPoint: 1,
    outPoint: 13,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
}

describe("MultiCamEngine automatic edits", () => {
  it("inserts manual cuts without changing the start or duplicating a boundary", () => {
    const engine = new MultiCamEngine();
    engine.loadGroups([group()]);
    expect(engine.cutToAngle("group-1", "b", 3)).toBe(true);
    expect(engine.getAngleAtTime("group-1", 1)?.id).toBe("a");
    expect(engine.getAngleAtTime("group-1", 4)?.id).toBe("b");
    expect(engine.cutToAngle("group-1", "a", 3)).toBe(true);
    expect(engine.getGroup("group-1")?.switches).toHaveLength(2);
    expect(engine.getAngleAtTime("group-1", 4)?.id).toBe("a");
    expect(engine.cutToAngle("group-1", "b", 8)).toBe(false);
    expect(engine.cutToAngle("group-1", "b", -1)).toBe(false);
  });

  it("normalizes legacy groups and persists switch changes on the group", () => {
    const engine = new MultiCamEngine();
    engine.loadGroups([group()]);

    engine.addSwitch("group-1", "b", 2, {
      reason: "speaker",
      confidence: 0.9,
    });

    expect(engine.getAllGroups()[0]?.switches).toEqual([
      expect.objectContaining({
        groupId: "group-1",
        angleId: "b",
        time: 2,
        reason: "speaker",
        confidence: 0.9,
      }),
    ]);
  });

  it("converts a decision list into stable, persisted switches", () => {
    const engine = new MultiCamEngine();
    engine.loadGroups([group()]);

    const switches = engine.applyAutomaticEdit(
      "group-1",
      {
        duration: 6,
        segments: [
          { angleId: "a", startTime: 0, endTime: 3, reason: "speaker", confidence: 1 },
          { angleId: "b", startTime: 3, endTime: 6, reason: "speaker", confidence: 0.8 },
        ],
      },
      DEFAULT_MULTICAM_EDIT_POLICY,
      50,
    );

    expect(switches.map(({ angleId, time }) => ({ angleId, time }))).toEqual([
      { angleId: "a", time: 0 },
      { angleId: "b", time: 3 },
    ]);
    expect(engine.getGroup("group-1")).toMatchObject({
      duration: 6,
      activeAngleId: "a",
      automaticEdit: {
        activityWindowMs: 50,
        policy: DEFAULT_MULTICAM_EDIT_POLICY,
      },
    });
  });

  it("builds trimmed output clips at the group sync point", () => {
    const engine = new MultiCamEngine();
    engine.loadGroups([
      group({
        switches: [
          { id: "s1", groupId: "group-1", angleId: "a", time: 0, reason: "speaker" },
          { id: "s2", groupId: "group-1", angleId: "b", time: 3, reason: "speaker" },
        ],
        duration: 6,
      }),
    ]);

    const output = engine.buildSequenceClips(
      "group-1",
      "multicam-output",
      new Map([
        ["clip-a", clip("clip-a")],
        ["clip-b", clip("clip-b")],
      ]),
    );

    expect(output).toHaveLength(2);
    expect(output[0]?.clip).toMatchObject({
      mediaId: "media-clip-a",
      trackId: "multicam-output",
      startTime: 10,
      duration: 3,
      inPoint: 1,
      outPoint: 4,
      metadata: { multicam: { groupId: "group-1", angleId: "a" } },
    });
    expect(output[1]?.clip).toMatchObject({
      mediaId: "media-clip-b",
      startTime: 13,
      duration: 3,
      inPoint: 4.25,
      outPoint: 7.25,
    });
  });

  it("applies a raw audio offset independently of clip playback speed", () => {
    const engine = new MultiCamEngine();
    engine.loadGroups([
      group({
        switches: [
          { id: "s1", groupId: "group-1", angleId: "b", time: 2 },
        ],
        activeAngleId: "b",
        duration: 4,
      }),
    ]);
    const fastClip = { ...clip("clip-b"), speed: 2 };

    const output = engine.buildSequenceClips(
      "group-1",
      "output",
      new Map([["clip-b", fastClip]]),
    );

    expect(output[0]?.clip.inPoint).toBe(1.25);
    expect(output[1]?.clip.inPoint).toBe(5.25);
  });

  it("removes switches that reference a deleted angle", () => {
    const engine = new MultiCamEngine();
    engine.loadGroups([
      group({
        switches: [{ id: "s1", groupId: "group-1", angleId: "b", time: 2 }],
      }),
    ]);

    engine.removeAngle("group-1", "b");

    expect(engine.getSwitches("group-1")).toEqual([]);
  });

  it("materializes split layouts as grouped panel tracks with morph keyframes", () => {
    const engine = new MultiCamEngine();
    engine.loadGroups([group({
      manifest: {
        spec: "openreel-multicam/v1",
        fps: 25,
        sync: { method: "audio-crosscorr", reference: "a" },
        participants: [
          { id: "p1", name: "Host", audio: "a", seat: "left" },
          { id: "p2", name: "Guest", audio: "b", seat: "right" },
        ],
        cameras: [
          { id: "a", type: "closeup", subject: "p1", file: "a.mp4", clipId: "clip-a" },
          { id: "b", type: "closeup", subject: "p2", file: "b.mp4", clipId: "clip-b" },
        ],
        constraints: DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS,
      },
      shotPlan: {
        spec: "openreel-multicam-edit/v1",
        durationMs: 4_000,
        shots: [
          {
            startMs: 0,
            endMs: 2_000,
            reason: "speaker",
            confidence: 1,
            transitionIn: { type: "cut", durationMs: 0 },
            layout: {
              template: "solo",
              panels: [{ cameraId: "a", subject: "p1", rect: { x: 0, y: 0, width: 1, height: 1 } }],
            },
          },
          {
            startMs: 2_000,
            endMs: 4_000,
            reason: "sustained-overlap",
            confidence: 0.9,
            transitionIn: { type: "layout-morph", durationMs: 200 },
            layout: {
              template: "split2",
              panels: [
                { cameraId: "a", subject: "p1", rect: { x: 0, y: 0, width: 0.5, height: 1 } },
                { cameraId: "b", subject: "p2", rect: { x: 0.5, y: 0, width: 0.5, height: 1 } },
              ],
            },
          },
        ],
      },
    })]);

    const tracks = engine.buildShotPlanTracks(
      "group-1",
      "output",
      new Map([["clip-a", clip("clip-a")], ["clip-b", clip("clip-b")]]),
      { width: 1920, height: 1080 },
    );

    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.clips[1]?.transform).toMatchObject({
      position: { x: -480, y: 0 },
      scale: { x: 0.5, y: 1 },
    });
    expect(tracks[0]?.clips[1]?.keyframes).toHaveLength(4);
    expect(tracks[1]?.clips[0]?.volume).toBe(0);
    expect(new Set(tracks.flatMap((track) => track.clips.map((entry) => entry.id))).size).toBe(3);
  });
});

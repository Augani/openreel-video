import { describe, it, expect, beforeEach } from "vitest";
import { ClipManager } from "./clip-manager";
import type { Timeline, Track, Clip } from "../types";

const createMockClip = (overrides?: Partial<Clip>): Clip => ({
  id: "clip-1",
  mediaId: "media-1",
  trackId: "track-1",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0.5, y: 0.5 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  ...overrides,
});

const createMockTrack = (overrides?: Partial<Track>): Track => ({
  id: "track-1",
  type: "video",
  name: "Video 1",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

const createMockTimeline = (overrides?: Partial<Timeline>): Timeline => ({
  tracks: [createMockTrack()],
  subtitles: [],
  duration: 0,
  markers: [],
  ...overrides,
});

describe("ClipManager", () => {
  let clipManager: ClipManager;

  beforeEach(() => {
    clipManager = new ClipManager({
      snapToGridEnabled: false,
    });
  });

  describe("addClip", () => {
    it("should add a clip to a track", async () => {
      const timeline = createMockTimeline();
      const initialClipCount = timeline.tracks[0].clips.length;

      const result = await clipManager.addClip(timeline, {
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 5,
      });

      expect(result.success).toBe(true);
      expect(timeline.tracks[0].clips.length).toBe(initialClipCount + 1);

      const addedClip = timeline.tracks[0].clips[initialClipCount];
      expect(addedClip.mediaId).toBe("media-1");
      expect(addedClip.startTime).toBe(0);
      expect(addedClip.duration).toBe(5);
    });

    it("should fail when track not found", async () => {
      const timeline = createMockTimeline();

      const result = await clipManager.addClip(timeline, {
        trackId: "non-existent-track",
        mediaId: "media-1",
        startTime: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Track not found");
    });

    it("should fail when track is locked", async () => {
      const timeline = createMockTimeline({
        tracks: [createMockTrack({ locked: true })],
      });

      const result = await clipManager.addClip(timeline, {
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Track is locked");
    });

    it("should use default duration when not specified", async () => {
      const timeline = createMockTimeline();
      const initialClipCount = timeline.tracks[0].clips.length;

      const result = await clipManager.addClip(timeline, {
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
      });

      expect(result.success).toBe(true);
      expect(timeline.tracks[0].clips.length).toBe(initialClipCount + 1);

      const addedClip = timeline.tracks[0].clips[initialClipCount];
      expect(addedClip.duration).toBeGreaterThan(0);
    });

    it("should handle adding clip at specific time", async () => {
      const timeline = createMockTimeline();
      const initialClipCount = timeline.tracks[0].clips.length;

      const result = await clipManager.addClip(timeline, {
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 10,
        duration: 3,
      });

      expect(result.success).toBe(true);
      expect(timeline.tracks[0].clips.length).toBe(initialClipCount + 1);

      const addedClip = timeline.tracks[0].clips[initialClipCount];
      expect(addedClip.startTime).toBe(10);
      expect(addedClip.duration).toBe(3);
    });
  });

  describe("moveClip", () => {
    it("should fail when clip not found", async () => {
      const timeline = createMockTimeline();

      const result = await clipManager.moveClip(timeline, {
        clipId: "non-existent-clip",
        startTime: 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Clip not found");
    });

    it("should fail when track is locked", async () => {
      const clip = createMockClip();
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
            locked: true,
          }),
        ],
      });

      const result = await clipManager.moveClip(timeline, {
        clipId: "clip-1",
        startTime: 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Source track is locked");
    });

    it("should fail when target track is locked", async () => {
      const clip = createMockClip();
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
          createMockTrack({
            id: "track-2",
            locked: true,
          }),
        ],
      });

      const result = await clipManager.moveClip(timeline, {
        clipId: "clip-1",
        startTime: 5,
        trackId: "track-2",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Target track is locked");
    });

    it("should fail when target track not found", async () => {
      const clip = createMockClip();
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      const result = await clipManager.moveClip(timeline, {
        clipId: "clip-1",
        startTime: 5,
        trackId: "non-existent-track",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Target track not found");
    });

    it("should move clip within same track", async () => {
      const clip = createMockClip({ startTime: 0 });
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      const result = await clipManager.moveClip(timeline, {
        clipId: "clip-1",
        startTime: 10,
      });

      expect(result.success).toBe(true);

      const movedClip = clipManager.findClip(timeline, "clip-1");
      expect(movedClip?.startTime).toBe(10);
    });

    it("should move clip to different track", async () => {
      const clip = createMockClip({ startTime: 0, trackId: "track-1" });
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            id: "track-1",
            clips: [clip],
          }),
          createMockTrack({
            id: "track-2",
            clips: [],
          }),
        ],
      });

      const result = await clipManager.moveClip(timeline, {
        clipId: "clip-1",
        startTime: 5,
        trackId: "track-2",
      });

      expect(result.success).toBe(true);

      expect(timeline.tracks[0].clips.length).toBe(0);
      expect(timeline.tracks[1].clips.length).toBe(1);
      expect(timeline.tracks[1].clips[0].startTime).toBe(5);
    });
  });

  describe("trimClip", () => {
    it("should fail when clip not found", async () => {
      const timeline = createMockTimeline();

      const result = await clipManager.trimClip(timeline, "non-existent-clip", {
        inPoint: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Clip not found");
    });

    it("should fail when track is locked", async () => {
      const clip = createMockClip();
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
            locked: true,
          }),
        ],
      });

      const result = await clipManager.trimClip(timeline, "clip-1", {
        inPoint: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Track is locked");
    });

    it("should trim clip in point", async () => {
      const clip = createMockClip({ inPoint: 0, outPoint: 10, duration: 10 });
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      const result = await clipManager.trimClip(timeline, "clip-1", {
        inPoint: 2,
      });

      expect(result.success).toBe(true);

      const trimmedClip = clipManager.findClip(timeline, "clip-1");
      expect(trimmedClip?.inPoint).toBe(2);
    });

    it("should trim clip out point", async () => {
      const clip = createMockClip({ inPoint: 0, outPoint: 10, duration: 10 });
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      const result = await clipManager.trimClip(timeline, "clip-1", {
        outPoint: 8,
      });

      expect(result.success).toBe(true);

      const trimmedClip = clipManager.findClip(timeline, "clip-1");
      expect(trimmedClip?.outPoint).toBe(8);
    });

    it("should fail when in point is after out point", async () => {
      const clip = createMockClip({ outPoint: 5, duration: 5 });
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      const result = await clipManager.trimClip(timeline, "clip-1", {
        inPoint: 10,
        outPoint: 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("In-point must be less than out-point");
    });
  });

  describe("splitClip", () => {
    it("should fail when clip not found", async () => {
      const timeline = createMockTimeline();

      const result = await clipManager.splitClip(
        timeline,
        "non-existent-clip",
        2,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Clip not found");
    });

    it("should fail when track is locked", async () => {
      const clip = createMockClip();
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
            locked: true,
          }),
        ],
      });

      const result = await clipManager.splitClip(timeline, "clip-1", 2);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Track is locked");
    });

    it("should fail when split time is outside clip bounds", async () => {
      const clip = createMockClip({ startTime: 0, duration: 5 });
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      const result = await clipManager.splitClip(timeline, "clip-1", 10);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Split time must be within clip bounds");
    });

    it("should split clip at valid time", async () => {
      const clip = createMockClip({
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      const result = await clipManager.splitClip(timeline, "clip-1", 5);

      expect(result.success).toBe(true);

      expect(timeline.tracks[0].clips.length).toBe(2);

      const firstClip = timeline.tracks[0].clips.find((c) => c.id === "clip-1");
      expect(firstClip).toBeDefined();
      expect(firstClip?.duration).toBeLessThan(10);
    });
  });

  describe("deleteClip", () => {
    it("should fail when clip not found", async () => {
      const timeline = createMockTimeline();

      const result = await clipManager.deleteClip(
        timeline,
        "non-existent-clip",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Clip not found");
    });

    it("should fail when track is locked", async () => {
      const clip = createMockClip();
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
            locked: true,
          }),
        ],
      });

      const result = await clipManager.deleteClip(timeline, "clip-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Track is locked");
    });

    it("should delete clip from track", async () => {
      const clip = createMockClip();
      const timeline = createMockTimeline({
        tracks: [
          createMockTrack({
            clips: [clip],
          }),
        ],
      });

      expect(timeline.tracks[0].clips.length).toBe(1);

      const result = await clipManager.deleteClip(timeline, "clip-1");

      expect(result.success).toBe(true);
      expect(timeline.tracks[0].clips.length).toBe(0);

      const deletedClip = clipManager.findClip(timeline, "clip-1");
      expect(deletedClip).toBeUndefined();
    });
  });

});

describe("ClipManager - Edge Cases", () => {
  let clipManager: ClipManager;

  beforeEach(() => {
    clipManager = new ClipManager({
      snapToGridEnabled: false,
    });
  });

  it("should handle empty timeline", async () => {
    const timeline = createMockTimeline({ tracks: [] });

    const result = await clipManager.addClip(timeline, {
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Track not found");
  });

  it("should reject negative start time", async () => {
    const timeline = createMockTimeline();

    const result = await clipManager.addClip(timeline, {
      trackId: "track-1",
      mediaId: "media-1",
      startTime: -5,
    });

    expect(result.success).toBe(false);
  });
});

describe("ClipManager - Helper Methods", () => {
  let clipManager: ClipManager;

  beforeEach(() => {
    clipManager = new ClipManager({
      snapToGridEnabled: false,
    });
  });

  it("should find clip in timeline", () => {
    const clip = createMockClip({ id: "target-clip" });
    const timeline = createMockTimeline({
      tracks: [
        createMockTrack({
          clips: [clip],
        }),
      ],
    });

    const found = clipManager.findClip(timeline, "target-clip");
    expect(found).toBeDefined();
    expect(found?.id).toBe("target-clip");
  });

  it("should detect overlapping clips", () => {
    const track = createMockTrack({
      clips: [createMockClip({ id: "clip-1", startTime: 0, duration: 10 })],
    });

    const wouldOverlap = clipManager.wouldOverlap(track, 5, 5);
    expect(wouldOverlap).toBe(true);
  });

  it("should detect non-overlapping clips", () => {
    const track = createMockTrack({
      clips: [createMockClip({ id: "clip-1", startTime: 0, duration: 5 })],
    });

    const wouldOverlap = clipManager.wouldOverlap(track, 10, 5);
    expect(wouldOverlap).toBe(false);
  });

  it("should get track clips", () => {
    const timeline = createMockTimeline({
      tracks: [
        createMockTrack({
          id: "my-track",
          clips: [
            createMockClip({ id: "clip-1" }),
            createMockClip({ id: "clip-2" }),
          ],
        }),
      ],
    });

    const clips = clipManager.getTrackClips(timeline, "my-track");
    expect(clips.length).toBe(2);
  });

});

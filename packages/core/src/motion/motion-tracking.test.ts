import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionTrack,
  addMotionTrackPointFrame,
  applyMotionTrackToLayer,
  createMotionTrack,
  getMotionTrackPointAtTime,
  removeMotionTrack,
  smoothMotionTrack,
  updateMotionTrack,
} from "./motion-tracking";

const makeComposition = (): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

const makeLayer = (): MotionLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Callout",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x: 120, y: 240, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 10,
  },
  keyframes: [],
  shapeType: "rectangle",
  width: 120,
  height: 80,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#ffffff", width: 0, opacity: 0 },
    cornerRadius: 8,
  },
});

describe("motion tracking", () => {
  it("creates, updates, and removes composition tracks immutably", () => {
    const track = createMotionTrack({
      id: "track-1",
      name: " Logo Pin ",
      points: [{ id: "p1", name: "Main", frames: [] }],
    });
    const composition = addMotionTrack(makeComposition(), track);
    const updated = updateMotionTrack(composition, "track-1", (item) => ({
      ...item,
      name: "CTA Pin",
    }));
    const removed = removeMotionTrack(updated, "track-1");

    expect(track.name).toBe("Logo Pin");
    expect(composition.tracks?.[0]?.name).toBe("Logo Pin");
    expect(updated.tracks?.[0]?.name).toBe("CTA Pin");
    expect(removed.tracks).toEqual([]);
  });

  it("adds sorted point frames and interpolates at arbitrary times", () => {
    const track = addMotionTrackPointFrame(
      addMotionTrackPointFrame(createMotionTrack({ id: "track-1" }), {
        pointId: "point-1",
        frame: { time: 2, position: { x: 300, y: 500 }, confidence: 0.8 },
      }),
      {
        pointId: "point-1",
        frame: { time: 0, position: { x: 100, y: 100 }, confidence: 1 },
      },
    );

    expect(track.points[0].frames.map((frame) => frame.time)).toEqual([0, 2]);
    expect(getMotionTrackPointAtTime(track.points[0], 1)).toEqual({
      time: 1,
      position: { x: 200, y: 300, z: 0 },
      confidence: 0.9,
    });
  });

  it("smooths noisy tracks with a centered moving average", () => {
    const track = createMotionTrack({
      id: "track-1",
      points: [
        {
          id: "p1",
          name: "Main",
          frames: [
            { time: 0, position: { x: 0, y: 0 } },
            { time: 1, position: { x: 30, y: 60 } },
            { time: 2, position: { x: 60, y: 0 } },
          ],
        },
      ],
    });

    expect(smoothMotionTrack(track, 1).points[0].frames[1]).toMatchObject({
      time: 1,
      position: { x: 30, y: 20, z: 0 },
    });
  });

  it("applies a point track as layer position keyframes while preserving offset", () => {
    const track = createMotionTrack({
      id: "track-1",
      points: [
        {
          id: "p1",
          name: "Main",
          frames: [
            { time: 0, position: { x: 100, y: 200 } },
            { time: 1, position: { x: 180, y: 260 } },
          ],
        },
      ],
    });
    const layer = applyMotionTrackToLayer(makeLayer(), track, {
      idFactory: (property, time) => `${property}-${time}`,
    });

    expect(
      layer.keyframes.map((keyframe) => [
        keyframe.property,
        keyframe.time,
        keyframe.value,
      ]),
    ).toEqual([
      ["transform.position.x", 0, 120],
      ["transform.position.y", 0, 240],
      ["transform.position.z", 0, 0],
      ["transform.position.x", 1, 200],
      ["transform.position.y", 1, 300],
      ["transform.position.z", 1, 0],
    ]);
  });

  it("applies two-point tracks as position, scale, and rotation keyframes", () => {
    const track = createMotionTrack({
      id: "track-1",
      points: [
        {
          id: "p1",
          name: "Primary",
          frames: [
            { time: 0, position: { x: 100, y: 100 } },
            { time: 1, position: { x: 100, y: 100 } },
          ],
        },
        {
          id: "p2",
          name: "Secondary",
          frames: [
            { time: 0, position: { x: 200, y: 100 } },
            { time: 1, position: { x: 100, y: 300 } },
          ],
        },
      ],
    });
    const layer = applyMotionTrackToLayer(makeLayer(), track, {
      mode: "position-scale-rotation",
      preserveOffset: false,
      idFactory: (property, time) => `${property}-${time}`,
    });

    const byProperty = new Map(
      layer.keyframes.map((keyframe) => [
        `${keyframe.property}:${keyframe.time}`,
        keyframe.value,
      ]),
    );
    expect(byProperty.get("transform.scale.x:1")).toBe(2);
    expect(byProperty.get("transform.scale.y:1")).toBe(2);
    expect(byProperty.get("transform.rotation:1")).toBe(100);
  });
});

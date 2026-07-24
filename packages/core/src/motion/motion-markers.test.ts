import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionCompositionMarker,
  applyMotionAnimationPresetToBeats,
  createMotionMarker,
  detectMotionBeatMarkersFromPeaks,
  generateMotionBeatMarkersAtBpm,
  setMotionBeatMarkers,
  snapMotionTimeToTimingPoint,
} from "./motion-markers";

const makeComposition = (): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 4,
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
  name: "Panel",
  startTime: 0,
  duration: 4,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x: 960, y: 540 },
  },
  keyframes: [],
  shapeType: "rectangle",
  width: 320,
  height: 180,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

describe("motion markers", () => {
  it("adds sanitized composition markers in time order", () => {
    const composition = addMotionCompositionMarker(
      addMotionCompositionMarker(
        makeComposition(),
        createMotionMarker({ id: "b", time: 2, label: " B " }),
      ),
      createMotionMarker({ id: "a", time: 1, label: "" }),
    );

    expect(composition.markers).toEqual([
      { id: "a", time: 1, label: "Marker", color: "#3b82f6" },
      { id: "b", time: 2, label: "B", color: "#3b82f6" },
    ]);
  });

  it("generates downbeat-aware beat markers from BPM", () => {
    const markers = generateMotionBeatMarkersAtBpm({
      bpm: 120,
      duration: 2,
      beatsPerBar: 4,
    });

    expect(markers.map((marker) => marker.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(markers.map((marker) => marker.isDownbeat)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  it("detects beat markers from waveform peaks", () => {
    const markers = detectMotionBeatMarkersFromPeaks(
      [0.05, 0.1, 1, 0.2, 0.1, 0.95, 0.1, 0.08],
      {
        duration: 4,
        minSpacing: 0.5,
        sensitivity: 0.8,
      },
    );

    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ index: 0, isDownbeat: true });
    expect(markers[1]?.time).toBeGreaterThan(markers[0]?.time ?? 0);
  });

  it("stores beat analysis and applies animation presets across beats", () => {
    const beatMarkers = generateMotionBeatMarkersAtBpm({
      bpm: 120,
      duration: 2,
    });
    const composition = setMotionBeatMarkers(makeComposition(), beatMarkers, {
      bpm: 120,
      confidence: 1,
      analyzedAt: 123,
    });
    const layer = applyMotionAnimationPresetToBeats(
      makeLayer(),
      "pulse",
      composition.beatMarkers ?? [],
      { duration: 0.2, maxBeats: 2 },
    );

    expect(composition.beatAnalysis).toMatchObject({ bpm: 120, confidence: 1 });
    expect(layer.keyframes.length).toBeGreaterThan(0);
    expect(new Set(layer.keyframes.map((keyframe) => keyframe.time))).toEqual(
      new Set([0, 0.1, 0.2, 0.5, 0.6, 0.7]),
    );
  });

  it("snaps times to nearby markers or beats within the threshold", () => {
    const beatMarkers = generateMotionBeatMarkersAtBpm({
      bpm: 120,
      duration: 2,
    });
    const markers = [createMotionMarker({ id: "m1", time: 1.25 })];

    expect(
      snapMotionTimeToTimingPoint(0.53, {
        markers,
        beatMarkers,
        threshold: 0.05,
      }),
    ).toBe(0.5);
    expect(
      snapMotionTimeToTimingPoint(1.22, {
        markers,
        beatMarkers,
        threshold: 0.05,
      }),
    ).toBe(1.25);
    expect(
      snapMotionTimeToTimingPoint(1.38, {
        markers,
        beatMarkers,
        threshold: 0.05,
      }),
    ).toBe(1.38);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ActionExecutor,
  GraphicsEngine,
  TitleEngine,
  type Clip,
  type Keyframe,
  type Project,
  type StickerClip,
} from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { listAvailablePresets, type MotionPreset } from "./motion-presets";
import {
  applyMotionPreset,
  boundedMotionPresetDuration,
  createMotionPresetKeyframes,
  MOTION_PRESET_PREFIX,
  removeMotionPresetCategory,
  resolveMotionPresetTarget,
  type MotionPresetScope,
  type MotionPresetTargetKind,
} from "./motion-preset-application";

const engines = {
  graphicsEngine: useEngineStore.getState().graphicsEngine,
  titleEngine: useEngineStore.getState().titleEngine,
};
const kinds = ["regular", "text", "shape", "svg", "sticker"] as const;
const manual: Keyframe = {
  id: "manual",
  time: 0.2,
  property: "rotation",
  value: 17,
  easing: "linear",
};
const transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 0.8, y: 0.9 },
  rotation: 3,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 0.7,
};
const preset = (name: string) =>
  listAvailablePresets().find((item) => item.name === name)!;
const state = () => useProjectStore.getState();

function fixture(kind: MotionPresetTargetKind = "regular"): MotionPresetScope {
  const base = createEmptyProject("Preset history");
  const clip: Clip = {
    id: "target",
    trackId: "track",
    mediaId: "media",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    keyframes: [manual],
    volume: 1,
    transform,
  };
  const graphics = new GraphicsEngine();
  const shape = graphics.createShape(
    {
      id: "target",
      shapeType: "rectangle",
      width: 240,
      height: 160,
      style: {
        fill: { type: "solid", color: "#14b8a6", opacity: 1 },
        stroke: { color: "#ffffff", width: 0, opacity: 1 },
      },
    },
    "track",
    0,
    5,
  );
  const text = new TitleEngine().createTextClip({
    trackId: "track",
    text: "Title",
    startTime: 0,
    duration: 5,
  });
  const svg = graphics.importSVG(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="#14b8a6"/></svg>',
    "track",
    0,
    5,
    { id: "target" },
  );
  const sticker: StickerClip = {
    id: "target",
    trackId: "track",
    startTime: 0,
    duration: 5,
    type: "sticker",
    imageUrl: "test.png",
    transform,
    keyframes: [manual],
  };
  const project: Project = {
    ...base,
    timeline: {
      ...base.timeline,
      duration: 5,
      tracks: [
        {
          id: "track",
          name: "Visual",
          type: "video",
          clips: kind === "regular" ? [clip] : [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
    ...(kind === "shape"
      ? { shapeClips: [{ ...shape, transform, keyframes: [manual] }] }
      : kind === "text"
        ? {
            textClips: [
              { ...text, id: "target", transform, keyframes: [manual] },
            ],
          }
        : kind === "svg"
          ? { svgClips: [{ ...svg, transform, keyframes: [manual] }] }
          : kind === "sticker"
            ? { stickerClips: [sticker] }
            : {}),
  };
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project,
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    clipUndoStack: [],
    clipRedoStack: [],
    templateUndoStack: [],
    templateRedoStack: [],
  });
  return { projectId: project.id, executor, clipId: "target" };
}
function keys() {
  return resolveMotionPresetTarget(state().project, "target")!.data.keyframes!;
}
beforeEach(() => {
  useEngineStore.setState({ graphicsEngine: null, titleEngine: null });
  const ui = useUIStore.getState();
  useUIStore.setState({
    effectApplicationClipId: null,
    exportState: { ...ui.exportState, isExporting: false },
  });
  useTimelineStore.setState({ playbackLockedReason: null });
});
afterEach(() => {
  useEngineStore.setState(engines);
});

describe("canonical preset application", () => {
  it.each(kinds)(
    "preserves %s keys through save, Undo and Redo with no renderer",
    async (kind) => {
      const scope = fixture(kind);
      expect(applyMotionPreset(scope, preset("Fade In"), 1.2)).toBe(true);
      expect(keys()).toContainEqual(manual);
      const applied = structuredClone(keys());
      expect(
        applied
          .filter((key) => key.id.startsWith("motion-in-"))
          .map((key) => key.time),
      ).toEqual([0, 1.2]);
      expect(
        resolveMotionPresetTarget(
          JSON.parse(JSON.stringify(state().getFullProject())),
          "target",
        )?.data.keyframes,
      ).toEqual(applied);
      await state().undo();
      expect(keys()).toEqual([manual]);
      await state().redo();
      expect(keys()).toEqual(applied);
    },
  );
  it.each(kinds)(
    "keeps all four categories independent on %s and removes only the chosen category",
    async (kind) => {
      const scope = fixture(kind);
      for (const name of ["Fade In", "Fade Out", "Pulse", "Cross Dissolve"])
        expect(applyMotionPreset(scope, preset(name))).toBe(true);
      const all = structuredClone(keys());
      for (const prefix of Object.values(MOTION_PRESET_PREFIX))
        expect(all.some((key) => key.id.startsWith(prefix))).toBe(true);
      expect(removeMotionPresetCategory(scope, "transition")).toBe(true);
      expect(keys()).toEqual(
        all.filter((key) => !key.id.startsWith("motion-transition-")),
      );
      await state().undo();
      expect(keys()).toEqual(all);
    },
  );
  it("retains unrelated manual keys added before reapplication and legacy emphasis identifiers", () => {
    const scope = fixture();
    applyMotionPreset(scope, preset("Pulse"));
    applyMotionPreset(scope, preset("Cross Dissolve"));
    applyMotionPreset(scope, preset("Fade In"));
    const previous = [...keys()];
    applyMotionPreset(scope, preset("Slide In Left"), 2);
    expect(keys().filter((key) => !key.id.startsWith("motion-in-"))).toEqual(
      previous.filter((key) => !key.id.startsWith("motion-in-")),
    );
  });
  it("records only the affected keyframe values in history", () => {
    const scope = fixture();
    const project = state().project;
    useProjectStore.setState({
      project: { ...project, name: "unrelated-large-payload".repeat(10000) },
    });
    applyMotionPreset(scope, preset("Fade In"));
    const serialized = JSON.stringify(
      state().actionHistory.getHistoryEntries(),
    );
    expect(serialized).not.toContain("unrelated-large-payload");
    expect(serialized.length).toBeLessThan(5000);
  });
});

describe("retained preset catalog and coordinates", () => {
  it.each(listAvailablePresets().map((item) => [item.name, item] as const))(
    "retains finite bounded tracks for %s on pixel and normalized owners",
    (_name, item) => {
      for (const kind of kinds) {
        const scope = fixture(kind),
          target = resolveMotionPresetTarget(
            state().project,
            scope.clipId,
          )!.data;
        const generated = createMotionPresetKeyframes(
          item,
          target,
          kind,
          0.3,
          state().project.settings,
        );
        expect(generated).toHaveLength(
          item.tracks.reduce(
            (count, track) => count + track.keyframes.length,
            0,
          ),
        );
        expect(
          generated.every(
            (key) =>
              key.time >= 0 &&
              key.time <= target.duration &&
              Number.isFinite(key.value),
          ),
        ).toBe(true);
        expect(new Set(generated.map((key) => key.id)).size).toBe(
          generated.length,
        );
        expect(applyMotionPreset(scope, item, 0.3)).toBe(true);
      }
    },
  );
  it("uses canvas pixels for media slides and normalized units for overlays", () => {
    for (const kind of kinds) {
      const scope = fixture(kind),
        target = resolveMotionPresetTarget(state().project, scope.clipId)!.data;
      const generated = createMotionPresetKeyframes(
        preset("Slide In Left"),
        target,
        kind,
        1,
        { width: 1920, height: 1080 },
      );
      const start = Number(
        generated.find((key) => key.property === "position.x" && key.time === 0)
          ?.value,
      );
      expect(start).toBeCloseTo(
        0.5 - (kind === "regular" ? 2020 : 1 + 100 / 1920),
      );
    }
  });
  it("bounds even sub-step clips and long exit/emphasis durations without negative time", () => {
    const scope = fixture(),
      target = resolveMotionPresetTarget(state().project, scope.clipId)!.data;
    for (const name of ["Fade Out", "Pulse"]) {
      const generated = createMotionPresetKeyframes(
        preset(name),
        { ...target, duration: 0.01 },
        "regular",
        20,
        state().project.settings,
      );
      expect(generated.every((key) => key.time >= 0 && key.time <= 0.01)).toBe(
        true,
      );
    }
    expect(boundedMotionPresetDuration(0, 1, 0.01)).toBe(0.01);
    expect(boundedMotionPresetDuration(Infinity, 0.5, 5)).toBe(0.5);
  });
});

describe("preset ownership and editing guards", () => {
  it.each([
    "project",
    "executor",
    "removed",
    "locked",
    "export",
    "processing",
    "playback",
  ])("rejects a %s scope before mutation or history", (reason) => {
    const scope = fixture();
    if (reason === "project") scope.projectId = "different";
    if (reason === "executor") scope.executor = new ActionExecutor();
    if (["removed", "locked"].includes(reason)) {
      const project = state().project;
      useProjectStore.setState({
        project: {
          ...project,
          timeline: {
            ...project.timeline,
            tracks: project.timeline.tracks.map((track) => ({
              ...track,
              ...(reason === "removed" ? { clips: [] } : { locked: true }),
            })),
          },
        },
      });
    }
    if (reason === "export")
      useUIStore.setState({
        exportState: {
          ...useUIStore.getState().exportState,
          isExporting: true,
        },
      });
    if (reason === "processing")
      useUIStore.setState({ effectApplicationClipId: "target" });
    if (reason === "playback")
      useTimelineStore.setState({ playbackLockedReason: "test" });
    expect(applyMotionPreset(scope, preset("Fade In"))).toBe(false);
    expect(removeMotionPresetCategory(scope, "entrance")).toBe(false);
    expect(state().actionHistory.canUndo()).toBe(false);
  });
  it("rejects corrupt preset numbers and zero-duration presets without losing existing keys", () => {
    const scope = fixture();
    expect(
      applyMotionPreset(scope, { ...preset("Fade In"), duration: 0 }),
    ).toBe(false);
    const broken: MotionPreset = {
      ...preset("Fade In"),
      tracks: [{ property: "opacity", keyframes: [{ time: 0, value: NaN }] }],
    };
    expect(applyMotionPreset(scope, broken)).toBe(false);
    expect(keys()).toEqual([manual]);
    expect(state().actionHistory.canUndo()).toBe(false);
  });
});

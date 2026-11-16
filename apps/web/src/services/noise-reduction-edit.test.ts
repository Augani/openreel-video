import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionExecutor, ActionHistory, type Project } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import {
  createNoiseReductionEffect,
  DEFAULT_NOISE_REDUCTION,
} from "../bridges/audio-bridge-effects";
import {
  editNoiseReduction,
  type NoiseReductionScope,
} from "./noise-reduction-edit";
function fixture() {
  const p = createEmptyProject("Cleanup"),
    history = new ActionHistory(),
    executor = new ActionExecutor(history),
    blob = new Blob(["source"]);
  const noise = {
    ...createNoiseReductionEffect(DEFAULT_NOISE_REDUCTION),
    enabled: false,
  };
  const project: Project = {
    ...p,
    mediaLibrary: {
      items: [
        {
          id: "source",
          type: "audio",
          name: "Audio",
          blob,
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 6,
            width: 0,
            height: 0,
            frameRate: 0,
            sampleRate: 48000,
            channels: 2,
            codec: "pcm",
            fileSize: 6,
          },
        },
      ],
    },
    timeline: {
      ...p.timeline,
      duration: 6,
      tracks: [
        {
          id: "track",
          name: "Audio",
          type: "audio",
          transitions: [],
          hidden: false,
          muted: false,
          solo: false,
          locked: false,
          clips: [
            {
              id: "clip",
              mediaId: "source",
              trackId: "track",
              startTime: 0,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              volume: 0.6,
              audioEffects: [
                noise,
                {
                  id: "gain",
                  type: "gain",
                  enabled: true,
                  params: { value: 0.75 },
                },
              ],
              effects: [],
              keyframes: [],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                anchor: { x: 0.5, y: 0.5 },
                rotation: 0,
                opacity: 1,
              },
            },
          ],
        },
      ],
    },
  };
  useProjectStore.setState({
    project,
    hasOpenProject: true,
    actionHistory: history,
    actionExecutor: executor,
  });
  return {
    scope: {
      projectId: project.id,
      executor,
      clipId: "clip",
    } satisfies NoiseReductionScope,
    project,
    history,
    blob,
  };
}
beforeEach(() => {
  const s = useUIStore.getState();
  useUIStore.setState({
    exportState: { ...s.exportState, isExporting: false },
    effectApplicationClipId: null,
  });
});
afterEach(() => {
  const s = useUIStore.getState();
  useUIStore.setState({
    exportState: { ...s.exportState, isExporting: false },
  });
});
describe("canonical cleanup edits", () => {
  it("persists disabled parameters, protects source identity and restores the complete effect on Undo/Redo", async () => {
    const { scope, project, blob } = fixture();
    const old = project.timeline.tracks[0].clips[0].audioEffects[0];
    const next = editNoiseReduction(scope, {
      config: { ...DEFAULT_NOISE_REDUCTION, threshold: -51 },
    });
    expect(next?.enabled).toBe(false);
    expect(useProjectStore.getState().project.mediaLibrary.items[0].blob).toBe(
      blob,
    );
    expect(project.timeline.tracks[0].clips[0].audioEffects[0]).toBe(old);
    expect(await useProjectStore.getState().undo()).toMatchObject({
      success: true,
    });
    expect(useProjectStore.getState().getAudioEffects("clip")[0]).toEqual(old);
    expect(await useProjectStore.getState().redo()).toMatchObject({
      success: true,
    });
    expect(
      useProjectStore.getState().getAudioEffects("clip")[0].params.threshold,
    ).toBe(-51);
    expect(useProjectStore.getState().getAudioEffects("clip")[1].id).toBe(
      "gain",
    );
  });
  it("keeps A/B preview out of Undo history while retaining the cleaned export effect", () => {
    const { scope, history } = fixture();
    editNoiseReduction(scope, { previewBypass: true });
    expect(
      useProjectStore.getState().getAudioEffects("clip")[0].metadata
        ?.previewBypass,
    ).toBe(true);
    expect(history.getUndoStackSize()).toBe(0);
    editNoiseReduction(scope, { previewBypass: false });
    expect(
      useProjectStore.getState().getAudioEffects("clip")[0].metadata,
    ).toBeUndefined();
    expect(history.getUndoStackSize()).toBe(0);
  });
  it("retains the first effect identity without adding duplicate noise removal entries", () => {
    const { scope, history } = fixture();
    const old = useProjectStore.getState().getAudioEffects("clip")[0];
    editNoiseReduction(scope, {
      config: { ...DEFAULT_NOISE_REDUCTION, threshold: -36 },
      enabled: true,
      previewBypass: false,
    });
    editNoiseReduction(scope, {
      config: { ...DEFAULT_NOISE_REDUCTION, threshold: -36 },
      enabled: true,
      previewBypass: false,
    });
    expect(
      useProjectStore
        .getState()
        .getAudioEffects("clip")
        .filter((effect) => effect.type === "noiseReduction"),
    ).toHaveLength(1);
    expect(useProjectStore.getState().getAudioEffects("clip")[0].id).toBe(
      old.id,
    );
    expect(history.getUndoStackSize()).toBe(1);
  });
  it.each(["closed", "replaced", "locked", "exporting"])(
    "rejects %s targets before creating history",
    (reason) => {
      const { scope, project, history } = fixture();
      if (reason === "closed")
        useProjectStore.setState({ hasOpenProject: false });
      if (reason === "replaced")
        useProjectStore.setState({ actionExecutor: new ActionExecutor() });
      if (reason === "locked")
        useProjectStore.setState({
          project: {
            ...project,
            timeline: {
              ...project.timeline,
              tracks: project.timeline.tracks.map((track) => ({
                ...track,
                locked: true,
              })),
            },
          },
        });
      if (reason === "exporting") {
        const state = useUIStore.getState();
        useUIStore.setState({
          exportState: { ...state.exportState, isExporting: true },
        });
      }
      expect(
        editNoiseReduction(scope, {
          config: DEFAULT_NOISE_REDUCTION,
          enabled: true,
        }),
      ).toBeNull();
      expect(history.getUndoStackSize()).toBe(0);
    },
  );
  it("rejects nonfinite settings without changing the effect", () => {
    const { scope, history } = fixture();
    expect(
      editNoiseReduction(scope, {
        config: { ...DEFAULT_NOISE_REDUCTION, threshold: NaN },
      }),
    ).toBeNull();
    expect(history.getUndoStackSize()).toBe(0);
  });
});

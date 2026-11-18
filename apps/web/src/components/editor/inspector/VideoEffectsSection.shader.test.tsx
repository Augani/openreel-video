import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { GraphicsEngine, TitleEngine, getMotionShaderDef, getMotionShaderEffectDefs } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { VideoEffectsSection } from "./VideoEffectsSection";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEngineStore } from "../../../stores/engine-store";

const clipId = "clip-shader";

const createProjectWithShaderEffect = (): Project => {
  const project = createEmptyProject("Shader Effect");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 5,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "V1",
          clips: [
            {
              id: clipId,
              mediaId: "media-1",
              trackId: "track-video",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [
                {
                  id: "effect-shader-1",
                  type: "shader",
                  enabled: true,
                  params: { shaderId: "paper-halftone-dots", size: 0.6 },
                },
              ],
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
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  } as unknown as Project;
};

const createProjectWithOrderedEffects = (): Project => {
  const project = createProjectWithShaderEffect();
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                effects: [
                  ...clip.effects,
                  {
                    id: "effect-brightness-1",
                    type: "brightness",
                    enabled: true,
                    params: { value: 20 },
                  },
                ],
              }
            : clip,
        ),
      })),
    },
  } as Project;
};

describe("VideoEffectsSection shader effect", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createProjectWithShaderEffect() });
    useProjectStore.getState().actionHistory.clear();
  });

  afterEach(() => {
    cleanup();
    useTimelineStore.getState().unlockPlayback();
    useUIStore.setState(state => ({ exportState: { ...state.exportState, isExporting: false }, effectApplicationClipId: null }));
    vi.restoreAllMocks();
  });

  it("refreshes authored shader parameters without a timestamp change", () => {
    render(<VideoEffectsSection clipId={clipId} />);
    const before = useProjectStore.getState().project;
    expect(screen.getByRole("slider", { name: "Size" })).toHaveAttribute("aria-valuenow", "0.6");
    act(() => useProjectStore.setState({ project: { ...before, timeline: { ...before.timeline,
      tracks: before.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(clip => ({ ...clip,
        effects: clip.effects.map(effect => ({ ...effect, params: { ...effect.params, size: 0.2 } })) })) })) } } }));
    expect(useProjectStore.getState().project.modifiedAt).toBe(before.modifiedAt);
    expect(screen.getByRole("slider", { name: "Size" })).toHaveAttribute("aria-valuenow", "0.2");
  });

  it.each(["locked track", "export", "processing"])("disables mutations during %s while allowing stack inspection and copying", reason => {
    render(<VideoEffectsSection clipId={clipId} />);
    act(() => {
      if (reason === "locked track") useProjectStore.setState(state => ({ project: { ...state.project, timeline: {
        ...state.project.timeline, tracks: state.project.timeline.tracks.map(track => ({ ...track, locked: true })),
      } } }));
      if (reason === "export") useUIStore.setState(state => ({ exportState: { ...state.exportState, isExporting: true } }));
      if (reason === "processing") useTimelineStore.getState().lockPlayback("Rendering");
    });
    const project = useProjectStore.getState().project;
    for (const name of ["Clear effect stack", "Duplicate effect", "Remove effect", "Disable effect", "Add Effect"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByRole("button", { name: "Copy effect stack" })).toBeEnabled();
    expect(useProjectStore.getState().project).toBe(project);
  });

  it("applies a registry shader through the picker and restores the complete clip in one Undo", async () => {
    const original = structuredClone(useProjectStore.getState().getClip(clipId));
    render(<VideoEffectsSection clipId={clipId} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Effect" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: `Shaders · ${getMotionShaderEffectDefs().length}` }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Preview and apply Halftone Dots" }));
    await waitFor(() => expect(useProjectStore.getState().getVideoEffects(clipId)).toHaveLength(2));
    expect(useProjectStore.getState().getVideoEffects(clipId)[1]).toMatchObject({ type: "shader", params: { shaderId: "paper-halftone-dots", size: .5 } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add video effect" })).toBeNull());
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getClip(clipId)).toEqual(original);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it.each(["media", "text", "shape", "svg", "sticker"] as const)(
    "preserves the complete %s clip and authored effect metadata through stack edits and one Undo",
    async kind => {
      let targetId = clipId;
      if (kind !== "media") {
        useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
        useProjectStore.getState().createNewProject("Effect preservation");
        const state = useProjectStore.getState(), track = state.project.timeline.tracks[0];
        const target = kind === "text" ? state.createTextClip(track.id, 0, "Keep every shade", 5)!
          : kind === "shape" ? state.createShapeClip(track.id, 0, "rectangle", 5)!
          : kind === "svg" ? state.importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>', track.id, 0, 5)!
          : state.createStickerClip({ id: "effect-sticker", trackId: track.id, startTime: 0, duration: 5,
            type: "emoji", imageUrl: "data:image/png;base64,AA==", keyframes: [], effects: [],
            transform: { position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } })!;
        targetId = target.id;
        if (kind === "text") state.updateTextStyle(targetId, { shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee44aa" }, progress: .37 } });
      }
      await useProjectStore.getState().replaceVideoEffects(targetId, [{ id: "preserved-shader", type: "shader", enabled: true,
        params: { shaderId: "paper-halftone-dots", size: 0, colorFront: "#000000" }, order: 0,
        metadata: { source: "authored", nested: { strength: 0 } } }]);
      const snapshot = () => {
        const project = useProjectStore.getState().project;
        return structuredClone(project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === targetId)
          ?? project.textClips?.find(clip => clip.id === targetId) ?? project.shapeClips?.find(clip => clip.id === targetId)
          ?? project.svgClips?.find(clip => clip.id === targetId) ?? project.stickerClips?.find(clip => clip.id === targetId));
      };
      const original = snapshot();
      useProjectStore.getState().actionHistory.clear();
      render(<VideoEffectsSection clipId={targetId} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy effect stack" }));
      for (const [action, expectedLength] of [["Duplicate effect", 2], ["Paste effect stack", 2], ["Disable effect", 1], ["Clear effect stack", 0]] as const) {
        fireEvent.click(screen.getByRole("button", { name: action }));
        await waitFor(() => {
          expect(useProjectStore.getState().getVideoEffects(targetId)).toHaveLength(expectedLength);
          expect(useProjectStore.getState().canUndo()).toBe(true);
          if (action === "Disable effect") expect(useProjectStore.getState().getVideoEffects(targetId)[0].enabled).toBe(false);
        });
        await act(async () => { await useProjectStore.getState().undo(); });
        expect(snapshot()).toEqual(original);
        expect(screen.getByRole("slider", { name: "Size" })).toHaveAttribute("aria-valuenow", "0");
        expect(useProjectStore.getState().canUndo()).toBe(false);
      }
    },
  );

  it("clears the authored stack from one inspector action", async () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear effect stack" }));

    await waitFor(() => {
      expect(useProjectStore.getState().getVideoEffects(clipId)).toEqual([]);
    });
  });

  it("copies and pastes the authored stack with fresh effect ids", async () => {
    render(<VideoEffectsSection clipId={clipId} />);
    const sourceId = useProjectStore.getState().getVideoEffects(clipId)[0]!.id;

    fireEvent.click(screen.getByRole("button", { name: "Copy effect stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste effect stack" }));

    await waitFor(() => {
      const effects = useProjectStore.getState().getVideoEffects(clipId);
      expect(effects).toHaveLength(2);
      expect(effects[1]).toMatchObject({
        type: "shader",
        params: { shaderId: "paper-halftone-dots", size: 0.6 },
      });
      expect(effects[1]?.id).not.toBe(sourceId);
    });
  });

  it("duplicates an authored effect from its card", async () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate effect" }));

    await waitFor(() => {
      const effects = useProjectStore.getState().getVideoEffects(clipId);
      expect(effects).toHaveLength(2);
      expect(effects[1]).toMatchObject({
        type: "shader",
        enabled: true,
        params: { shaderId: "paper-halftone-dots", size: 0.6 },
      });
      expect(effects[1]?.id).not.toBe(effects[0]?.id);
    });
  });

  it("reorders the authored effect stack from accessible controls", () => {
    useProjectStore.setState({ project: createProjectWithOrderedEffects() });
    render(<VideoEffectsSection clipId={clipId} />);
    const shaderName = getMotionShaderDef("paper-halftone-dots")!.name;

    fireEvent.click(screen.getByRole("button", { name: `Move ${shaderName} down` }));

    expect(
      useProjectStore
        .getState()
        .getVideoEffects(clipId)
        .map((effect) => effect.id),
    ).toEqual(["effect-brightness-1", "effect-shader-1"]);
    expect(
      screen.getByRole("button", { name: `Reorder ${shaderName}` }),
    ).toHaveAttribute("draggable", "true");
  });
});

import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useClipRecipesStore } from "../stores/clip-recipes-store";
import {
  applyClipRecipe,
  recentClipRecipeSteps,
  type ClipRecipe,
} from "./clip-recipes";

const makeClip = (id: string): Clip => ({
  id,
  trackId: "track",
  mediaId: "media",
  startTime: id === "source" ? 0 : 10,
  duration: 10,
  inPoint: 0,
  outPoint: 10,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    rotation: 0,
    opacity: 1,
  },
});
const clip = (id = "target") => useProjectStore.getState().getClip(id)!;
const execute = (type: string, params: Record<string, unknown>) =>
  useProjectStore
    .getState()
    .executeAction({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      params,
    });
beforeEach(() => {
  useProjectStore.getState().createNewProject("Recipes QA");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 20,
        tracks: [
          {
            id: "track",
            name: "Main",
            type: "video",
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
            transitions: [],
            clips: [makeClip("source"), makeClip("target")],
          },
        ],
      },
    },
  });
  useClipRecipesStore.setState({ recipes: [] });
});
describe("recorded clip recipes", () => {
  it("saves actual recent adjustments without original clip IDs and applies them as one reversible edit", async () => {
    await execute("transform/update", {
      clipId: "source",
      transform: { rotation: 12 },
    });
    await execute("audio/setVolume", { clipId: "source", volume: 0.25 });
    const steps = recentClipRecipeSteps(
      useProjectStore.getState().actionHistory,
    );
    expect(steps).toHaveLength(2);
    expect(steps[0].params.clipId).toBeUndefined();
    useClipRecipesStore.getState().save("Interview look", steps);
    const saved = useClipRecipesStore.getState().recipes[0];
    const count = useProjectStore.getState().actionHistory.getUndoStackSize();
    await applyClipRecipe(saved, "target");
    expect(clip().transform.rotation).toBe(12);
    expect(clip().volume).toBe(0.25);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(
      count + 1,
    );
    await useProjectStore.getState().undo();
    expect(clip().transform.rotation).toBe(0);
    expect(clip().volume).toBe(1);
    expect(clip("source").volume).toBe(0.25);
    await useProjectStore.getState().redo();
    expect(clip().volume).toBe(0.25);
    const persisted = localStorage.getItem("openreel-clip-recipes")!;
    useClipRecipesStore.setState({ recipes: [] });
    localStorage.setItem("openreel-clip-recipes", persisted);
    await useClipRecipesStore.persist.rehydrate();
    expect(useClipRecipesStore.getState().recipes).toEqual([saved]);
  });
  it("stops recording at a cut or a different target and caps at six adjustments", async () => {
    for (let index = 0; index < 8; index++)
      await execute("audio/setVolume", {
        clipId: "source",
        volume: (index + 1) / 10,
      });
    expect(
      recentClipRecipeSteps(useProjectStore.getState().actionHistory),
    ).toHaveLength(6);
    await execute("audio/setVolume", { clipId: "target", volume: 0.5 });
    expect(
      recentClipRecipeSteps(useProjectStore.getState().actionHistory),
    ).toHaveLength(1);
    await execute("clip/split", { clipId: "source", time: 5 });
    expect(
      recentClipRecipeSteps(useProjectStore.getState().actionHistory),
    ).toEqual([]);
  });
  it("does not publish partial adjustments when a later step fails validation", async () => {
    const recipe: ClipRecipe = {
      id: "bad",
      name: "Invalid recipe",
      steps: [
        {
          type: "audio/setVolume",
          params: { volume: 0.4 },
          description: "Volume",
        },
        {
          type: "audio/setVolume",
          params: { volume: -1 },
          description: "Invalid volume",
        },
      ],
    };
    await expect(applyClipRecipe(recipe, "target")).rejects.toThrow(/Volume/);
    expect(clip().volume).toBe(1);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
  it("rejects locked tracks and unsupported operations before touching the project", async () => {
    const recipe: ClipRecipe = {
      id: "one",
      name: "Level",
      steps: [
        {
          type: "audio/setVolume",
          params: { volume: 0.2 },
          description: "Volume",
        },
      ],
    };
    const project = useProjectStore.getState().project;
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
    await expect(applyClipRecipe(recipe, "target")).rejects.toThrow(/Unlock/);
    await expect(
      applyClipRecipe(
        {
          ...recipe,
          steps: [{ type: "clip/remove", params: {}, description: "Delete" }],
        },
        "target",
      ),
    ).rejects.toThrow(/unsupported/);
    expect(clip().volume).toBe(1);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});

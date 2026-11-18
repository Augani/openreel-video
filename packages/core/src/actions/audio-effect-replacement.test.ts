import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Action, Effect, Project } from "../types";
function fixture() {
  const original: Effect = {
    id: "noise",
    type: "noiseReduction",
    enabled: false,
    params: { threshold: -40, reduction: 0.5 },
    metadata: { previewBypass: true },
  };
  const project = {
    id: "project",
    name: "Noise",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 2,
      subtitles: [],
      markers: [],
      tracks: [
        {
          id: "track",
          name: "Audio",
          type: "audio",
          hidden: false,
          muted: false,
          solo: false,
          locked: false,
          transitions: [],
          clips: [
            {
              id: "clip",
              mediaId: "source",
              trackId: "track",
              startTime: 0,
              duration: 2,
              inPoint: 0,
              outPoint: 2,
              volume: 1,
              effects: [],
              audioEffects: [
                original,
                {
                  id: "gain",
                  type: "gain",
                  enabled: true,
                  params: { value: 0.5 },
                },
              ],
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
  } satisfies Project;
  return { project, original, executor: new ActionExecutor() };
}
describe("complete audio effect replacement history", () => {
  it("restores absent learned-profile fields, enabled state and preview metadata on Undo", async () => {
    const { project, original, executor } = fixture();
    const next = {
      ...original,
      enabled: true,
      params: {
        threshold: -34,
        reduction: 0.7,
        profile: {
          frequencyBins: [80, 250],
          magnitudes: [0.4, 0.3],
          sampleRate: 48000,
        },
      },
    };
    delete next.metadata;
    const action = {
      id: "replace",
      timestamp: 1,
      type: "audio/replaceEffect",
      params: { clipId: "clip", effectId: "noise", effect: next },
    } as unknown as Action;
    expect((await executor.execute(action, project)).success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].audioEffects[0]).toEqual(next);
    expect((await executor.undo(project)).success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].audioEffects[0]).toEqual(
      original,
    );
    expect(
      project.timeline.tracks[0].clips[0].audioEffects[0].params,
    ).not.toHaveProperty("profile");
    expect((await executor.redo(project)).success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].audioEffects[0]).toEqual(next);
    expect(project.timeline.tracks[0].clips[0].audioEffects[1].id).toBe("gain");
  });
  it("rejects a missing or mismatched effect identity without altering the stack", async () => {
    const { project, original, executor } = fixture();
    for (const effectId of ["missing", "noise"]) {
      const result = await executor.execute(
        {
          id: effectId,
          timestamp: 1,
          type: "audio/replaceEffect",
          params: {
            clipId: "clip",
            effectId,
            effect: { ...original, id: "other" },
          },
        } as unknown as Action,
        project,
      );
      expect(result.success).toBe(false);
    }
    expect(project.timeline.tracks[0].clips[0].audioEffects[0]).toEqual(
      original,
    );
  });
  it("removes fields introduced by an ordinary audio parameter update when it is undone", async () => {
    const { project, original, executor } = fixture();
    expect(
      (
        await executor.execute(
          {
            id: "learn",
            timestamp: 1,
            type: "audio/updateEffect",
            params: {
              clipId: "clip",
              effectId: "noise",
              params: {
                profile: {
                  frequencyBins: [80],
                  magnitudes: [0.4],
                  sampleRate: 48000,
                },
              },
            },
          },
          project,
        )
      ).success,
    ).toBe(true);
    expect((await executor.undo(project)).success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].audioEffects[0]).toEqual(
      original,
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const state = {
    project: { id: "p1" },
    clip: { id: "c1", trackId: "t1", volume: 1, automation: undefined } as Record<string, unknown>,
    editDuringMeasure: false,
    executeAction: vi.fn(async (_action: unknown) => ({ success: true })),
    getClip: (id: string): Record<string, unknown> | undefined => (id === "c1" ? state.clip : undefined),
    tracks: [] as Array<{ id: string; name: string; locked: boolean }>,
    getFullProject: () => ({ id: "p1", timeline: { tracks: state.tracks } }),
  };
  return { state };
});

vi.mock("../stores/project-store", () => ({
  useProjectStore: { getState: () => hoisted.state },
}));
vi.mock("@openreel/core", async () => {
  const actual = await vi.importActual<typeof import("@openreel/core")>("@openreel/core");
  return {
    ...actual,
    getAudioEngine: () => ({}),
    resolveAudibleAudioTarget: (clip: unknown) => clip,
    measureClipLoudness: vi.fn(async () => {
      // The user edits the clip while the offline render is running.
      if (hoisted.state.editDuringMeasure) hoisted.state.clip = { ...hoisted.state.clip, volume: 0.5 };
      return { integrated: -20, truePeak: -6 };
    }),
  };
});

import { normalizeClipLoudness } from "./loudness";

describe("normalizeClipLoudness", () => {
  beforeEach(() => {
    hoisted.state.clip = { id: "c1", trackId: "t1", volume: 1, automation: undefined };
    hoisted.state.editDuringMeasure = false;
    hoisted.state.tracks = [];
    hoisted.state.executeAction.mockClear();
  });

  it("applies exactly one setVolume action for the measured gain", async () => {
    const result = await normalizeClipLoudness("c1", -14);
    expect(result.applied).toBe(true);
    expect(hoisted.state.executeAction).toHaveBeenCalledTimes(1);
    const action = hoisted.state.executeAction.mock.calls[0][0] as {
      type: string;
      params: { volume: number };
    };
    expect(action.type).toBe("audio/setVolume");
    expect(action.params.volume).toBeCloseTo(Math.pow(10, 6 / 20), 6);
  });

  it("refuses to apply a stale measurement when the clip changed while measuring", async () => {
    hoisted.state.editDuringMeasure = true;
    await expect(normalizeClipLoudness("c1", -14)).rejects.toThrow(/changed while/);
    expect(hoisted.state.executeAction).not.toHaveBeenCalled();
  });

  it("says the track is locked instead of failing generically", async () => {
    hoisted.state.tracks = [{ id: "t1", name: "Dialogue", locked: true }];
    await expect(normalizeClipLoudness("c1", -14)).rejects.toThrow(/"Dialogue" is locked/);
    expect(hoisted.state.executeAction).not.toHaveBeenCalled();
  });
});

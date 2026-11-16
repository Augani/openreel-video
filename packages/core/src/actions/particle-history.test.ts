import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import { ActionHistory } from "./action-history";
import { createEffectFromPreset } from "../effects/particle-presets";
import { editSnapshot } from "./handlers/edit-snapshot";
import { createPortableEdit } from "../editing/portable-project";
import type { Project } from "../types/project";
function project(): Project {
  return {
    id: "project",
    name: "Particles",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 24,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: { duration: 0, tracks: [], markers: [], subtitles: [] },
  };
}
describe("saved particle history", () => {
  it("restores independent complete configurations with one Undo and Redo", async () => {
    const p = project(),
      original = createEffectFromPreset(
        "confetti-celebration",
        "one",
        "clip",
        0,
        5,
      )!,
      before = structuredClone(original);
    Object.assign(p, { particleEffects: [original] });
    const history = new ActionHistory();
    history.setAutoGroupWindow(0);
    const executor = new ActionExecutor(history),
      next = {
        ...structuredClone(original),
        config: { ...structuredClone(original.config), gravity: -120 },
      };
    expect(
      (
        await executor.execute(
          {
            type: "particle/setAll",
            id: "change",
            timestamp: 1,
            params: { effects: [next] },
          },
          p,
        )
      ).success,
    ).toBe(true);
    original.config.colors[0] = "#000000";
    next.config.wind.x = 999;
    await executor.undo(p);
    expect(p.particleEffects).toEqual([before]);
    await executor.redo(p);
    expect(p.particleEffects![0].config.gravity).toBe(-120);
    expect(p.particleEffects![0].config.wind.x).toBe(30);
  });
  it("includes particles in atomic snapshots and clears an originally absent collection on Undo", async () => {
    const p = project(),
      before = editSnapshot(p),
      executor = new ActionExecutor();
    const next = {
      ...before,
      particleEffects: [
        createEffectFromPreset("confetti-celebration", "one", "clip", 0, 5)!,
      ],
    };
    await executor.execute(
      {
        type: "project/applyEditSnapshot",
        id: "snapshot",
        timestamp: 1,
        params: { snapshot: next },
      },
      p,
    );
    expect(p.particleEffects).toHaveLength(1);
    await executor.undo(p);
    expect(p.particleEffects).toBeUndefined();
    await executor.redo(p);
    expect(p.particleEffects).toEqual(next.particleEffects);
  });
  it("rejects duplicate/invalid particle actions and prevents lossy portable export", async () => {
    const p = project(),
      e = createEffectFromPreset("confetti-celebration", "one", "clip", 0, 5)!,
      executor = new ActionExecutor();
    expect(
      (
        await executor.execute(
          {
            type: "particle/setAll",
            id: "invalid",
            timestamp: 1,
            params: { effects: [e, e] },
          },
          p,
        )
      ).success,
    ).toBe(false);
    expect(() => createPortableEdit({ ...p, particleEffects: [e] })).toThrow("particleEffects");
  });
});

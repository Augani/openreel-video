import { describe, expect, it } from "vitest";
import type { MulticamActivityMap } from "./automatic-edit";
import { DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS } from "./manifest";
import {
  applyMulticamDirectives,
  planMulticamShots,
} from "./shot-planner";

const manifest = {
  spec: "openreel-multicam/v1" as const,
  fps: 25,
  sync: { method: "audio-crosscorr" as const, reference: "wide" },
  participants: [
    { id: "p1", name: "Alex", audio: "mic1", seat: "left" as const },
    { id: "p2", name: "Jamie", audio: "mic2", seat: "right" as const },
  ],
  cameras: [
    { id: "cam1", type: "closeup" as const, subject: "p1", file: "a.mp4" },
    { id: "cam2", type: "closeup" as const, subject: "p2", file: "b.mp4" },
    { id: "wide", type: "wide" as const, subject: "all", file: "wide.mp4" },
  ],
  constraints: {
    ...DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS,
    reaction_shot_after_ms: 99_000,
  },
};

function activity(entries: Array<{ ids: string[]; scores?: [number, number]; speech?: [number, number] }>): MulticamActivityMap {
  return {
    angleIds: ["mic1", "mic2"],
    duration: entries.length,
    windowMs: 1_000,
    points: entries.map((entry, index) => ({
      startTime: index,
      endTime: index + 1,
      activeAngleIds: entry.ids,
      scores: { mic1: entry.scores?.[0] ?? 1, mic2: entry.scores?.[1] ?? 1 },
      speechProbabilities: {
        mic1: entry.speech?.[0] ?? (entry.ids.includes("mic1") ? 1 : 0),
        mic2: entry.speech?.[1] ?? (entry.ids.includes("mic2") ? 1 : 0),
      },
    })),
  };
}

describe("multicam shot planner", () => {
  it("applies cut lead and breaks overlong shots with a reaction", () => {
    const constrained = {
      ...manifest,
      constraints: {
        ...manifest.constraints,
        min_shot_ms: 1_000,
        max_shot_ms: 3_000,
        reaction_shot_after_ms: 10_000,
        cut_lead_ms: 100,
      },
    };
    const plan = planMulticamShots(
      activity([
        { ids: ["mic1"] },
        { ids: ["mic1"] },
        { ids: ["mic1"] },
        { ids: ["mic1"] },
        { ids: ["mic1"] },
      ]),
      constrained,
    );

    expect(plan.shots[0]?.endMs).toBe(3_000);
    expect(plan.shots[1]).toMatchObject({
      startMs: 3_000,
      endMs: 4_200,
      reason: "max-shot",
      layout: { panels: [{ cameraId: "cam2" }] },
    });
  });

  it("applies bounded camera directives without mutating analysis", () => {
    const plan = planMulticamShots(activity([{ ids: ["mic1"] }, { ids: ["mic1"] }]), manifest);
    const changed = applyMulticamDirectives(plan, manifest, [
      { id: "d1", startMs: 500, endMs: 1_500, cameraId: "cam2" },
    ]);

    expect(changed.shots.some((shot) => shot.reason === "directive")).toBe(true);
    expect(changed.shots.find((shot) => shot.reason === "directive")?.layout.panels[0]?.cameraId).toBe("cam2");
    expect(plan.shots.every((shot) => shot.reason !== "directive")).toBe(true);
  });
});

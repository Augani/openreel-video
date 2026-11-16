import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectSerializer } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { analysisWindows, applyRepairSuggestions, clipRepairEffects, createClipRepairEffect } from "./audio-repair";

const fixture = readFileSync(join(__dirname, "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8");
const serializer = new ProjectSerializer({} as never);

describe("audio repair service", () => {
  it("analyses short clips whole and long clips in three spread windows", () => {
    expect(analysisWindows(12)).toEqual([{ start: 0, duration: 12 }]);
    const windows = analysisWindows(600);
    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.duration === 20 && w.start >= 0 && w.start + w.duration <= 600)).toBe(true);
    expect(windows[0].start).toBeLessThan(windows[1].start);
  });

  it("creates clip effects with sanitised, in-range params", () => {
    const effect = createClipRepairEffect("deHum", { frequency: 999, harmonics: 0.2 });
    expect(effect.type).toBe("deHum");
    expect(effect.enabled).toBe(true);
    expect(effect.params).toMatchObject({ frequency: 70, harmonics: 1, q: 30, depth: 1 });
    expect(createClipRepairEffect("deEss").params.listen).toBe(0);
  });

  it("applies several suggestions as ONE undo step, updating an effect the clip already has", async () => {
    useProjectStore.getState().loadProject(serializer.importFromJson(fixture));
    const store = useProjectStore.getState();
    const clip = store.project.timeline.tracks.find((track) => track.name === "Music")!.clips[0];
    const history = store.actionHistory;
    const steps = () => history.getDisplayHistory().length;
    const before = steps();
    const ids = await applyRepairSuggestions(clip.id, [
      { type: "deClip", params: { threshold: -2, maxRun: 48 }, reason: "test" },
      { type: "deHum", params: { frequency: 60, harmonics: 3 }, reason: "test" },
      { type: "deEss", params: { threshold: -33 }, reason: "test" },
    ]);
    expect(ids).toHaveLength(3);
    expect(steps()).toBe(before + 1);
    const repairs = clipRepairEffects(useProjectStore.getState().getClip(clip.id));
    expect(repairs.map((e) => e.type).sort()).toEqual(["deClick", "deClip", "deEss", "deHum"]);
    // The hum effect was updated in place (same id), the disabled DeEss was re-enabled with the new threshold.
    expect(ids).toContain("fx-hum");
    expect(repairs.find((e) => e.id === "fx-hum")?.params).toMatchObject({ frequency: 60, harmonics: 3 });
    expect(repairs.find((e) => e.id === "fx-ess")).toMatchObject({ enabled: true, params: { threshold: -33 } });
    await useProjectStore.getState().undo();
    const undone = clipRepairEffects(useProjectStore.getState().getClip(clip.id));
    expect(undone.map((e) => e.type).sort()).toEqual(["deClick", "deEss", "deHum"]);
    expect(undone.find((e) => e.id === "fx-hum")?.params).toMatchObject({ frequency: 50, harmonics: 5 });
    expect(undone.find((e) => e.id === "fx-ess")?.enabled).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { applyObjectRemovalToBitmap, clipHasObjectRemoval, removalTimingOf } from "./apply";
import { clearRemovalAnalyses, registerRemovalAnalysis } from "./registry";

const settings = { enabled: true, maskId: "m", analysisKey: "k", dilate: 10, feather: 5 };
const bitmap = { width: 8, height: 8 } as unknown as ImageBitmap;

describe("Remove Object when the footage moved under the analysis", () => {
  const timing = removalTimingOf({ inPoint: 2, speed: 1 });
  const clip = { id: "c", startTime: 0, inPoint: 2, speed: 1, objectRemoval: { ...settings, timing } };

  it("leaves the frame alone in the preview and refuses to export when the head was trimmed", async () => {
    const trimmed = { ...clip, inPoint: 3 };
    expect(await applyObjectRemovalToBitmap(trimmed, bitmap, 0.5)).toBe(bitmap);
    await expect(applyObjectRemovalToBitmap(trimmed, bitmap, 0.5, true)).rejects.toThrow(/Run Remove Object again/);
  });

  it("notices speed, reverse and old projects without a recorded timing", async () => {
    expect(removalTimingOf({ inPoint: 2, speed: 2 })).not.toBe(timing);
    expect(removalTimingOf({ inPoint: 2, reversed: true })).not.toBe(timing);
    expect(removalTimingOf({ inPoint: 2 })).toBe(timing);
    // no timing recorded: falls through to the analysis lookup (missing here), so strict reports the missing analysis instead
    const legacy = { ...clip, objectRemoval: settings };
    await expect(applyObjectRemovalToBitmap(legacy, bitmap, 0, true)).rejects.toThrow(/no analysis/);
  });

  it("does nothing for clips without Remove Object (old projects)", async () => {
    expect(clipHasObjectRemoval(undefined)).toBe(false);
    expect(await applyObjectRemovalToBitmap({ id: "c", startTime: 0 }, bitmap, 0, true)).toBe(bitmap);
  });
});

describe("Remove Object on a duplicated or pasted clip", () => {
  const timing = removalTimingOf({ inPoint: 1 });
  const original = { id: "original", startTime: 0, inPoint: 1, objectRemoval: { ...settings, analysisKey: "shared-key", timing } };
  const copy = { ...original, id: "copy", startTime: 9 };

  it("finds the analysis of the clip it was copied from instead of failing the export", async () => {
    clearRemovalAnalyses();
    registerRemovalAnalysis("original", { key: "shared-key", width: 8, height: 8, fps: 30, frames: [null] });
    await expect(applyObjectRemovalToBitmap(copy, bitmap, 9, true)).resolves.toBe(bitmap);
    clearRemovalAnalyses();
  });

  it("still refuses to export when no analysis of that key exists anywhere", async () => {
    clearRemovalAnalyses();
    registerRemovalAnalysis("original", { key: "another-key", width: 8, height: 8, fps: 30, frames: [null] });
    await expect(applyObjectRemovalToBitmap(copy, bitmap, 9, true)).rejects.toThrow(/no analysis/);
    clearRemovalAnalyses();
  });
});

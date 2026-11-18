import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import { ActionHistory } from "./action-history";
import type { Project } from "../types/project";
import type { Mask } from "../video/mask-engine";
const mask = (): Mask => ({ id: "mask", clipId: "video", type: "drawn", path: { closed: true, points: [{ x: .1, y: .2, handleOut: { x: .2, y: .3 } }, { x: .8, y: .2 }, { x: .5, y: .9 }] }, feathering: 12, expansion: -3, opacity: .42, inverted: true,
  keyframes: [{ id: "key", time: 1, easing: "ease-in-out", path: { closed: true, points: [{ x: .2, y: .2 }, { x: .9, y: .2 }, { x: .5, y: .8 }] } }] });
function project(masks: Mask[]): Project {
  return { id: "project", name: "Masks", createdAt: 0, modifiedAt: 0, settings: { width: 640, height: 360, frameRate: 24, sampleRate: 48000, channels: 2 }, timeline: { duration: 0, tracks: [], markers: [], subtitles: [] }, mediaLibrary: { items: [] }, masks };
}
describe("mask history snapshots", () => {
  it("retains independent paths, Bezier handles and keyframes across Undo and Redo", async () => {
    const original = mask(), before = structuredClone(original), p = project([original]), history = new ActionHistory();
    history.setAutoGroupWindow(0); const executor = new ActionExecutor(history), replacement = { ...mask(), opacity: 0 };
    expect((await executor.execute({ id: "change", type: "mask/setAll", timestamp: 1, params: { masks: [replacement] } }, p)).success).toBe(true);
    original.path.points[0].x = .99; original.keyframes[0].path.points[0].x = .99;
    await executor.undo(p); expect(p.masks).toEqual([before]);
    await executor.redo(p); expect(p.masks).toEqual([replacement]);
  });
});

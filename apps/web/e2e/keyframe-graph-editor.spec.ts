import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipsOf, openEditor, readState, redo, seek, settle, splitIntoThree, undo } from "./helpers";

/**
 * Keyframe graph editor, checked in real Chrome:
 *  - ease presets apply to the selection as one undo step (and clear handles for hold/linear);
 *  - dragging a Bezier handle on the graph persists bezierHandles + easing "bezier" in the clip
 *    data as one undo step, with handle time clamped inside the segment;
 *  - copy on one clip and paste on another lands at the playhead, keeps handles, one undo step;
 *  - overlay toggles and the speed graph are reachable.
 * Preview/export equivalence of the stored handles is covered by the core unit tests
 * (AnimationEngine, KeyframeEngine and evaluateKeyframesAt are asserted to agree).
 */

interface Hook {
  project: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const keyframesOf = (page: Page, clipId: string) =>
  page.evaluate((id) => (E().project.getState().getClip(id).keyframes ?? []) as Array<Record<string, any>>, clipId);
const historyDepth = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

async function setup(page: Page) {
  await openEditor(page);
  await splitIntoThree(page);
  const [first, second] = clipsOf(await readState(page), "Main");
  await page.evaluate(({ id }) => {
    const st = E().project.getState();
    st.updateClipKeyframes(id, [
      { id: "o1", time: 0, property: "opacity", value: 0, easing: "linear" },
      { id: "o2", time: 1, property: "opacity", value: 1, easing: "linear" },
      { id: "r1", time: 0, property: "rotation", value: 0, easing: "linear" },
      { id: "r2", time: 1, property: "rotation", value: 90, easing: "linear" },
    ]);
  }, { id: first.id });
  await clickClip(page, first.id);
  await page.evaluate(() => E().ui.getState().setKeyframeEditorOpen(true));
  const panel = page.getByRole("region", { name: "Keyframe editor" });
  await panel.waitFor({ timeout: 20_000 });
  return { first, second, panel };
}

test.describe("Premiere-parity: keyframe graph editor", () => {
  test("ease presets are single undoable edits", async ({ page }) => {
    const { first, panel } = await setup(page);
    await panel.getByRole("combobox", { name: "Property" }).click();
    await page.getByRole("option", { name: "opacity" }).click();
    await panel.getByRole("button", { name: /^Keyframe at 0.000s/ }).click();
    await panel.getByRole("button", { name: /^Keyframe at 1.000s/ }).click({ modifiers: ["Shift"] });
    const depth = await historyDepth(page);

    await panel.getByRole("button", { name: "Apply Ease in/out" }).click();
    await expect.poll(async () => (await keyframesOf(page, first.id)).find((k) => k.id === "o1")?.easing).toBe("bezier");
    const eased = (await keyframesOf(page, first.id)).find((k) => k.id === "o1")!;
    expect(eased.bezierHandles).toEqual({ in: { x: 0.42, y: 0 }, out: { x: 0.58, y: 1 } });
    expect(await historyDepth(page)).toBe(depth + 1);

    await panel.getByRole("button", { name: "Apply Hold" }).click();
    await expect.poll(async () => (await keyframesOf(page, first.id)).find((k) => k.id === "o1")?.easing).toBe("hold");
    expect((await keyframesOf(page, first.id)).find((k) => k.id === "o1")!.bezierHandles).toBeUndefined();

    await undo(page);
    expect((await keyframesOf(page, first.id)).find((k) => k.id === "o1")!.easing).toBe("bezier");
    await undo(page);
    expect((await keyframesOf(page, first.id)).find((k) => k.id === "o1")!.easing).toBe("linear");
    await redo(page);
    expect((await keyframesOf(page, first.id)).find((k) => k.id === "o1")!.easing).toBe("bezier");
  });

  test("dragging a Bezier handle persists handles as one undo step, clamped in time", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1300 });
    const { first, panel } = await setup(page);
    await panel.getByRole("combobox", { name: "Property" }).click();
    await page.getByRole("option", { name: "opacity" }).click();
    await panel.getByRole("button", { name: /^Keyframe at 0.000s/ }).click();
    await settle(page, 300);
    const canvas = panel.getByLabel("Keyframe value graph");
    await canvas.scrollIntoViewIfNeeded();
    await settle(page, 300);
    const box = (await canvas.boundingBox())!;
    const pad = 40, plotW = box.width - pad * 2, plotH = box.height - pad * 2;
    // Time axis spans 0..clip duration (2s clips); value axis 0..1 padded 10%.
    const duration = clipsOf(await readState(page), "Main")[0].duration;
    const tx = (t: number) => box.x + pad + (t / Math.max(1, duration)) * plotW;
    const vy = (v: number) => box.y + pad + (1 - (v + 0.1) / 1.2) * plotH;
    const depth = await historyDepth(page);

    // Linear outgoing handle sits at (1/3, 1/3) of the 0..1s segment.
    await page.mouse.move(tx(1 / 3), vy(1 / 3));
    await page.mouse.down();
    await page.mouse.move(tx(0.6), vy(0.8), { steps: 8 });
    await page.mouse.move(Math.min(tx(5), 1590), vy(0.8), { steps: 4 }); // well past the next keyframe
    await page.mouse.up();

    await expect.poll(async () => (await keyframesOf(page, first.id)).find((k) => k.id === "o1")?.easing).toBe("bezier");
    const key = (await keyframesOf(page, first.id)).find((k) => k.id === "o1")!;
    expect(key.bezierHandles.in.x).toBe(1);
    expect(key.bezierHandles.in.y).toBeGreaterThan(0.6);
    expect(await historyDepth(page)).toBe(depth + 1);
    await undo(page);
    expect((await keyframesOf(page, first.id)).find((k) => k.id === "o1")!.easing).toBe("linear");
  });

  test("copy on one clip, paste at the playhead on another; overlay and speed views respond", async ({ page }) => {
    const { first, second, panel } = await setup(page);
    await panel.getByRole("combobox", { name: "Property" }).click();
    await page.getByRole("option", { name: "opacity" }).click();
    await panel.getByRole("button", { name: /^Keyframe at 0.000s/ }).click();
    await panel.getByRole("button", { name: "Apply Ease out" }).click();
    await panel.getByRole("button", { name: /^Keyframe at 1.000s/ }).click({ modifiers: ["Shift"] });
    await panel.getByRole("button", { name: "Copy" }).click();

    await panel.getByRole("button", { name: "Show rotation curve" }).click();
    await expect(panel.getByRole("button", { name: "Show rotation curve" })).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "Speed graph" }).click();
    await expect(panel.getByLabel("Keyframe value graph")).toHaveAttribute("data-graph-mode", "speed");
    await panel.getByRole("button", { name: "Value graph" }).click();

    await clickClip(page, second.id);
    await seek(page, second.start + 0.5);
    const depth = await historyDepth(page);
    await panel.getByRole("button", { name: "Paste" }).click();
    await expect.poll(async () => (await keyframesOf(page, second.id)).length).toBe(2);
    const pasted = (await keyframesOf(page, second.id)).sort((a, b) => a.time - b.time);
    expect(pasted.map((k) => k.time)).toEqual([0.5, 1.5]);
    expect(pasted.every((k) => k.property === "opacity")).toBe(true);
    expect(pasted[0].easing).toBe("bezier");
    expect(pasted[0].bezierHandles).toEqual({ in: { x: 0, y: 0 }, out: { x: 0.58, y: 1 } });
    expect(await historyDepth(page)).toBe(depth + 1);
    await undo(page);
    expect(await keyframesOf(page, second.id)).toHaveLength(0);
    // Source clip is untouched by the paste.
    expect(await keyframesOf(page, first.id)).toHaveLength(4);
  });
});

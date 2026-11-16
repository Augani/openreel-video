import { expect, test, type Page } from "@playwright/test";
import { frameAt, graphicState, hideMain, insertFromBrowse } from "./essential-graphics-lib";
import { openEditor, seek, settle, undo } from "./helpers";

/**
 * Linked compositions (Dynamic Link style) in real Chrome: a graphic becomes a live
 * linked composition, is edited in its own window and the timeline updates at once, a
 * control is exposed there and keyframed in the Inspector, the composition is rendered
 * to a clip (Render and Replace) and restored (Restore Unrendered), and every step is
 * one undo.
 */

interface LinkedSnapshot {
  compositions: Array<{ id: string; name: string; revision: number }>;
  instances: Array<{
    id: string;
    linked?: string;
    startTime: number;
    duration: number;
    keys: Record<string, Array<{ time: number; value: number }>>;
    baked: boolean;
  }>;
  history: number;
  members: number;
  bakedClips: number;
  accentOpacityKeys: Array<{ time: number; value: number }>;
}

async function snapshot(page: Page): Promise<LinkedSnapshot> {
  return page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
    const state = e.project.getState();
    const p = state.getFullProject();
    const members = [...(p.textClips ?? []), ...(p.shapeClips ?? []), ...(p.svgClips ?? [])].filter((c: any) => c.metadata?.graphicInstanceId);
    const accent = (p.shapeClips ?? []).find((c: any) => String(c.id).endsWith("__accent"));
    return {
      compositions: (p.linkedCompositions ?? []).map((c: any) => ({ id: c.id, name: c.name, revision: c.revision })),
      instances: (p.graphicInstances ?? []).map((i: any) => ({
        id: i.id,
        linked: i.linkedCompositionId,
        startTime: i.startTime,
        duration: i.duration,
        keys: Object.fromEntries(Object.entries(i.paramKeyframes ?? {}).map(([k, v]: [string, any]) => [k, v.map((x: any) => ({ time: x.time, value: x.value }))])),
        baked: Boolean(i.bake),
      })),
      history: state.actionExecutor.getHistory().getUndoStackSize(),
      members: members.length,
      bakedClips: p.timeline.tracks.flatMap((t: any) => t.clips).filter((c: any) => c.metadata?.linkedCompositionInstanceId).length,
      accentOpacityKeys: (accent?.keyframes ?? []).filter((k: any) => k.property === "opacity").map((k: any) => ({ time: k.time, value: k.value })),
    };
  });
}

test("linked composition: edit in its own window, keyframe a control, render and replace, restore, undo", async ({ page, context }) => {
  test.setTimeout(300_000);
  await openEditor(page);
  await hideMain(page);
  await insertFromBrowse(page, "Classic Bar");
  const start = await snapshot(page);
  const instanceId = start.instances[0].id;
  const bar = page.locator(`[data-clip-kind="graphic"][data-graphic-id="${instanceId}"]`);

  // 1. Replace with Linked Composition from the graphic's context menu: one undo step.
  await bar.click({ button: "right" });
  await page.getByTestId("menu-replace-linked").click();
  await expect.poll(async () => (await snapshot(page)).compositions.length, { timeout: 15_000 }).toBe(1);
  const linked = await snapshot(page);
  expect(linked.history - start.history, "replace is one undo step").toBe(1);
  expect(linked.instances[0].linked).toBe(linked.compositions[0].id);
  await expect(page.locator(`[data-clip-kind="graphic"][data-graphic-id="${instanceId}"][data-linked-composition]`)).toBeVisible();
  await bar.click();
  await expect(page.getByTestId("linked-composition-actions")).toBeVisible();

  // 2. Open it in its own window; an edit there updates the timeline's layers at once, as one undo step.
  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByTestId("open-linked-composition").click()]);
  await popup.waitForSelector('[data-testid="composition-window"][data-status="ready"]', { timeout: 30_000 });
  await expect(popup.getByTestId("composition-name")).toHaveText(linked.compositions[0].name);
  const hide = popup.getByRole("button", { name: /^Hide / }).first();
  await hide.click();
  await expect.poll(async () => (await snapshot(page)).members, { timeout: 15_000 }).toBe(linked.members - 1);
  const afterWindowEdit = await snapshot(page);
  expect(afterWindowEdit.history - linked.history, "a window edit is one undo step").toBe(1);
  expect(afterWindowEdit.compositions[0].revision).toBe(linked.compositions[0].revision + 1);

  // Undo in the editor window brings the layer back, and the composition window follows.
  await page.bringToFront();
  await undo(page);
  await expect.poll(async () => (await snapshot(page)).members, { timeout: 15_000 }).toBe(linked.members);
  await expect(popup.locator('[data-testid="composition-window"]')).toHaveAttribute("data-revision", String(linked.compositions[0].revision));

  // 3. Expose the accent layer's opacity as a control in the window; it appears in the Inspector.
  await popup.locator('[data-graphic-layer="accent"] button[aria-pressed]').click();
  await popup.getByRole("button", { name: "Expose Opacity" }).click();
  await popup.close();
  await page.bringToFront();
  await bar.click();
  const control = page.locator('[data-graphic-control="accent-opacity"]');
  await expect(control).toBeVisible({ timeout: 15_000 });

  // 4. Keyframe it: key at +0.5 s, key at +2 s, then lower the value at the second key.
  await seek(page, linked.instances[0].startTime + 0.5);
  await control.getByRole("button", { name: /keyframe at playhead/ }).click();
  await seek(page, linked.instances[0].startTime + 2);
  await control.getByRole("button", { name: /keyframe at playhead/ }).click();
  await control.getByRole("slider").focus();
  await page.keyboard.press("Home");
  await settle(page, 600);
  await expect.poll(async () => (await snapshot(page)).accentOpacityKeys.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const keyed = await snapshot(page);
  const keys = keyed.instances[0].keys["accent-opacity"];
  expect(keys.map((k) => k.value)).toEqual([1, 0]);
  // The animated value reaches the layer's clip keyframes: opacity 1 at the first key, 0 at the second.
  const accent = keyed.accentOpacityKeys.sort((a, b) => a.time - b.time);
  expect(accent[0].value).toBeCloseTo(1, 6);
  expect(accent[accent.length - 1].value).toBeCloseTo(0, 6);
  const early = await frameAt(page, linked.instances[0].startTime + 0.6);
  const late = await frameAt(page, linked.instances[0].startTime + 2.2);
  expect(early.hash, "the keyframed opacity changes the picture").not.toBe(late.hash);

  // 5. Render and Replace: the live layers become one media clip; Restore Unrendered brings them back.
  const before = await graphicState(page);
  const stepsBeforeRender = (await snapshot(page)).history;
  await bar.click();
  await page.getByTestId("render-and-replace").click();
  await expect.poll(async () => (await snapshot(page)).instances[0].baked, { timeout: 180_000 }).toBe(true);
  const baked = await snapshot(page);
  expect(baked.members).toBe(0);
  expect(baked.bakedClips).toBe(1);
  expect(baked.history - stepsBeforeRender, "render and replace is one undo step").toBe(1);
  await expect(page.getByTestId("linked-baked-inspector")).toBeVisible();

  await page.getByTestId("restore-unrendered").click();
  await expect.poll(async () => (await snapshot(page)).instances[0].baked, { timeout: 15_000 }).toBe(false);
  const restored = await snapshot(page);
  expect(restored.bakedClips).toBe(0);
  expect(restored.members).toBe(keyed.members);
  expect(restored.history - baked.history, "restore is one undo step").toBe(1);
  const after = await graphicState(page);
  expect(after.shapes.map((s) => s.id)).toEqual(before.shapes.map((s) => s.id));

  // 6. Undo walks the render back.
  await undo(page);
  await expect.poll(async () => (await snapshot(page)).instances[0].baked, { timeout: 15_000 }).toBe(true);
  await undo(page);
  await expect.poll(async () => (await snapshot(page)).instances[0].baked, { timeout: 15_000 }).toBe(false);
});

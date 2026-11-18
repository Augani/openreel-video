import { expect, test, type Page } from "@playwright/test";
import {
  boxOf,
  clickClip,
  clipLocator,
  clipsOf,
  diffSnaps,
  drag,
  openEditor,
  readState,
  redo,
  seek,
  settle,
  setZoom,
  shape,
  snap,
  snapStable,
  splitIntoThree,
  undo,
} from "./helpers";

/**
 * Multi-sequence projects: nest two clips, open the nest in its own tab, trim
 * inside, return to the parent and check that the parent's rendered frame and
 * the nested sequence's duration follow; undo restores; autosave + reload
 * persists everything. Real Chrome, real mouse, real canvas pixels.
 */

interface Hook {
  __openreelE2E: { project: { getState(): any } };
}

const seqState = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Hook).__openreelE2E.project.getState().project;
    const nested = (p.compoundClips ?? []).map((c: any) => ({ id: c.id, name: c.name, duration: c.content.duration }));
    return {
      active: p.activeSequenceId as string | undefined,
      open: (p.openSequenceIds ?? []) as string[],
      sequences: (p.sequences ?? []).map((s: any) => ({ id: s.id, name: s.name })),
      nested,
      projectId: p.id as string,
    };
  });

/** Fraction of program-canvas pixels that are (near) black. */
const darkFraction = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 30) dark++;
    return dark / (d.length / 4);
  });

const tabs = (page: Page) => page.getByTestId("sequence-tab");
const activeTabName = (page: Page) => page.locator('[data-testid="sequence-tab"][data-active="true"] [data-testid="sequence-tab-name"]');

async function rightClickClip(page: Page, clipId: string) {
  const box = await clipLocator(page, clipId).boundingBox();
  if (!box) throw new Error("clip not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
}

/** All tracks flattened to [track, start, duration] so nest + sibling clips are easy to read. */
const flat = async (page: Page) =>
  (await readState(page)).tracks.flatMap((t) => t.clips.map((c) => ({ track: t.name, id: c.id, start: c.start, duration: c.duration })));

test.describe("Multi-sequence projects", () => {
  // Real decodes + a full page reload on a shared machine: the default 90s is too tight.
  test.describe.configure({ timeout: 180_000 });

  test("nest two clips, open the nest, trim inside, parent follows, undo/redo restore exactly", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await setZoom(page, 100);
    const start = await readState(page);
    const [one, two, three] = clipsOf(start, "Main");
    expect(shape([one, two, three])).toEqual([[0, 2, 0, 2], [2, 2, 2, 4], [4, 2, 4, 6]]);
    // The three scenes have visibly different frames; snapshot the parent at 1s (scene 1) and 3s (scene 2).
    await seek(page, 1);
    await snapStable(page, "parent-1s-before");
    await seek(page, 3);
    await snapStable(page, "parent-3s-before");

    // ---- (1) Nest the first two clips from the timeline context menu ----
    await clickClip(page, one.id);
    await page.keyboard.down("Shift");
    await clickClip(page, two.id);
    await page.keyboard.up("Shift");
    const historyBeforeNest = (await readState(page)).historyLength;
    await rightClickClip(page, two.id);
    await page.getByTestId("nest-clips").click();
    await settle(page, 900);

    const nested = await seqState(page);
    expect(nested.sequences).toHaveLength(2);
    expect(nested.nested).toHaveLength(1);
    expect(nested.nested[0].duration).toBeCloseTo(4, 3);
    const parentClips = await flat(page);
    expect(parentClips).toHaveLength(2);
    const nestClip = parentClips.find((c) => Math.abs(c.start) < 1e-6)!;
    expect([nestClip.start, nestClip.duration]).toEqual([0, 4]);
    expect(parentClips.find((c) => c.id === three.id)).toBeTruthy();
    expect((await readState(page)).historyLength).toBe(historyBeforeNest + 1); // one undo step
    // Both sequences are in the Project panel; only the parent has a tab.
    await expect(page.getByTestId("sequence-row")).toHaveCount(2);
    await expect(tabs(page)).toHaveCount(1);
    // The nest renders the same pictures as the clips it replaced.
    await seek(page, 1);
    await snapStable(page, "parent-1s-nested");
    await seek(page, 3);
    await snapStable(page, "parent-3s-nested");
    await seek(page, 0.5);
    await snapStable(page, "parent-0_5s-nested");
    await seek(page, 1.5);
    await snapStable(page, "parent-1_5s-nested");
    expect((await diffSnaps(page, "parent-1s-before", "parent-1s-nested")).changed).toBeLessThan(2000);
    expect((await diffSnaps(page, "parent-3s-before", "parent-3s-nested")).changed).toBeLessThan(2000);

    // ---- (2) Double-click the nest: it opens in its own tab ----
    await seek(page, 0);
    const nestBox = await boxOf(page, nestClip.id);
    await page.mouse.dblclick((nestBox.left + nestBox.right) / 2, nestBox.centerY);
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTabName(page)).toHaveText(nested.nested[0].name);
    await expect.poll(async () => (await flat(page)).length).toBe(2);
    const inside = await readState(page);
    const innerClips = inside.tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start);
    expect(shape(innerClips)).toEqual([[0, 2, 0, 2], [2, 2, 2, 4]]);
    expect((await seqState(page)).active).toBe(nested.nested[0].id);

    // ---- (3) Trim inside: first clip's tail -1s (opens a gap), second clip's tail -1s ----
    await setZoom(page, 100);
    const [innerA, innerB] = innerClips;
    const trimTail = async (id: string) => {
      await clickClip(page, id);
      // Grab the handle near the clip's top edge: the transition button sits at mid-height on a cut.
      const box = await clipLocator(page, id).boundingBox();
      if (!box) throw new Error("clip not visible");
      await drag(page, { x: box.x + box.width - 3, y: box.y + 5 }, -100);
    };
    await trimTail(innerA.id); // opens a 1s gap inside the nest
    await trimTail(innerB.id);
    const trimmed = (await readState(page)).tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start);
    expect(shape(trimmed)).toEqual([[0, 1, 0, 1], [2, 1, 2, 3]]);
    // ---- (4) Back to the parent tab ----
    const parentId = (await seqState(page)).sequences.find((s) => s.name === "Sequence 1")!.id;
    await tabs(page).first().click();
    await expect(activeTabName(page)).toHaveText("Sequence 1");
    await expect.poll(async () => (await seqState(page)).nested[0]?.duration).toBeCloseTo(3, 3);
    await seek(page, 1.5);
    await snap(page, "parent-1_5s-after");
    await seek(page, 0.5);
    await snap(page, "parent-0_5s-after");
    const parentAfter = await flat(page);
    expect(parentAfter.find((c) => c.id === nestClip.id)?.duration).toBe(4); // instances keep their own length, like Premiere
    // The gap trimmed inside the nest shows in the parent's frame at 1.5s (scene 1 became black)...
    const gapDiff = await diffSnaps(page, "parent-1_5s-nested", "parent-1_5s-after");
    expect(gapDiff.changed).toBeGreaterThan(gapDiff.total * 0.3);
    // ...while 0.5s, still inside the kept part of scene 1, is untouched.
    expect((await diffSnaps(page, "parent-0_5s-nested", "parent-0_5s-after")).changed).toBeLessThan(2000);

    // ---- (5) Undo restores, step by step, across the tab switch ----
    await undo(page); // the tab switch itself
    expect((await seqState(page)).active).toBe(nested.nested[0].id);
    await undo(page); // trim of the first clip
    await undo(page); // trim of the second clip
    const restoredInside = (await readState(page)).tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start);
    expect(shape(restoredInside)).toEqual([[0, 2, 0, 2], [2, 2, 2, 4]]);
    // Redo replays the same three steps: both trims, then the switch back to the parent.
    await redo(page);
    await redo(page);
    await redo(page);
    expect((await seqState(page)).active).toBe(parentId);
    await expect.poll(async () => (await seqState(page)).nested[0]?.duration).toBeCloseTo(3, 3);
    await undo(page);
    await undo(page);
    await undo(page);
    expect(shape((await readState(page)).tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start))).toEqual([[0, 2, 0, 2], [2, 2, 2, 4]]);
    await tabs(page).first().click();
    await expect.poll(async () => (await seqState(page)).nested[0]?.duration).toBeCloseTo(4, 3);
    await seek(page, 1.5);
    await snap(page, "parent-1_5s-restored");
    expect((await diffSnaps(page, "parent-1_5s-nested", "parent-1_5s-restored")).changed).toBeLessThan(2000);
  });

  test("tabs: new, rename, reorder, close; project panel; cycle block; autosave recovers tabs", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    const [one, two] = clipsOf(await readState(page), "Main");
    await clickClip(page, one.id);
    await page.keyboard.down("Shift");
    await clickClip(page, two.id);
    await page.keyboard.up("Shift");
    await rightClickClip(page, two.id);
    await page.getByTestId("nest-clips").click();
    await settle(page, 700);

    // New sequence from the tab strip's + menu.
    await page.getByTestId("sequence-tab-new").click();
    await page.getByRole("menuitem", { name: "New sequence", exact: true }).click();
    await expect(tabs(page)).toHaveCount(2);
    // The + menu returns focus to its trigger as it closes; under load that restore can land after
    // the rename input has focus and blur-commits it (the rename still applies, but the input is
    // gone before Enter). Let the menu finish closing first.
    await expect(page.getByRole("menu")).toBeHidden();
    await settle(page, 300);
    // Rename by double-click.
    await tabs(page).nth(1).dblclick();
    const renameInput = page.getByTestId("sequence-name-input");
    await expect(renameInput).toBeFocused();
    await renameInput.fill("Alt cut");
    await renameInput.press("Enter");
    await expect(activeTabName(page)).toHaveText("Alt cut");
    // Drag the new tab before the first.
    await tabs(page).nth(1).dragTo(tabs(page).nth(0));
    await expect(tabs(page).first().getByTestId("sequence-tab-name")).toHaveText("Alt cut");
    // Close it: the other tab becomes active, the sequence stays in the panel.
    await tabs(page).first().getByTestId("sequence-tab-close").click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTabName(page)).toHaveText("Sequence 1");
    await expect(page.getByTestId("sequence-row")).toHaveCount(3);

    // Cycle: open the nested sequence from the Project panel, then try to nest the parent into it.
    const nestRow = page.getByTestId("sequence-row").filter({ hasText: "Nested Sequence" });
    await nestRow.dblclick();
    await expect(activeTabName(page)).toContainText("Nested Sequence");
    const historyBefore = (await readState(page)).historyLength;
    const parentId = (await seqState(page)).sequences.find((s) => s.name === "Sequence 1")!.id;
    const verdict = await page.evaluate(async (id) => {
      const w = window as unknown as { __openreelE2E: { project: { getState(): any } } };
      const mod = (w.__openreelE2E as unknown as { sequences: typeof import("../src/services/sequence-commands") }).sequences;
      const r = await mod.placeSequenceOnTimeline(id, undefined, 0);
      return { ok: r.ok, message: r.ok ? "" : r.message, before: w.__openreelE2E.project.getState().project.activeSequenceId };
    }, parentId);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/already contains/);
    expect((await readState(page)).historyLength).toBe(historyBefore);

    // Autosave, reload, recover: everything persists.
    const before = await seqState(page);
    await page.evaluate(() => (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState().forceSave());
    await page.reload();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
    const recovered = await page.evaluate(async (savedProjectId) => {
      const store = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(v: unknown): void } } }).__openreelE2E.project;
      // A reload starts a fresh project; point recovery at the saved project's id.
      store.setState({ project: { ...store.getState().project, id: savedProjectId } });
      const saves = await store.getState().checkForRecovery();
      if (!saves.length) return null;
      const ok = await store.getState().recoverFromAutoSave(saves[0].id);
      const p = store.getState().project;
      return {
        ok,
        active: p.activeSequenceId,
        open: p.openSequenceIds,
        sequences: p.sequences.map((s: any) => s.name),
        nestedDuration: (p.compoundClips ?? []).map((c: any) => c.content.duration),
      };
    }, before.projectId);
    expect(recovered, "autosave must be recoverable after reload").not.toBeNull();
    expect(recovered!.ok).toBe(true);
    expect(recovered!.active).toBe(before.active);
    expect(recovered!.open).toEqual(before.open);
    expect(recovered!.sequences.sort()).toEqual(before.sequences.map((s) => s.name).sort());
    expect(recovered!.nestedDuration.length).toBeGreaterThan(0);
  });

  test("reload: a trimmed nest, its tabs and its parent render persist through autosave", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await setZoom(page, 100);
    const [one, two] = clipsOf(await readState(page), "Main");
    await clickClip(page, one.id);
    await page.keyboard.down("Shift");
    await clickClip(page, two.id);
    await page.keyboard.up("Shift");
    await rightClickClip(page, two.id);
    await page.getByTestId("nest-clips").click();
    await settle(page, 700);
    const nestClipId = (await flat(page)).find((c) => c.start === 0)!.id;
    await seek(page, 1.5);
    await snap(page, "before");
    expect(await darkFraction(page)).toBeLessThan(0.6);
    // Open the nest and open a gap inside it by trimming the first clip's tail.
    const nestBox = await boxOf(page, nestClipId);
    await page.mouse.dblclick((nestBox.left + nestBox.right) / 2, nestBox.centerY);
    await expect(tabs(page)).toHaveCount(2);
    await expect.poll(async () => (await flat(page)).length).toBe(2);
    await setZoom(page, 100);
    const [innerA] = (await readState(page)).tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start);
    await clickClip(page, innerA.id);
    const box = await clipLocator(page, innerA.id).boundingBox();
    if (!box) throw new Error("clip not visible");
    await drag(page, { x: box.x + box.width - 3, y: box.y + 5 }, -100);
    await tabs(page).first().click();
    await seek(page, 1.5);
    await snap(page, "trimmed");
    expect((await diffSnaps(page, "before", "trimmed")).changed).toBeGreaterThan(50_000);
    expect(await darkFraction(page)).toBeGreaterThan(0.95); // the gap inside the nest is black
    const saved = await seqState(page);
    expect(saved.sequences).toHaveLength(2);

    await page.evaluate(() => (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState().forceSave());
    await page.reload();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
    const recovered = await page.evaluate(async (savedProjectId) => {
      const store = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(v: unknown): void } } }).__openreelE2E.project;
      store.setState({ project: { ...store.getState().project, id: savedProjectId } });
      const saves = await store.getState().checkForRecovery();
      return saves.length ? await store.getState().recoverFromAutoSave(saves[0].id) : null;
    }, saved.projectId);
    expect(recovered, "autosave must be recoverable after reload").toBe(true);
    const after = await seqState(page);
    expect(after.active).toBe(saved.active);
    expect(after.open).toEqual(saved.open);
    expect(after.sequences).toEqual(saved.sequences);
    expect(after.nested[0].duration).toBeCloseTo(saved.nested[0].duration, 3);
    await expect(tabs(page)).toHaveCount(2);
    // Same media, same trim: the recovered parent renders the same gap.
    await seek(page, 1.5);
    await settle(page, 1500);
    expect(await darkFraction(page)).toBeGreaterThan(0.95); // the recovered parent renders the same gap
    await seek(page, 0.5);
    await settle(page, 800);
    expect(await darkFraction(page)).toBeLessThan(0.6); // and the kept part of scene 1 still shows
    // And the nest still opens with its trimmed content.
    await page.keyboard.press("Escape"); // the welcome / recovery dialog a fresh page load shows
    await page.keyboard.press("Escape");
    await tabs(page).nth(1).click();
    const innerAfter = (await readState(page)).tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start);
    expect(shape(innerAfter)[0]).toEqual([0, 1, 0, 1]);
  });
});

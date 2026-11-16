import { expect, test, type Page } from "@playwright/test";
import { boxOf, clipsOf, diffSnaps, openEditor, readState, seek, settle, snap, snapStable, undo } from "./helpers";

/**
 * Wave 7 composition, in real Chrome on real canvas pixels: an HSL secondary, a breadth-batch
 * effect and a drawn pen mask on a clip render the SAME picture before and after the clip is
 * nested (the nest renders the clip through the same pipeline, with the project's masks), and the
 * nest edit is one undo step that restores the exact pre-nest picture.
 */

interface Hook {
  __openreelE2E: { project: { getState(): any }; ui: { getState(): any } };
}

const TIMES = [1, 3, 5];

async function toleranceDiff(page: Page, a: string, b: string, tol: number): Promise<{ changed: number; max: number; total: number }> {
  return page.evaluate(
    ([x, y, t]) => {
      const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
      const p = s[x as string];
      const q = s[y as string];
      let changed = 0;
      let max = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
        if (d > max) max = d;
        if (d > (t as number)) changed++;
      }
      return { changed, max, total: p.length / 4 };
    },
    [a, b, tol],
  );
}

test("secondary + new effect + pen mask render identically before and after nesting, and undo restores them", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");

  // Plain frames first, so the decoration is provably visible.
  for (const t of TIMES) {
    await seek(page, t);
    await snapStable(page, `plain-${t}`);
  }

  // A secondary keyed on green (desaturate inside), a breadth-batch effect, and a drawn pen mask.
  await page.evaluate(
    async ([id]) => {
      const store = (window as unknown as Hook).__openreelE2E.project.getState();
      const sec = await store.addVideoEffect(id, "hsl-secondary", {
        hueMin: 100, hueMax: 140, hueSoft: 5, satMin: 40, satMax: 100, lumMin: 10, lumMax: 90, saturation: -100,
      });
      if (!sec) throw new Error("secondary not added");
      const lv = await (window as unknown as Hook).__openreelE2E.project.getState().addVideoEffect(id, "solarize", {});
      if (!lv) throw new Error("solarize not added");
      const outcome = await (window as unknown as Hook).__openreelE2E.project.getState().executeAction({
        type: "mask/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: {
          masks: [{
            id: "pen-1", clipId: id, type: "drawn", feathering: 0, inverted: false, expansion: 0, opacity: 1, keyframes: [],
            path: { closed: true, points: [{ x: 0.15, y: 0.15 }, { x: 0.85, y: 0.15 }, { x: 0.85, y: 0.85 }, { x: 0.15, y: 0.85 }] },
          }],
        },
      });
      if (!outcome.success) throw new Error(outcome.error?.message ?? "mask failed");
    },
    [clip.id],
  );
  await settle(page, 900);
  for (const t of TIMES) {
    await seek(page, t);
    await snapStable(page, `before-${t}`);
    expect((await diffSnaps(page, `plain-${t}`, `before-${t}`)).changed, `decoration visible at ${t}`).toBeGreaterThan(1000);
  }

  // Nest the decorated clip (right-click menu, the real UI path).
  await page.evaluate((id) => (window as unknown as Hook).__openreelE2E.ui.getState().selectMultiple([{ type: "clip", id }]), clip.id);
  const history = (await readState(page)).historyLength;
  const box = await boxOf(page, clip.id);
  await page.mouse.click(box.left + 20, box.centerY, { button: "right" });
  await page.getByTestId("nest-clips").click();
  await settle(page, 1400);
  expect((await readState(page)).historyLength).toBe(history + 1);
  const sequences = await page.evaluate(() => (window as unknown as Hook).__openreelE2E.project.getState().getFullProject().sequences.length);
  expect(sequences).toBe(2);

  const rows: Record<string, unknown> = {};
  for (const t of TIMES) {
    await seek(page, t);
    await snapStable(page, `after-${t}`);
    const tol = await toleranceDiff(page, `before-${t}`, `after-${t}`, 16);
    rows[`t=${t}`] = { over16: tol.changed, maxDelta: tol.max, total: tol.total };
    // The effect stack and the pen mask must survive the nest: the picture is the decorated one, not the plain one.
    expect((await diffSnaps(page, `plain-${t}`, `after-${t}`)).changed, `still decorated at ${t}`).toBeGreaterThan(1000);
    expect(tol.changed, `nest differs from the clip at t=${t}`).toBeLessThanOrEqual(25);
  }
  console.log("[w7-composition] nest vs plain-clip pixel diff:", JSON.stringify(rows));

  // One undo step: the nest sequence is gone and the picture is byte-identical to before.
  await undo(page);
  await settle(page, 900);
  for (const t of TIMES) {
    await seek(page, t);
    await snapStable(page, `undone-${t}`);
    expect((await diffSnaps(page, `before-${t}`, `undone-${t}`)).changed, `undo t=${t}`).toBe(0);
  }
});

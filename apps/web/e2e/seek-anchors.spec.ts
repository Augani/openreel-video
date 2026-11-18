import { expect, test, type Page } from "@playwright/test";
import { openEditor, seek, settle } from "./helpers";

const PROGRAM = 'canvas[aria-label^="Program frame"]';

/** Average RGB of the central 20% of the program canvas. */
async function centerColor(page: Page): Promise<[number, number, number]> {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const w = Math.floor(c.width * 0.2);
    const h = Math.floor(c.height * 0.2);
    const d = g.getImageData(Math.floor((c.width - w) / 2), Math.floor((c.height - h) / 2), w, h).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [r / n, gr / n, b / n];
  }, PROGRAM);
}

const frameHash = (page: Page) =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = 48;
    t.height = 27;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0, 48, 27);
    const d = g.getImageData(0, 0, 48, 27).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    return h;
  }, PROGRAM);

test.describe("Seek anchors: instant seek, exact final frame", () => {
  test("the background anchor pass completes, and seeks always settle on the exact frame", async ({ page }) => {
    await openEditor(page);

    await expect
      .poll(
        () => page.evaluate(() => performance.getEntriesByName("openreel:seek-anchors:done").length),
        { timeout: 20_000, message: "seek anchor sampling never completed" },
      )
      .toBeGreaterThan(0);

    // Scene 2 (2-4 s) is solid red.
    await seek(page, 3);
    await settle(page, 600);
    const [r, g, b] = await centerColor(page);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);

    // Jump away and back several times; the settled frame must always be the exact one
    // and must not change again after it settles (no late approximation overwrite).
    for (const t of [5, 1, 3, 5, 3]) {
      await seek(page, t);
      await settle(page, 500);
      const settled = await frameHash(page);
      await settle(page, 600);
      expect(await frameHash(page)).toBe(settled);
      const [cr, cg] = await centerColor(page);
      if (t === 3) {
        expect(cr).toBeGreaterThan(200);
        expect(cg).toBeLessThan(60);
      } else {
        expect(cg > 60 || cr < 200).toBe(true);
      }
    }
  });
});

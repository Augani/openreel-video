import { expect, type Page } from "@playwright/test";
import { clickClip, clipsOf, openEditor, press, readState, seek, settle, snap } from "./helpers";

/** SMPTE bars scene of the shared fixture (4s..6s): seven flat vertical bars over the top two thirds. */
export const BARS_TIME = 5;
/** Horizontal centre of the green bar (4th of 7) and a y inside the bar band, as frame fractions. */
export const GREEN_BAR = { x: 3.5 / 7, y: 0.3 };

interface E2EStores {
  project: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
  colorMonitor: { getState(): Record<string, any> };
}

export async function openBarsClip(page: Page): Promise<string> {
  await openEditor(page);
  await seek(page, BARS_TIME);
  const [clip] = clipsOf(await readState(page), "Main");
  await clickClip(page, clip.id);
  await page.getByRole("tab", { name: "Color", exact: true }).click();
  await settle(page, 400);
  await page.getByRole("button", { name: /HSL Secondary/ }).first().click();
  await settle(page, 300);
  return clip.id;
}

export async function addSecondaryViaUi(page: Page): Promise<void> {
  const before = (await secondaries(page, "")).length;
  await page.getByRole("button", { name: "Add secondary" }).click();
  await expect.poll(async () => (await secondaries(page, "")).length).toBe(before + 1);
  await settle(page, 400);
}

export interface SecondaryInfo {
  id: string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export async function secondaries(page: Page, _clipId: string): Promise<SecondaryInfo[]> {
  return page.evaluate(() => {
    const project = (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project.getState().project;
    const out: SecondaryInfo[] = [];
    for (const track of project.timeline.tracks)
      for (const clip of track.clips)
        for (const effect of clip.effects ?? [])
          if (effect.type === "hsl-secondary")
            out.push({ id: effect.id, enabled: effect.enabled !== false, params: { ...effect.params } });
    return out;
  });
}

export async function updateSecondary(
  page: Page,
  clipId: string,
  effectId: string,
  params: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    async ([c, e, p]) => {
      await (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project.getState().updateVideoEffect(c as string, e as string, p as Record<string, unknown>);
    },
    [clipId, effectId, params] as const,
  );
  await settle(page, 700);
}

const PROGRAM = 'canvas[aria-label^="Program frame"]';

/** Click a point of the Program frame given as fractions of its on-screen box. */
export async function clickProgram(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator(PROGRAM).boundingBox();
  if (!box) throw new Error("no Program canvas box");
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

export async function pickWithEyedropper(
  page: Page,
  index: number,
  mode: "" | " add" | " subtract",
  at: { x: number; y: number },
): Promise<void> {
  await page.getByRole("button", { name: `Eyedropper${mode} ${index}`, exact: true }).click();
  await page.getByTestId("secondary-eyedropper-layer").waitFor();
  // The Program monitor re-renders the secondary's input (no correction) while armed.
  await settle(page, 900);
  await clickProgram(page, at.x, at.y);
  await expect(page.getByTestId("secondary-eyedropper-layer")).toHaveCount(0);
  await settle(page, 700);
}

export async function setMatteView(page: Page, view: "Off" | "Color" | "Gray" | "B/W", index = 1): Promise<void> {
  await page.getByRole("button", { name: `Show mask ${view} ${index}`, exact: true }).click();
  await settle(page, 900);
}

/** Fraction of Program pixels whose red channel is bright (the B/W matte view paints white where keyed). */
export async function whiteFraction(page: Page, key: string): Promise<number> {
  return page.evaluate((k) => {
    const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k];
    let white = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 127) white++;
    return white / (d.length / 4);
  }, key);
}

/**
 * Pixel checks between a base frame, a matte frame (B/W) and a graded frame:
 *  - inside: matte white; the graded pixel must have (almost) no chroma
 *  - outside: matte black with every pixel within 4px also black; graded must equal base
 */
export async function insideOutside(
  page: Page,
  keys: { base: string; matte: string; graded: string },
): Promise<{ insideCount: number; insideChromatic: number; outsideCount: number; outsideChanged: number }> {
  return page.evaluate(
    ({ base, matte, graded }) => {
      const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const w = c.width;
      const h = c.height;
      const m = s[matte];
      const b = s[base];
      const g = s[graded];
      const white = (x: number, y: number) => m[(y * w + x) * 4] > 127;
      let insideCount = 0;
      let insideChromatic = 0;
      let outsideCount = 0;
      let outsideChanged = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (white(x, y)) {
            // interior only: all 4-neighbours inside too (edges carry the soft matte)
            let interior = true;
            for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h || !white(nx, ny)) interior = false;
            }
            if (!interior) continue;
            insideCount++;
            if (Math.max(g[i], g[i + 1], g[i + 2]) - Math.min(g[i], g[i + 1], g[i + 2]) > 3) insideChromatic++;
          } else {
            let exterior = true;
            for (let dy = -4; dy <= 4 && exterior; dy += 2)
              for (let dx = -4; dx <= 4; dx += 2) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                if (white(nx, ny)) {
                  exterior = false;
                  break;
                }
              }
            if (!exterior) continue;
            outsideCount++;
            if (
              Math.abs(g[i] - b[i]) > 1 ||
              Math.abs(g[i + 1] - b[i + 1]) > 1 ||
              Math.abs(g[i + 2] - b[i + 2]) > 1
            )
              outsideChanged++;
          }
        }
      }
      return { insideCount, insideChromatic, outsideCount, outsideChanged };
    },
    keys,
  );
}

/**
 * Independent expectation for the matte coverage: how much of `base` falls in
 * the picked hue / saturation / luma ranges (hard thresholds, no softness).
 */
export async function expectedCoverage(
  page: Page,
  baseKey: string,
  q: { hueMin: number; hueMax: number; satMin: number; satMax: number; lumMin: number; lumMax: number },
): Promise<number> {
  return page.evaluate(
    ({ key, q }) => {
      const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[key];
      let hit = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255;
        const g = d[i + 1] / 255;
        const b = d[i + 2] / 255;
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const l = (mx + mn) / 2;
        const dd = mx - mn;
        let s = 0;
        let h = 0;
        if (dd > 0) {
          s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
          if (mx === r) h = (((g - b) / dd) % 6 + 6) % 6;
          else if (mx === g) h = (b - r) / dd + 2;
          else h = (r - g) / dd + 4;
          h *= 60;
        }
        const inHue = q.hueMin <= q.hueMax ? h >= q.hueMin && h <= q.hueMax : h >= q.hueMin || h <= q.hueMax;
        if (inHue && s * 100 >= q.satMin && s * 100 <= q.satMax && l * 100 >= q.lumMin && l * 100 <= q.lumMax) hit++;
      }
      return hit / (d.length / 4);
    },
    { key: baseKey, q },
  );
}

/** Mean RGB chroma (max - min) of a snap inside a fractional rect. */
export async function meanChroma(
  page: Page,
  key: string,
  rect: { x0: number; y0: number; x1: number; y1: number },
): Promise<number> {
  return page.evaluate(
    ({ k, r }) => {
      const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k];
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const w = c.width;
      const h = c.height;
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(r.y0 * h); y < Math.floor(r.y1 * h); y++)
        for (let x = Math.floor(r.x0 * w); x < Math.floor(r.x1 * w); x++) {
          const i = (y * w + x) * 4;
          sum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
          n++;
        }
      return sum / n;
    },
    { k: key, r: rect },
  );
}

/** Snapshot of the comparison overlay canvas into the shared snap store. */
export async function snapOverlay(page: Page, key: string): Promise<{ width: number; height: number }> {
  return page.evaluate((k) => {
    const c = document.querySelector('canvas[aria-label="Comparison view"]') as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const w = window as unknown as { __snaps?: Record<string, Uint8ClampedArray> };
    (w.__snaps ??= {})[k] = g.getImageData(0, 0, t.width, t.height).data;
    return { width: t.width, height: t.height };
  }, key);
}

/** Mean chroma of a region of a snap of the given pixel size (for overlay snaps). */
export async function chromaOfSnap(
  page: Page,
  key: string,
  size: { width: number; height: number },
  rect: { x0: number; y0: number; x1: number; y1: number },
): Promise<number> {
  return page.evaluate(
    ({ k, size, r }) => {
      const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k];
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(r.y0 * size.height); y < Math.floor(r.y1 * size.height); y++)
        for (let x = Math.floor(r.x0 * size.width); x < Math.floor(r.x1 * size.width); x++) {
          const i = (y * size.width + x) * 4;
          sum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
          n++;
        }
      return sum / n;
    },
    { k: key, size, r: rect },
  );
}

export interface PickFlowResult {
  clipId: string;
  effectId: string;
  qualifier: { hueMin: number; hueMax: number; satMin: number; satMax: number; lumMin: number; lumMax: number };
  coverage: number;
  expected: number;
  io: { insideCount: number; insideChromatic: number; outsideCount: number; outsideChanged: number };
  undoResidual: number;
  gradedVsUngraded: number;
  historyDeltaForMatteToggles: number;
  historyDeltaForGrade: number;
  paramsHaveMatteView: boolean;
  small: number[];
}

const SMALL = { w: 160, h: 90 };

/**
 * The full secondary flow used by the GPU and fallback specs: add through the
 * UI, key the green bar with the eyedropper, read the matte, desaturate
 * through the matte, undo.
 */
export async function runPickFlow(page: Page): Promise<PickFlowResult> {
  const clipId = await openBarsClip(page);
  await snap(page, "base");
  await addSecondaryViaUi(page);
  const [sec] = await secondaries(page, clipId);
  await pickWithEyedropper(page, 1, "", GREEN_BAR);
  const picked = (await secondaries(page, clipId))[0];
  const p = picked.params as Record<string, number>;
  const qualifier = {
    hueMin: p.hueMin,
    hueMax: p.hueMax,
    satMin: p.satMin,
    satMax: p.satMax,
    lumMin: p.lumMin,
    lumMax: p.lumMax,
  };

  const historyBeforeToggle = (await readState(page)).historyLength;
  await setMatteView(page, "B/W");
  await snap(page, "matte");
  const coverage = await whiteFraction(page, "matte");
  await setMatteView(page, "Gray");
  await setMatteView(page, "Color");
  await setMatteView(page, "Off");
  const historyDeltaForMatteToggles = (await readState(page)).historyLength - historyBeforeToggle;
  await snap(page, "ungraded");
  const expected = await expectedCoverage(page, "base", qualifier);

  const historyBeforeGrade = (await readState(page)).historyLength;
  await updateSecondary(page, clipId, sec.id, { saturation: -100 });
  const historyDeltaForGrade = (await readState(page)).historyLength - historyBeforeGrade;
  await snap(page, "graded");
  const io = await insideOutside(page, { base: "ungraded", matte: "matte", graded: "graded" });
  const small = await page.evaluate(
    ([sel, w, h]) => {
      const c = document.querySelector(sel as string) as HTMLCanvasElement;
      const t = document.createElement("canvas");
      t.width = w as number;
      t.height = h as number;
      const g = t.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(c, 0, 0, t.width, t.height);
      return Array.from(g.getImageData(0, 0, t.width, t.height).data).filter((_, i) => i % 4 !== 3);
    },
    [PROGRAM, SMALL.w, SMALL.h] as const,
  );

  await press(page, "Meta+z");
  await settle(page, 700);
  await snap(page, "undone");
  const residual = await page.evaluate(() => {
    const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
    const a = s.ungraded;
    const b = s.undone;
    let changed = 0;
    for (let i = 0; i < a.length; i += 4)
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++;
    return changed;
  });
  const gradedVsUngraded = await page.evaluate(() => {
    const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
    const a = s.ungraded;
    const b = s.graded;
    let changed = 0;
    for (let i = 0; i < a.length; i += 4)
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) changed++;
    return changed / (a.length / 4);
  });
  const stored = (await secondaries(page, clipId))[0];
  return {
    clipId,
    effectId: sec.id,
    qualifier,
    coverage,
    expected,
    io,
    undoResidual: residual,
    gradedVsUngraded,
    historyDeltaForMatteToggles,
    historyDeltaForGrade,
    paramsHaveMatteView: "matteView" in stored.params,
    small,
  };
}

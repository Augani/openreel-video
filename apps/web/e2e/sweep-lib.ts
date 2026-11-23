import { expect, type Page } from "@playwright/test";
import {
  clickClip,
  clipsOf,
  diffSnaps,
  focusEditor,
  openEditor,
  readState,
  seek,
  settle,
  snapStable,
  undo,
  waitForPresentedPlayhead,
} from "./helpers";

/** Stabilize opens the inspector's analysis flow instead of adding a pixel effect. */
export const NON_PIXEL = new Set(["Stabilize"]);
export const CARD_SUFFIX = ". Drag onto a clip to apply, or double-click to apply to selected clip.";
/** testsrc2 (detailed, saturated), then smptebars (grey / low-saturation bars). */
export const FRAMES = [0.5, 5];
/** Wave 7 effects batch: each is an Effects-browser card and must pass every sweep.
 */
export const W7_LABELS = [
  "Camera Blur", "Channel Blur", "Tilt-Shift Blur", "Luma Key", "Color Key", "Alpha Adjust",
  "Leave Color", "Change to Color", "Solarize", "Levels", "Channel Mixer", "Tint (Map Black/White)",
  "Spherize", "Twirl", "Wave Ripple", "Turbulent Displace", "Offset", "Corner Pin", "Polar Coordinates",
  "Replicate", "Color Emboss", "Noise", "Bevel Alpha", "4-Color Gradient", "Lens Flare", "Strobe Light", "Grid",
];

export const SMALL = { w: 320, h: 180 };

/**
 * An effect whose defaults are neutral (Premiere adds VR Rotate Sphere at 0 / 0 / 0, for example) changes nothing when
 * it is added from its card, so a sweep that asks "does the card visibly change the canvas" has to give it a value
 * first. When the effect just added to the clip is neutral under its own parameters, set every parameter of its spec
 * to a clearly non-neutral value in one undoable update (`proEffectActingParams`: numbers move a fraction of their range
 * away from neutral, toggles flip, selects take the first other option). Returns the number of extra history steps it added (0 or 1).
 * General on purpose: it reads the effect's parameter spec, nothing is special-cased per effect.
 */
export async function makeAddedEffectNonNeutral(page: Page, clipId: string): Promise<number> {
  const added = await page.evaluate(async (id) => {
    const hook = (window as unknown as { __openreelE2E: any }).__openreelE2E;
    const { proEffectActingParams, isProEffectNeutral, PRO_EFFECT_SPECS } = hook.core.proEffects;
    const clip = hook.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    const fx = clip?.effects?.[clip.effects.length - 1];
    if (!fx || !PRO_EFFECT_SPECS[fx.type] || !isProEffectNeutral(fx.type, fx.params ?? {})) return false;
    const params = proEffectActingParams(fx.type);
    await hook.project.getState().updateVideoEffect(id, fx.id, params);
    return true;
  }, clipId);
  if (added) await settle(page, 600);
  return added ? 1 : 0;
}

export interface SweepRow {
  label: string;
  ok: boolean;
  note: string;
  changed: number;
  total: number;
  residual: number;
  effectsAfterUndo: number;
  historyDelta: number;
  frame: number;
  /** RGB (no alpha) of the post-effect program canvas, downsampled to SMALL. */
  small: number[];
  /** Same, before the effect was applied (isolates renderer differences from effect differences). */
  baseSmall: number[];
}

/** Downsample a stored full-size snapshot to SMALL and return RGB. */
async function smallOf(page: Page, key: string): Promise<number[]> {
  return page.evaluate(
    ([k, w, h]) => {
      const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k as string];
      const pc = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const full = document.createElement("canvas");
      full.width = pc.width;
      full.height = pc.height;
      const fg = full.getContext("2d")!;
      fg.putImageData(new ImageData(new Uint8ClampedArray(s), pc.width, pc.height), 0, 0);
      const t = document.createElement("canvas");
      t.width = w as number;
      t.height = h as number;
      const g = t.getContext("2d", { willReadFrequently: true })!;
      g.imageSmoothingQuality = "high";
      g.drawImage(full, 0, 0, w as number, h as number);
      const d = g.getImageData(0, 0, w as number, h as number).data;
      const out: number[] = [];
      for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
      return out;
    },
    [key, SMALL.w, SMALL.h],
  );
}

export async function listEffectLabels(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await settle(page, 800);
  return page.evaluate((suffix) => {
    return [...document.querySelectorAll(`button[aria-label$="${suffix}"]`)].map((e) =>
      (e.getAttribute("aria-label") as string).slice(0, -suffix.length),
    );
  }, CARD_SUFFIX);
}

/** Apply one card, record how the program canvas changed, undo, record residual. */
export async function sweepOne(page: Page, clipId: string, label: string): Promise<SweepRow> {
  let row: SweepRow | null = null;
  for (const frame of FRAMES) {
    await seek(page, frame);
    await clickClip(page, clipId);
    const pre = await readState(page);
    await snapStable(page, "before");
    const baseSmall = await smallOf(page, "before");
    const card = page.locator(`button[aria-label="${label}${CARD_SUFFIX}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.dblclick();
    // Applying is async (applyEditorEffectToClip is awaited by the card handler)
    // so wait for the action to land in history instead of a fixed sleep: on a
    // loaded machine 1.2s was not always enough, and the undo below would then
    // pop the media import instead of the effect ("no clip after undo").
    const applyDeadline = Date.now() + 20_000;
    while ((await readState(page)).historyLength <= pre.historyLength && Date.now() < applyDeadline) {
      await settle(page, 100);
    }
    await settle(page, 1200);
    const extraSteps = await makeAddedEffectNonNeutral(page, clipId);
    const after = await readState(page);
    if (after.historyLength <= pre.historyLength) {
      throw new Error(
        `"${label}" (frame ${frame}s): double-click did not apply the effect within 20s (history ${pre.historyLength} -> ${after.historyLength}, selected ${JSON.stringify(after.selected)})`,
      );
    }
    // Wait for the effect to be on the clip and the monitor to present it before capturing (a loaded machine lands both late).
    await expect.poll(async () => clipsOf(await readState(page), "Main")[0].effects, { timeout: 15_000 }).toBeGreaterThan(0).catch(() => undefined);
    await waitForPresentedPlayhead(page);
    const applied = clipsOf(after, "Main")[0].effects;
    await snapStable(page, "after");
    const changed = await diffSnaps(page, "before", "after");
    const small = await smallOf(page, "after");
    for (let i = 0; i <= extraSteps; i++) await undo(page);
    await settle(page, 600);
    await expect.poll(async () => clipsOf(await readState(page), "Main")[0]?.effects, { timeout: 15_000 }).toBe(0).catch(() => undefined);
    await snapStable(page, "undone");
    const residual = await diffSnaps(page, "before", "undone");
    const afterUndo = clipsOf(await readState(page), "Main");
    if (afterUndo.length === 0) {
      throw new Error(`"${label}" (frame ${frame}s): Main track has no clip after undo (history ${pre.historyLength} -> ${after.historyLength})`);
    }
    const restored = afterUndo[0].effects;
    const historyDelta = after.historyLength - pre.historyLength - extraSteps;
    const ok = historyDelta === 1 && changed.changed > 0 && residual.changed === 0 && restored === 0;
    row = {
      label,
      ok,
      note: `frame@${frame}s effects=${applied} changed=${changed.changed}/${changed.total} undoResidual=${residual.changed} effectsAfterUndo=${restored} historyDelta=${historyDelta}`,
      changed: changed.changed,
      total: changed.total,
      residual: residual.changed,
      effectsAfterUndo: restored,
      historyDelta,
      frame,
      small,
      baseSmall,
    };
    if (ok) break;
    if (residual.changed !== 0 || restored !== 0) break;
  }
  await focusEditor(page);
  return row as SweepRow;
}

export async function prepareSweep(page: Page): Promise<{ clipId: string; labels: string[] }> {
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  await clickClip(page, clip.id);
  // OPENREEL_E2E_ONLY="Glow,Vignette" narrows the sweep while iterating.
  const only = process.env.OPENREEL_E2E_ONLY?.split(",").map((x) => x.trim()).filter(Boolean);
  const labels = (await listEffectLabels(page)).filter(
    (l) => !NON_PIXEL.has(l) && (!only || only.includes(l)),
  );
  return { clipId: clip.id, labels };
}

/** Mean absolute RGB difference (0-255) between two same-size RGB arrays. */
export function meanAbsDiff(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("size mismatch");
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

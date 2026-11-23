import { expect, test } from "@playwright/test";
import { W7_LABELS, makeAddedEffectNonNeutral } from "./sweep-lib";
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
  waitForPresentedPlayhead,
  undo,
} from "./helpers";

// Stabilize opens the inspector's analysis flow instead of adding a pixel effect.
const NON_PIXEL = new Set(["Stabilize"]);
const CARD_SUFFIX = ". Drag onto a clip to apply, or double-click to apply to selected clip.";
// Frames to try: testsrc2 (detailed, saturated), then smptebars (has grey/low-saturation bars).
const FRAMES = [0.5, 5];

// Swept in CHUNKS independent tests (card i is in chunk i % CHUNKS): one test is the unit CI shards by, and
// a single 7-minute sweep on a CPU-only runner could not be spread over machines. Every chunk opens a fresh editor.
const CHUNKS = 3;
test.describe.configure({ mode: "parallel" });

for (let chunk = 0; chunk < CHUNKS; chunk++) {
test(`every Effects-browser card visibly changes the program canvas and undo restores it exactly (part ${chunk + 1}/${CHUNKS})`, async ({
  page,
}) => {
  test.setTimeout(420_000);
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  await clickClip(page, clip.id);
  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await settle(page, 800);

  const labels = await page.evaluate((suffix) => {
    const names = [...document.querySelectorAll(`button[aria-label$="${suffix}"]`)].map((e) =>
      (e.getAttribute("aria-label") as string).slice(0, -suffix.length),
    );
    return names;
  }, CARD_SUFFIX);
  expect(labels.length, "effects browser should list the pro effect library").toBeGreaterThanOrEqual(65);
  // Wave 7 breadth batch: every new effect must be a card (and is swept below).
  for (const label of W7_LABELS) expect(labels, `missing wave 7 card ${label}`).toContain(label);
  expect(new Set(labels).size, "one card per concept").toBe(labels.length);

  const failures: string[] = [];
  const report: string[] = [];
  for (const [index, label] of labels.entries()) {
    if (index % CHUNKS !== chunk) continue;
    if (NON_PIXEL.has(label)) continue;
    let ok = false;
    let note = "";
    for (const frame of FRAMES) {
      await seek(page, frame);
      await clickClip(page, clip.id);
      const pre = await readState(page);
      await snapStable(page, "before");
      const card = page.locator(`button[aria-label="${label}${CARD_SUFFIX}"]`).first();
      await card.scrollIntoViewIfNeeded();
      await card.dblclick();
      await settle(page, 1200);
      const extraSteps = await makeAddedEffectNonNeutral(page, clip.id);
      // Wait for the effect to be on the clip and the monitor to present it before capturing (a loaded machine lands both late).
      await expect.poll(async () => clipsOf(await readState(page), "Main")[0].effects, { timeout: 15_000 }).toBeGreaterThan(0).catch(() => undefined);
      await waitForPresentedPlayhead(page);
      const after = await readState(page);
      const applied = clipsOf(after, "Main")[0].effects;
      await snapStable(page, "after");
      const changed = await diffSnaps(page, "before", "after");

      for (let i = 0; i <= extraSteps; i++) await undo(page);
      await settle(page, 600);
      await expect.poll(async () => clipsOf(await readState(page), "Main")[0].effects, { timeout: 15_000 }).toBe(0).catch(() => undefined);
      await waitForPresentedPlayhead(page);
      await snapStable(page, "undone");
      const residual = await diffSnaps(page, "before", "undone");
      const restored = clipsOf(await readState(page), "Main")[0].effects;

      note = `frame@${frame}s effects=${applied} changed=${changed.changed}/${changed.total} undoResidual=${residual.changed} effectsAfterUndo=${restored} historyDelta=${after.historyLength - pre.historyLength - extraSteps}${extraSteps ? " (+1 non-neutral parameter step)" : ""}`;
      // Looks like LUT presets apply as colour grading, not an effect entry, so assert on history instead.
      const oneStep = after.historyLength - pre.historyLength - extraSteps === 1;
      ok = oneStep && changed.changed > 0 && residual.changed === 0 && restored === 0;
      if (ok) break;
      if (restored !== 0) break; // an inexact undo in state is never a frame problem
    }
    report.push(`${ok ? "ok  " : "FAIL"} ${label.padEnd(26)} ${note}`);
    if (!ok) failures.push(`${label}: ${note}`);
    await focusEditor(page);
  }
  console.log(`\n${report.join("\n")}`);
  expect(failures, failures.join("\n")).toEqual([]);
});
}

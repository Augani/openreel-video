import { expect, test } from "@playwright/test";
import { clickClip, clipLocator, clipsOf, openEditor, readState } from "./helpers";
import { applyMorphCutCard, lumaOf, makeJumpCut, psnr, renderBoth, waitForAnalysis } from "./morph-cut-lib";
import { transitionsOf } from "./custom-transitions-lib";

/**
 * Morph Cut and Optical Flow slow motion together in the real editor: a jump cut with a Morph Cut, the incoming
 * clip at 50% speed with Optical Flow. Preview and the export-mode engine (the renderer the export uses) must give
 * the same pixels at every frame of the transition and inside the slow-motion clip, and the optical-flow
 * in-betweens must be distinct frames (Frame Sampling would repeat each source frame twice at 50%).
 */
interface Hook {
  project: { getState(): Record<string, any> };
  speed: { editClipSpeed(projectId: string, clipId: string, change: Record<string, unknown>, affectAudio: boolean): Promise<boolean> };
}
const h = (): string => "__openreelE2E";

test("Morph Cut + 50% Optical Flow slow motion: export-mode render equals preview", async ({ page }, testInfo) => {
  testInfo.setTimeout(900_000);
  await openEditor(page);
  const cut = await makeJumpCut(page, 0.9, 1.3);
  const transitionId = await applyMorphCutCard(page, cut.clipAId);
  const [transition] = await transitionsOf(page);
  expect(transition!.type).toBe("morphCut");
  const analysis = await waitForAnalysis(page, transitionId);
  expect(analysis.state.status).toBe("ready");

  // slow the incoming clip to 50% and choose Optical Flow from its context menu
  const projectId = await page.evaluate((k) => (window as unknown as Record<string, Hook>)[k]!.project.getState().project.id as string, h());
  expect(await page.evaluate(([k, id, pid]) => (window as unknown as Record<string, Hook>)[k!]!.speed.editClipSpeed(pid!, id!, { speed: 0.5 }, true), [h(), cut.clipBId, projectId] as const)).toBe(true);
  await clickClip(page, cut.clipBId);
  await clipLocator(page, cut.clipBId).click({ button: "right" });
  await page.getByTestId("clip-time-interpolation-menu").click();
  await page.getByRole("menuitemradio", { name: "Optical Flow" }).click();
  await expect
    .poll(() => page.evaluate(([k, id]) => (window as unknown as Record<string, Hook>)[k!]!.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id)?.timeInterpolation, [h(), cut.clipBId] as const))
    .toBe("opticalFlow");
  const state = await readState(page);
  const clipB = clipsOf(state, "Main").find((c) => c.id === cut.clipBId)!;
  const cutTime = clipsOf(state, "Main").find((c) => c.id === cut.clipAId)!.start + clipsOf(state, "Main").find((c) => c.id === cut.clipAId)!.duration;
  expect(clipB.start).toBeCloseTo(cutTime, 2);

  // frames across the morph and two source-frame intervals deeper in the slow-motion clip
  const times = [...Array.from({ length: 10 }, (_, k) => Math.max(0, cutTime - 0.15 + k / 30)), ...Array.from({ length: 8 }, (_, k) => clipB.start + 0.5 + k / 30)];
  const frames = await renderBoth(page, times);
  const mismatched = frames.filter((f) => !f.identical).map((f) => f.t.toFixed(3));
  console.log(`[morph-cut+optical-flow e2e] preview vs export-mode engine: ${frames.length - mismatched.length}/${frames.length} bit-identical`);
  expect(mismatched, "preview and export-mode renders agree").toEqual([]);
  const slow = frames.slice(10).map((f) => lumaOf(f.preview));
  const distinct = slow.slice(1).filter((l, i) => psnr(l, slow[i]!) < 80).length;
  expect(distinct, "optical-flow in-betweens are distinct frames").toBeGreaterThanOrEqual(slow.length - 2);
});

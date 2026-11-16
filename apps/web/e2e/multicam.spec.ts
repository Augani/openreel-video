import { test } from "@playwright/test";
import { runMulticamAudioLockFlow, runMulticamFlow, runMulticamPersistenceFlow, runMulticamRetimeFlow, runMulticamTimecodeDialogFlow } from "./multicam-flow";

/**
 * Multicam hardening in real Chrome (GPU): sync by audio on three generated
 * cameras with known offsets, the monitor grid, live cuts with the number
 * keys, switch angle, audio mode, flatten, export colours, exact undo/redo.
 * See multicam-flow.ts; the same flow runs without a GPU in
 * fallback-multicam.spec.ts.
 */
test("multicam: sync by audio, live cuts with number keys, switch, flatten, export, undo/redo", async ({ page }, testInfo) => {
  await runMulticamFlow(page, testInfo);
});

test("multicam: sync lock, an opened nest, autosave and reload", async ({ page }, testInfo) => {
  await runMulticamPersistenceFlow(page, testInfo);
});

test("multicam: timecode sync and a fixed audio angle chosen in the dialog", async ({ page }, testInfo) => {
  await runMulticamTimecodeDialogFlow(page, testInfo);
});

test("multicam: audio stays locked to the picture through move, trim, slip, razor, undo/redo (exported clap, 1 ms)", async ({ page }, testInfo) => {
  await runMulticamAudioLockFlow(page, testInfo);
});

test("multicam: 2x speed - cuts at output times, exported colours per segment and clap timing", async ({ page }, testInfo) => {
  await runMulticamRetimeFlow(page, testInfo, "speed");
});

test("multicam: reverse - cuts at output times, exported colours per segment and clap timing", async ({ page }, testInfo) => {
  await runMulticamRetimeFlow(page, testInfo, "reverse");
});

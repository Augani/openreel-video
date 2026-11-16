import { test } from "@playwright/test";
import { run1080pFlow, runOcclusionFlow, runOverlayFlow, runTrackingFlow } from "./motion-track-flow";

// Real-browser motion tracking: a textured sprite moves along a known path (with a 24 px/frame burst,
// then a full and a partial occlusion). The tracker is driven through the Inspector UI, the result is
// attached to a red shape, the project is exported and the shape is located in the exported frames.
test.describe("motion tracking", () => {
  test.setTimeout(600_000);

  test("clean clip: track forward/backward, quality strip, attach, export pixels, undo, reload", async ({ page }, testInfo) => {
    await runTrackingFlow(page, testInfo, testInfo.project.name);
  });

  test("occlusion + fast motion: low-confidence marking, prediction, re-acquire, re-track, manual correction", async ({ page }, testInfo) => {
    await runOcclusionFlow(page, testInfo, testInfo.project.name);
  });

  test("on-canvas target: drag, resize and nudge the tracking region in the Program monitor, then track from it", async ({ page }, testInfo) => {
    await runOverlayFlow(page, testInfo, testInfo.project.name);
  });

  test("1080p clip: tracking speed, worker isolation, progress and cancel", async ({ page }, testInfo) => {
    await run1080pFlow(page, testInfo, testInfo.project.name);
  });
});

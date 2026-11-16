import { test } from "@playwright/test";
import { runMulticamFlow } from "./multicam-flow";

// The same multicam flow with no GPU at all: the pure software renderer must
// play, cut, flatten and export the angles with the same results.
test("multicam without a GPU: sync, live cuts, switch, flatten, export, undo/redo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "fallback-software", "software renderer only");
  await runMulticamFlow(page, testInfo);
});

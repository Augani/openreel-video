import { test } from "@playwright/test";
import { runOcclusionFlow, runTrackingFlow } from "./motion-track-flow";

// The same motion tracking flows with no GPU at all (software renderer): decode, track in a worker,
// attach and export must produce the same pixels.
test.describe("motion tracking without a GPU", () => {
  test.setTimeout(900_000);

  test("clean clip flow on the software renderer", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fallback-software", "software renderer only");
    await runTrackingFlow(page, testInfo, testInfo.project.name);
  });

  test("occlusion flow on the software renderer", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fallback-software", "software renderer only");
    await runOcclusionFlow(page, testInfo, testInfo.project.name);
  });
});

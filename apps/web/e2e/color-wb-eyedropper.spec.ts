import { test } from "@playwright/test";
import { expectRealFootage, expectWbFlow, runWbEyedropperFlow, runWbRealFootageFlow } from "./color-wb-eyedropper-lib";
import { openRealFootage } from "./looks-luts-lib";

// Premiere-style White Balance eyedropper (GPU project; fallback-color-wb-eyedropper.spec.ts runs the same
// flow on the Canvas2D / software path).
test("white balance eyedropper neutralises the sampled grey as one undo step; Esc cancels", async ({ page }) => {
  test.setTimeout(240_000);
  const r = await runWbEyedropperFlow(page);
  console.log(`[wb-eyedropper] ${JSON.stringify(r)}`);
  expectWbFlow(r);
});

// The case the grey bar cannot show: real footage with a real cast and a later stage. Version 2 runs white balance
// first, so the pick has to sample the white balance stage input, not the contrast-graded pixel on screen.
for (const version of [2, 1] as const) {
  test(`white balance eyedropper on real footage neutralises a patch under a cast + contrast (pipeline v${version})`, async ({ page }) => {
    test.setTimeout(300_000);
    const r = await runWbRealFootageFlow(page, version, (p) => openRealFootage(p));
    console.log(`[wb-eyedropper real v${version}] ${JSON.stringify(r)}`);
    expectRealFootage(r);
  });
}

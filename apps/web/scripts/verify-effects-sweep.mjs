#!/usr/bin/env node
/**
 * Real-browser sweep over every entry of the Effects browser.
 *
 * For each card: select the clip, double-click the card (apply at defaults),
 * diff the program canvas against the frame before, assert a nonzero pixel
 * diff, undo (Cmd+Z) and assert the canvas is restored exactly. Runs against
 * a flat-free test clip (testsrc2) and a low-saturation one so colour effects
 * such as Vibrance are judged on content they can change.
 *
 *   cd apps/web && npx vite --port 5391 --strictPort &
 *   WEB_URL=http://localhost:5391 node scripts/verify-effects-sweep.mjs
 *
 * Needs Playwright (resolved from apps/studio), Google Chrome with WebGPU and
 * ffmpeg on PATH. Chrome runs headless with a throwaway profile. Exits 1 on
 * any no-op effect or inexact undo.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(new URL("../../studio/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5391";
// Stabilize opens the inspector instead of adding a pixel effect.
const NON_PIXEL = new Set(["Stabilize"]);
const CLIP_PX = { x: 200, y: 752 };

const dir = mkdtempSync(join(tmpdir(), "openreel-effects-sweep-"));
const ffmpeg = (...args) =>
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const clips = {
  "testsrc2.mp4": ["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3"],
  "lowsat.mp4": ["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3,eq=saturation=0.25"],
};
for (const [name, input] of Object.entries(clips)) {
  ffmpeg(...input, "-f", "lavfi", "-i", "sine=f=440:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(dir, name));
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-unsafe-webgpu"],
});

async function snap(page, key) {
  await page.evaluate((k) => {
    const c = document.querySelector('canvas[aria-label^="Program frame"]');
    const t = document.createElement("canvas");
    t.width = c.width; t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true });
    g.drawImage(c, 0, 0);
    (window.__snaps ??= {})[k] = g.getImageData(0, 0, t.width, t.height).data;
  }, key);
}
const diff = (page, a, b) =>
  page.evaluate(([x, y]) => {
    const p = window.__snaps[x], q = window.__snaps[y];
    let changed = 0;
    for (let i = 0; i < p.length; i += 4)
      if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) changed++;
    return { changed, total: p.length / 4 };
  }, [a, b]);

let failures = 0;
for (const name of Object.keys(clips)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(() => {
    localStorage.setItem("openreel-onboarding-complete", "true");
    localStorage.setItem("openreel-mograph-tour-complete", "true");
  });
  await page.goto(WEB_URL);
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.waitForTimeout(2500);
  await page.locator('input[type=file][accept*="video"]').first().setInputFiles(join(dir, name));
  await page.waitForSelector("text=/\\d\\d:\\d\\d/", { timeout: 20000 });
  for (let i = 0; i < 8 && !(await page.getByText("1 clips").count()); i++) {
    await page.waitForTimeout(1500);
    const match = page.getByText("Match Video", { exact: true });
    if (await match.count()) { await match.first().click(); await page.waitForTimeout(2000); }
    if (await page.getByText("1 clips").count()) break;
    await page.mouse.dblclick(130, 198);
  }
  if (!(await page.getByText("1 clips").count())) throw new Error("clip was not added to the timeline");
  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await page.waitForTimeout(800);

  const suffix = ". Drag onto a clip to apply, or double-click to apply to selected clip.";
  const labels = await page.evaluate((s) =>
    [...document.querySelectorAll(`button[aria-label$="${s}"]`)].map((e) => e.getAttribute("aria-label").slice(0, -s.length)), suffix);
  console.log(`\n== ${name}: ${labels.length} effects`);

  const seen = new Set();
  for (const label of labels) {
    if (NON_PIXEL.has(label)) continue;
    if (seen.has(label)) { console.log(`DUPLICATE LABEL ${label}`); failures++; }
    seen.add(label);
    await page.mouse.click(CLIP_PX.x, CLIP_PX.y);
    await page.waitForTimeout(300);
    await snap(page, "before");
    const card = page.locator(`button[aria-label="${label}${suffix}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.dblclick();
    await page.waitForTimeout(1300);
    await snap(page, "after");
    const applied = await diff(page, "before", "after");
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(900);
    await snap(page, "undo");
    const undone = await diff(page, "before", "undo");
    const ok = applied.changed > 0 && undone.changed === 0;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(24)} changed=${applied.changed}/${applied.total} undoResidual=${undone.changed}`);
  }
  await page.close();
}
await browser.close();
if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall effects apply and undo exactly");

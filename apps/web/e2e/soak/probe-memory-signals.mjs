#!/usr/bin/env node
/**
 * Which page-visible memory signals see a decoded AudioBuffer and a pile of ImageBitmaps?
 *
 * The memory governor adds its registered caches to the page's own figures; this probe checks that this does not
 * double count: it allocates 230 MB of AudioBuffer, 64 MB of ArrayBuffer and 128 MB of ImageBitmaps in a
 * cross-origin-isolated blank page and prints `performance.memory.usedJSHeapSize` and
 * `performance.measureUserAgentSpecificMemory()` after each step.
 *
 *   node e2e/soak/probe-memory-signals.mjs
 */
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? "chrome", args: ["--enable-precise-memory-info"] });
const context = await browser.newContext();
const page = await context.newPage();
await page.route("https://probe.test/", (route) =>
  route.fulfill({
    contentType: "text/html",
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    body: "<!doctype html><title>probe</title>",
  }),
);
await page.goto("https://probe.test/");
const out = await page.evaluate(async () => {
  const MB = 1048576;
  const read = async (label) => {
    const ua = performance.measureUserAgentSpecificMemory ? (await performance.measureUserAgentSpecificMemory()).bytes : null;
    return { label, jsHeapMB: Math.round(performance.memory.usedJSHeapSize / MB), uaMB: ua === null ? null : Math.round(ua / MB) };
  };
  const rows = [await read("empty")];
  const ctx = new AudioContext();
  const buffer = ctx.createBuffer(2, 48000 * 600, 48000); // 10 min stereo = 230 MB
  buffer.getChannelData(0).fill(0.1);
  buffer.getChannelData(1).fill(0.1);
  rows.push(await read("audio buffer 230 MB"));
  const ab = new ArrayBuffer(64 * MB);
  new Uint8Array(ab).fill(1);
  rows.push(await read("array buffer 64 MB"));
  const bitmaps = [];
  for (let i = 0; i < 2; i++) {
    const c = new OffscreenCanvas(4096, 4096);
    c.getContext("2d").fillRect(0, 0, 4096, 4096);
    bitmaps.push(await createImageBitmap(c));
  }
  rows.push(await read("2 bitmaps 4096x4096 (128 MB)"));
  void [buffer, ab, bitmaps];
  return { crossOriginIsolated, rows };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

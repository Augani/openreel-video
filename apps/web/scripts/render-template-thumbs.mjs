#!/usr/bin/env node
/**
 * Renders the thumbnail of every built-in template into public/template-thumbs/<id>.webp.
 *
 * The art is the template itself: it is applied with its default values by the real TemplateEngine and its text and
 * graphics layers are drawn by the editor's title / graphics engines over the bundled sample scene
 * (src/components/welcome/template-thumbnail.ts). Run it against a dev server whenever a built-in template changes:
 *
 *   pnpm exec vite --port 5531 --strictPort &
 *   OPENREEL_THUMB_URL=http://localhost:5531 node scripts/render-template-thumbs.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.OPENREEL_THUMB_URL ?? "http://localhost:5531";
const outDir = join(root, "public", "template-thumbs");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (message) => console.log(`[page] ${message.text()}`));
  await page.goto(base);
  const files = await page.evaluate(async () => {
    const { renderBuiltinThumbnailBlobs } = await import("/src/components/welcome/template-thumbnail.ts");
    const response = await fetch("/effect-previews/sample-scene.jpg");
    const backdrop = await createImageBitmap(await response.blob());
    const blobs = await renderBuiltinThumbnailBlobs(backdrop);
    const encoded = {};
    for (const [id, blob] of Object.entries(blobs)) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      encoded[id] = btoa(binary);
    }
    const { builtinTemplateDigests } = await import("/src/components/welcome/template-thumbnail.ts");
    const digests = await builtinTemplateDigests();
    return { encoded, digests };
  });
  for (const [id, data] of Object.entries(files.encoded)) {
    writeFileSync(join(outDir, `${id}.webp`), Buffer.from(data, "base64"));
    console.log(`template-thumbs/${id}.webp`);
  }
  // The digest each thumbnail was rendered from; template-thumbs.fresh.test.ts fails when a template drifts.
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(files.digests, null, 2)}\n`);
} finally {
  await browser.close();
}

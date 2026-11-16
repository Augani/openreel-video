import type { Plugin } from "vite";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GOOGLE_FONT_SPECS } from "../src/services/font-catalog";

// Desktop font loading is local. Every selectable family must survive packaging.
const BUNDLED_FAMILIES = new Set(Object.keys(GOOGLE_FONT_SPECS));

export function isBundledFontFamily(family: string): boolean {
  return BUNDLED_FAMILIES.has(family);
}

export function pruneFontsCss(css: string, removeFile: (woff2: string) => void): string {
  const blocks = css.split(/(?=@font-face)/g);
  const kept: string[] = [];
  const discarded: string[] = [];
  for (const block of blocks) {
    const family = /font-family:\s*['"]([^'"]+)['"]/.exec(block)?.[1];
    if (!family) {
      kept.push(block);
      continue;
    }
    if (isBundledFontFamily(family)) {
      kept.push(block);
      continue;
    }
    discarded.push(block);
  }
  const files = (text: string) => new Set([...text.matchAll(/url\(\s*['"]?([^)'"\s]+\.woff2?)['"]?\s*\)/g)]
    .map(match => match[1].split("/").pop()!));
  const result = kept.join("");
  const retainedFiles = files(result);
  for (const file of files(discarded.join(""))) {
    if (!retainedFiles.has(file)) removeFile(file);
  }
  return result;
}

export function pruneFontsPlugin(isDesktop: boolean, outDir = "dist"): Plugin {
  return {
    name: "openreel-prune-fonts",
    apply: "build",
    closeBundle(): void {
      if (!isDesktop) return;
      const fontsDir = join(process.cwd(), outDir, "fonts");
      const cssPath = join(fontsDir, "google-fonts.css");
      if (!existsSync(cssPath)) return;
      const css = readFileSync(cssPath, "utf8");
      const pruned = pruneFontsCss(css, (woff2) => {
        const file = join(fontsDir, woff2.split("/").pop() ?? woff2);
        if (existsSync(file)) rmSync(file);
      });
      writeFileSync(cssPath, pruned);
    },
  };
}

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FONT_CATEGORIES } from "../src/components/editor/inspector/font-options";
import { pruneFontsCss } from "./prune-fonts";

const SAMPLE = `@font-face {
  font-family: 'Inter';
  font-style: normal;
  src: url(./inter-1.woff2) format('woff2');
}
@font-face {
  font-family: 'Unused Test Font';
  font-style: normal;
  src: url(./unused-1.woff2) format('woff2');
}
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  src: url(./roboto-1.woff2) format('woff2');
}
@font-face {
  font-family: 'Geist';
  font-style: normal;
  src: url(./geist-1.woff2) format('woff2');
}`;

describe("prune-fonts", () => {
  it("keeps every bundled font offered by the editor available offline", () => {
    const css = readFileSync(new URL("./../public/fonts/google-fonts.css", import.meta.url), "utf8");
    const out = pruneFontsCss(css, () => undefined);
    const families = new Set([...out.matchAll(/font-family:\s*['"]([^'"]+)['"]/g)].map(match => match[1]));
    const offered = Object.entries(FONT_CATEGORIES).filter(([category]) => category !== "System")
      .flatMap(([, values]) => [...values]);
    expect(offered.filter(family => !families.has(family))).toEqual([]);
  });

  it("never deletes a font asset still used by a retained face", () => {
    const removed: string[] = [];
    pruneFontsCss(SAMPLE + `@font-face { font-family: 'Unused Test Font'; src: url(./inter-1.woff2); }`, file => removed.push(file));
    expect(removed).not.toContain("inter-1.woff2");
  });
  it("pruneFontsCss keeps supported faces and reports unused files", () => {
    const removed: string[] = [];
    const out = pruneFontsCss(SAMPLE, (file) => removed.push(file));
    expect(out).toContain("Inter");
    expect(out).toContain("Roboto");
    expect(out).toContain("Geist");
    expect(out).not.toContain("Unused Test Font");
    expect(removed).toContain("unused-1.woff2");
    expect(removed).not.toContain("inter-1.woff2");
    expect(removed).not.toContain("geist-1.woff2");
    expect(removed).toHaveLength(1);
  });
});

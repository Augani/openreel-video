import { describe, it, expect } from "vitest";
import { isCuratedFamily, pruneFontsCss } from "./prune-fonts";

const SAMPLE = `@font-face {
  font-family: 'Inter';
  font-style: normal;
  src: url(./inter-1.woff2) format('woff2');
}
@font-face {
  font-family: 'Bebas Neue';
  font-style: normal;
  src: url(./bebas-1.woff2) format('woff2');
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
  it("keeps curated families, drops others", () => {
    expect(isCuratedFamily("Inter")).toBe(true);
    expect(isCuratedFamily("Geist")).toBe(true);
    expect(isCuratedFamily("Bebas Neue")).toBe(false);
    expect(isCuratedFamily("Geist Mono")).toBe(false);
  });

  it("pruneFontsCss keeps curated @font-face + reports dropped woff2", () => {
    const removed: string[] = [];
    const out = pruneFontsCss(SAMPLE, (file) => removed.push(file));
    expect(out).toContain("Inter");
    expect(out).toContain("Roboto");
    expect(out).toContain("Geist");
    expect(out).not.toContain("Bebas Neue");
    expect(removed).toContain("bebas-1.woff2");
    expect(removed).not.toContain("inter-1.woff2");
    expect(removed).not.toContain("geist-1.woff2");
    expect(removed).toHaveLength(1);
  });
});

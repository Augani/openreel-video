import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "@openreel/core";
import { templateDigest } from "./template-digest";

describe("bundled template thumbnails", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, "../../../public/template-thumbs/manifest.json"), "utf8"),
  ) as Record<string, string>;

  it("were rendered from the current built-in template definitions", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(
        manifest[template.id],
        `${template.id}: run scripts/render-template-thumbs.mjs (see its header) and commit public/template-thumbs`,
      ).toBe(templateDigest(template));
    }
  });

  it("has one thumbnail file per built-in template", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(() => readFileSync(resolve(__dirname, `../../../public/template-thumbs/${template.id}.webp`))).not.toThrow();
    }
  });
});

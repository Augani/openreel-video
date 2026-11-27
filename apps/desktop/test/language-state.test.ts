import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLanguageState, writeLanguagePreference } from "../src/main/language-state";

describe("language-state", () => {
  it("round-trips the preference and resolves it", () => {
    const file = join(mkdtempSync(join(tmpdir(), "openreel-language-")), "language.json");
    expect(readLanguageState(file, ["zh-CN"])).toEqual({ preference: "system", locale: "zh-CN" });
    writeLanguagePreference(file, "en");
    expect(readLanguageState(file, ["zh-CN"])).toEqual({ preference: "en", locale: "en" });
  });
});

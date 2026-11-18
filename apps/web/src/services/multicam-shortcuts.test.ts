import { describe, expect, it } from "vitest";
import { keyboardShortcuts } from "./keyboard-shortcuts";

/**
 * The multicam monitor owns the bare number keys 1-9 (one per angle). No
 * default binding and no preset may claim them, or a live cut would also fire
 * another command.
 */
describe("multicam number keys do not collide with any shortcut preset", () => {
  const bareDigit = /^[1-9]$/;
  const isBareDigit = (combo: string) => bareDigit.test(combo.trim().toLowerCase());

  it("has no default binding on 1-9", () => {
    const hits = keyboardShortcuts.getAllShortcuts().filter((s) => isBareDigit(s.currentKey) || isBareDigit(s.defaultKey));
    expect(hits.map((s) => s.id)).toEqual([]);
  });

  it("stays free after applying every preset", () => {
    for (const preset of keyboardShortcuts.getPresets()) {
      keyboardShortcuts.applyPreset(preset.id);
      const hits = keyboardShortcuts.getAllShortcuts().filter((s) => isBareDigit(s.currentKey));
      expect(hits.map((s) => s.id), `preset ${preset.id}`).toEqual([]);
    }
    keyboardShortcuts.applyPreset("openreel");
  });
});

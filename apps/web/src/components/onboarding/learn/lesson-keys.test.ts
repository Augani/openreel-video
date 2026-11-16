import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";
import { LESSONS } from "./lessons";
import { lessonTextToString, renderLessonText, resolveLessonKeys } from "./lesson-keys";

beforeEach(() => keyboardShortcuts.resetAllShortcuts());
afterEach(() => keyboardShortcuts.resetAllShortcuts());

describe("lesson key names read the live binding", () => {
  it("uses the default split and delete keys", () => {
    const keys = resolveLessonKeys();
    expect(keys.splitKey).toBe(keyboardShortcuts.formatShortcut("editing.split"));
    expect(keys.splitKey.toUpperCase()).toBe("S");
    expect(keys.deleteKey).toBe(keyboardShortcuts.formatShortcut("editing.delete"));
  });

  it("follows the Premiere preset (split is Cmd+K there, not S)", () => {
    keyboardShortcuts.applyPreset("premiere");
    const keys = resolveLessonKeys();
    expect(keys.splitKey).toBe(keyboardShortcuts.formatShortcut("editing.split"));
    expect(keys.splitKey.toUpperCase()).not.toBe("S");
    expect(keys.splitKey.toUpperCase()).toContain("K");
    const text = lessonTextToString(LESSONS[1].instruction, keys);
    expect(text).toContain(keys.splitKey);
    expect(text).not.toMatch(/press S\b/);
  });

  it.each([["finalcut", "B"], ["davinci", "\\"], ["capcut", "B"]])("follows the %s preset", (preset, letter) => {
    keyboardShortcuts.applyPreset(preset);
    const keys = resolveLessonKeys();
    expect(keys.splitKey).toBe(keyboardShortcuts.formatShortcut("editing.split"));
    expect(keys.splitKey.toUpperCase()).toContain(letter);
  });

  it("falls back to a menu path when the command is unbound", () => {
    keyboardShortcuts.applyPreset("premiere");
    // an empty current key means the command has no shortcut
    const shortcut = keyboardShortcuts.getShortcut("editing.split");
    expect(shortcut).toBeDefined();
    const original = keyboardShortcuts.formatShortcut;
    keyboardShortcuts.formatShortcut = (id: string) => (id === "editing.split" ? "" : original.call(keyboardShortcuts, id));
    try {
      expect(resolveLessonKeys().splitKey).toMatch(/Edit menu/);
    } finally {
      keyboardShortcuts.formatShortcut = original;
    }
  });

  it("splits text into text and key parts", () => {
    const parts = renderLessonText("press {splitKey} now", { splitKey: "S", deleteKey: "Delete" });
    expect(parts).toEqual([
      { type: "text", text: "press " },
      { type: "key", label: "S" },
      { type: "text", text: " now" },
    ]);
  });

  it("no lesson hardcodes a key letter", () => {
    for (const lesson of LESSONS) {
      expect(lesson.instruction).not.toMatch(/press\s+[A-Za-z]\b/);
      expect(lesson.instruction).not.toMatch(/⌘|Cmd\+|Ctrl\+/);
    }
  });
});

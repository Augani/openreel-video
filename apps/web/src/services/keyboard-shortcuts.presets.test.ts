import { beforeEach, describe, expect, it } from "vitest";
import { keyboardShortcuts } from "./keyboard-shortcuts";

const PRESET_IDS = keyboardShortcuts.getPresets().map((p) => p.id);

function press(key: string, options: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
}

beforeEach(() => {
  localStorage.clear();
  keyboardShortcuts.resetAllShortcuts();
});

describe("preset diff", () => {
  it("OpenReel default changes nothing", () => {
    const diff = keyboardShortcuts.presetDiff("openreel");
    expect(diff?.count).toBe(0);
    expect(diff?.searchPaletteMoved).toBe(false);
  });

  it("returns null for an unknown preset", () => {
    expect(keyboardShortcuts.presetDiff("nope")).toBeNull();
  });

  it("does not touch the live bindings", () => {
    keyboardShortcuts.presetDiff("premiere");
    expect(keyboardShortcuts.getShortcut("editing.split")?.currentKey).toBe("s");
    expect(keyboardShortcuts.getActivePreset()).toBe("openreel");
  });

  it.each(PRESET_IDS)("%s: diff matches exactly what applyPreset does", (id) => {
    const diff = keyboardShortcuts.presetDiff(id)!;
    const defaults = new Map(keyboardShortcuts.getAllShortcuts().map((s) => [s.id, s.defaultKey]));
    keyboardShortcuts.applyPreset(id);
    const changed = keyboardShortcuts
      .getAllShortcuts()
      .filter((s) => s.currentKey !== defaults.get(s.id))
      .map((s) => [s.id, s.currentKey])
      .sort();
    expect(diff.changes.map((c) => [c.id, c.to]).sort()).toEqual(changed);
    expect(diff.count).toBe(changed.length);
    expect(keyboardShortcuts.getSearchPaletteKey()).toBe(diff.searchPaletteKey);
  });

  it("snapshot of every preset diff", () => {
    const snap = (id: string) =>
      keyboardShortcuts
        .presetDiff(id)!
        .changes.map((c) => `${c.id}: ${c.from} -> ${c.to || "(none)"}${c.displaced ? " (displaced)" : ""}`);
    expect(snap("premiere")).toMatchInlineSnapshot(`
      [
        "editing.duplicate: cmd+d -> alt+cmd+d (displaced)",
        "editing.split: s -> cmd+k",
        "editing.applyDefaultTransition: cmd+shift+d -> cmd+d",
        "timeline.toggleSnap: n -> s",
        "timeline.zoomIn: cmd+= -> =",
        "timeline.zoomOut: cmd+- -> -",
        "timeline.bladeTool: b -> c",
        "timeline.rippleTool: r -> b",
        "timeline.rollTool: shift+n -> n",
        "timeline.stretchTool: shift+r -> r",
        "timeline.fitTimeline: cmd+0 -> \\",
      ]
    `);
    expect(snap("davinci")).toMatchInlineSnapshot(`
      [
        "editing.rippleDelete: shift+delete -> shift+backspace",
        "editing.split: s -> cmd+\\",
        "timeline.selectionTool: v -> a",
        "timeline.slipTool: y -> alt+y (displaced)",
        "timeline.trackSelectForwardTool: a -> y",
        "timeline.fitTimeline: cmd+0 -> shift+z",
      ]
    `);
    expect(snap("finalcut")).toMatchInlineSnapshot(`
      [
        "playback.prevClip: [ -> alt+[ (displaced)",
        "playback.nextClip: ] -> alt+] (displaced)",
        "editing.split: s -> cmd+b",
        "editing.trimStart: q -> [",
        "editing.trimEnd: w -> ]",
        "editing.insert: , -> w",
        "editing.overwrite: . -> d",
        "editing.addEditAllTracks: cmd+shift+k -> cmd+shift+b",
        "timeline.selectionTool: v -> a",
        "timeline.trackSelectForwardTool: a -> alt+a (displaced)",
        "timeline.fitTimeline: cmd+0 -> shift+z",
      ]
    `);
    expect(snap("capcut")).toMatchInlineSnapshot(`
      [
        "editing.split: s -> ctrl+b",
      ]
    `);
  });
});

describe("preset bindings", () => {
  it.each(PRESET_IDS)("%s: no two commands share a key and none is left unassigned", (id) => {
    keyboardShortcuts.applyPreset(id);
    for (const shortcut of keyboardShortcuts.getAllShortcuts()) {
      expect(shortcut.currentKey, `${shortcut.id} unassigned`).not.toBe("");
      const owner = keyboardShortcuts.findConflict(shortcut.currentKey, shortcut.id);
      expect(owner, `${shortcut.id} (${shortcut.currentKey}) collides with ${owner?.id}`).toBeNull();
    }
  });

  it.each(PRESET_IDS)("%s: only references commands that exist", (id) => {
    const known = new Set(keyboardShortcuts.getAllShortcuts().map((s) => s.id));
    const preset = keyboardShortcuts.getPresets().find((p) => p.id === id)!;
    for (const shortcutId of Object.keys(preset.shortcuts)) expect(known.has(shortcutId), shortcutId).toBe(true);
  });

  it("Premiere moves the search palette off Cmd+K", () => {
    expect(keyboardShortcuts.getSearchPaletteKey()).toBe("cmd+k");
    keyboardShortcuts.applyPreset("premiere");
    expect(keyboardShortcuts.getSearchPaletteKey()).toBe("cmd+shift+p");
    expect(keyboardShortcuts.presetDiff("premiere")?.searchPaletteMoved).toBe(true);
    expect(keyboardShortcuts.getShortcut("editing.split")?.currentKey).toBe("cmd+k");
  });

  it("Premiere uses C for the razor and B for ripple, and the handlers still resolve", () => {
    keyboardShortcuts.applyPreset("premiere");
    expect(keyboardShortcuts.getShortcut("timeline.bladeTool")?.currentKey).toBe("c");
    expect(keyboardShortcuts.getShortcut("timeline.rippleTool")?.currentKey).toBe("b");
    let blade = 0;
    const off = keyboardShortcuts.registerHandler("timeline.bladeTool", () => {
      blade += 1;
    });
    keyboardShortcuts.startListening();
    press("c");
    keyboardShortcuts.stopListening();
    off();
    expect(blade).toBe(1);
  });

  it("Final Cut keeps the displaced clip-navigation keys reachable", () => {
    keyboardShortcuts.applyPreset("finalcut");
    expect(keyboardShortcuts.getShortcut("editing.trimStart")?.currentKey).toBe("[");
    expect(keyboardShortcuts.getShortcut("playback.prevClip")?.currentKey).toBe("alt+[");
  });

  it("switching presets starts from the defaults, not from the previous preset", () => {
    keyboardShortcuts.applyPreset("premiere");
    keyboardShortcuts.applyPreset("openreel");
    expect(keyboardShortcuts.getShortcut("timeline.bladeTool")?.currentKey).toBe("b");
    expect(keyboardShortcuts.getActivePreset()).toBe("openreel");
    expect(localStorage.getItem("openreel_shortcut_preset")).toBe("openreel");
  });

  it("persists the applied preset (the e2e asserts this key)", () => {
    keyboardShortcuts.applyPreset("premiere");
    expect(localStorage.getItem("openreel_shortcut_preset")).toBe("premiere");
  });
});

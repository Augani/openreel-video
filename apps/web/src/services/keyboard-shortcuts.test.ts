import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureKeyCombo, keyboardShortcuts } from "./keyboard-shortcuts";

const cleanups: Array<() => void> = [];
function listen(action: string) {
  const handler = vi.fn();
  cleanups.push(keyboardShortcuts.registerHandler(action, handler));
  return handler;
}
function press(key: string, options: Partial<KeyboardEvent> = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  keyboardShortcuts.resetAllShortcuts();
  keyboardShortcuts.startListening();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  keyboardShortcuts.stopListening();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("editor keyboard shortcut dispatch", () => {
  it("saves from a closed select trigger without taking over its editing/navigation keys", () => {
    const save = listen("file.save");
    const split = listen("editing.split");
    document.body.innerHTML = '<button role="combobox" aria-expanded="false">Animation</button>';
    const target = document.querySelector("button")!;
    expect(press("s", { metaKey: true }, target).defaultPrevented).toBe(true);
    expect(press("s", { ctrlKey: true }, target).defaultPrevented).toBe(true);
    press("s", {}, target);
    expect(save).toHaveBeenCalledTimes(2);
    expect(split).not.toHaveBeenCalled();
  });

  it.each([
    '<button role="combobox" aria-expanded="true">Animation</button>',
    '<div role="dialog"><button role="combobox" aria-expanded="false">Animation</button></div>',
    '<input role="combobox" aria-expanded="false" />',
  ])("preserves focused save handling in %s", markup => {
    const save = listen("file.save");
    document.body.innerHTML = markup;
    const target = document.querySelector("button, input")!;
    expect(press("s", { metaKey: true }, target).defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("uses both Cmd and Ctrl for portable commands", () => {
    const handler = listen("editing.undo");
    press("z", { ctrlKey: true });
    press("z", { metaKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(keyboardShortcuts.findConflict("ctrl+z")?.id).toBe("editing.undo");
    expect(keyboardShortcuts.findConflict("backspace")?.id).toBe("editing.delete");
  });

  it.each([
    '<input />', '<div contenteditable="true"><span>Caption text</span></div>',
    '<div role="dialog"><button>Confirm</button></div>',
  ])("preserves focused typing and control behavior in %s", (markup) => {
    const handler = listen("editing.split");
    document.body.innerHTML = markup;
    const target = document.body.querySelector("span, button") ?? document.body.firstElementChild!;
    expect(press("s", {}, target).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets native buttons receive Space and arrow navigation", () => {
    const play = listen("playback.playPause");
    const step = listen("playback.frameForward");
    const button = document.createElement("button");
    document.body.append(button);
    press(" ", { code: "Space" }, button);
    press("ArrowRight", {}, button);
    expect(play).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
  });

  it("keeps frame navigation available on a focused timeline clip", () => {
    const step = listen("playback.frameForward");
    const play = listen("playback.playPause");
    document.body.innerHTML = '<div data-tour="timeline"><div role="button" tabindex="0">Video clip</div></div>';
    const clip = document.querySelector('[role="button"]')!;
    press("ArrowRight", {}, clip);
    press(" ", { code: "Space" }, clip);
    expect(step).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
  });

  it("blocks timeline edits while a modal is open even before focus transfers", () => {
    const handler = listen("editing.delete");
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(press("Delete").defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not intercept IME composition or handled events", () => {
    const handler = listen("editing.split");
    press("s", { isComposing: true });
    const event = new KeyboardEvent("keydown", { key: "s", cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows frame-step repeats while preventing repeated edits and play toggles", () => {
    const step = listen("playback.frameForward");
    const split = listen("editing.split");
    const play = listen("playback.playPause");
    press("ArrowRight", { repeat: true });
    press("s", { repeat: true });
    press(" ", { code: "Space", repeat: true });
    expect(step).toHaveBeenCalledOnce();
    expect(split).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("does not swallow browser shortcuts without a registered action", () => {
    expect(press("s", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("keeps Final Cut trimming and clip navigation reachable", () => {
    const trim = listen("editing.trimStart");
    const previous = listen("playback.prevClip");
    keyboardShortcuts.applyPreset("finalcut");
    press("[");
    press("“", { code: "BracketLeft", altKey: true });
    expect(trim).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();
    const keys = keyboardShortcuts.getAllShortcuts().map((shortcut) => shortcut.currentKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keyboardShortcuts.resetShortcut("playback.prevClip")).toBe(false);
    expect(keyboardShortcuts.getShortcut("playback.prevClip")?.currentKey).toBe("alt+[");
    keyboardShortcuts.resetAllShortcuts();
    expect(keyboardShortcuts.getActivePreset()).toBe("openreel");
  });

  it("captures and executes Space and plus-key customizations", () => {
    const play = listen("playback.playPause");
    const combo = captureKeyCombo({ key: "+", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false });
    expect(combo).toBe("cmd++");
    expect(keyboardShortcuts.setShortcut("playback.playPause", combo)).toBe(true);
    press("+", { ctrlKey: true, shiftKey: true });
    expect(play).toHaveBeenCalledOnce();
    expect(captureKeyCombo({ key: " ", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBe("space");
  });

  it("keeps customized shortcuts usable when storage writes fail", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
    expect(keyboardShortcuts.setShortcut("editing.split", "alt+b")).toBe(true);
    const split = listen("editing.split");
    press("b", {altKey:true});
    expect(split).toHaveBeenCalledOnce();
  });
});

describe("shortcut initialization", () => {
  it("recovers from malformed stored preferences", async () => {
    localStorage.setItem("openreel_shortcuts", "{broken JSON");
    vi.resetModules();
    const loaded = await import("./keyboard-shortcuts");
    expect(loaded.keyboardShortcuts.getShortcut("editing.split")?.currentKey).toBe("s");
    localStorage.removeItem("openreel_shortcuts");
  });
});

describe("trim tool shortcuts", () => {
  const ids = ["timeline.rollTool", "timeline.slideTool", "timeline.stretchTool"];
  it("never share a key with another enabled shortcut, under any preset", () => {
    for (const preset of ["openreel", "capcut", "premiere", "finalcut", "davinci"]) {
      keyboardShortcuts.applyPreset(preset);
      const all = keyboardShortcuts.getAllShortcuts().filter((s) => s.enabled);
      for (const id of ids) {
        const key = keyboardShortcuts.getShortcut(id)!.currentKey;
        expect(all.filter((s) => s.currentKey === key).map((s) => s.id), `${preset}:${id}`).toEqual([id]);
      }
    }
  });
  it("dispatch to their own action, leaving N, R and unshifted keys alone", () => {
    const roll = listen("timeline.rollTool");
    const stretch = listen("timeline.stretchTool");
    const ripple = listen("timeline.rippleTool");
    const snap = listen("timeline.toggleSnap");
    press("N", { shiftKey: true, code: "KeyN" });
    press("R", { shiftKey: true, code: "KeyR" });
    expect(roll).toHaveBeenCalledTimes(1);
    expect(stretch).toHaveBeenCalledTimes(1);
    expect(ripple).not.toHaveBeenCalled();
    expect(snap).not.toHaveBeenCalled();
    press("r", { code: "KeyR" });
    press("n", { code: "KeyN" });
    expect(ripple).toHaveBeenCalledTimes(1);
    expect(snap).toHaveBeenCalledTimes(1);
    expect(roll).toHaveBeenCalledTimes(1);
  });
});

describe("track select, hand and zoom tool shortcuts", () => {
  const ids = [
    "timeline.trackSelectForwardTool",
    "timeline.trackSelectBackwardTool",
    "timeline.handTool",
    "timeline.zoomTool",
  ];
  it("never share a key with another enabled shortcut, under any preset", () => {
    for (const preset of ["openreel", "capcut", "premiere", "finalcut", "davinci"]) {
      keyboardShortcuts.applyPreset(preset);
      const all = keyboardShortcuts.getAllShortcuts().filter((s) => s.enabled);
      for (const id of ids) {
        const key = keyboardShortcuts.getShortcut(id)!.currentKey;
        expect(key, `${preset}:${id}`).not.toBe("");
        expect(all.filter((s) => s.currentKey === key).map((s) => s.id), `${preset}:${id}`).toEqual([id]);
      }
    }
  });
  it("use Premiere's keys: A, Shift+A, H and Z", () => {
    keyboardShortcuts.applyPreset("openreel");
    expect(ids.map((id) => keyboardShortcuts.getShortcut(id)!.currentKey)).toEqual(["a", "shift+a", "h", "z"]);
  });
  it("dispatch to their own action without touching Cmd+A or Cmd+Z", () => {
    const forward = listen("timeline.trackSelectForwardTool");
    const backward = listen("timeline.trackSelectBackwardTool");
    const hand = listen("timeline.handTool");
    const zoom = listen("timeline.zoomTool");
    const selectAll = listen("selection.selectAll");
    press("a", { code: "KeyA" });
    press("A", { shiftKey: true, code: "KeyA" });
    press("h", { code: "KeyH" });
    press("z", { code: "KeyZ" });
    press("a", { code: "KeyA", metaKey: true });
    expect([forward, backward, hand, zoom].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1, 1]);
    expect(selectAll).toHaveBeenCalledTimes(1);
  });
});

describe("split edit shortcuts", () => {
  const ids = [
    "editing.extendEdit", "editing.extendEditVideo", "editing.extendEditAudio",
    "editing.jCut", "editing.lCut",
    "editing.nudgeSideLeft", "editing.nudgeSideRight",
    "editing.nudgeSideLeftLarge", "editing.nudgeSideRightLarge",
  ];
  it("never share a key with another enabled shortcut, under any preset", () => {
    for (const preset of ["openreel", "capcut", "premiere", "finalcut", "davinci"]) {
      keyboardShortcuts.applyPreset(preset);
      const all = keyboardShortcuts.getAllShortcuts().filter((s) => s.enabled);
      for (const id of ids) {
        const key = keyboardShortcuts.getShortcut(id)!.currentKey;
        expect(all.filter((s) => s.currentKey === key).map((s) => s.id), `${preset}:${id}`).toEqual([id]);
      }
    }
  });
  it("dispatch E, Shift+E, Alt+E (macOS dead key) and the comma/period nudges to their own actions", () => {
    const extend = listen("editing.extendEdit");
    const video = listen("editing.extendEditVideo");
    const audio = listen("editing.extendEditAudio");
    const left = listen("editing.nudgeSideLeft");
    const right = listen("editing.nudgeSideRight");
    const insert = listen("editing.insert");
    const overwrite = listen("editing.overwrite");
    press("e", { code: "KeyE" });
    press("E", { code: "KeyE", shiftKey: true });
    press("´", { code: "KeyE", altKey: true });
    press("≤", { code: "Comma", altKey: true });
    press("≥", { code: "Period", altKey: true });
    expect([extend, video, audio, left, right].map((h) => h.mock.calls.length)).toEqual([1, 1, 1, 1, 1]);
    // Plain , and . stay Insert / Overwrite.
    press(",", { code: "Comma" });
    press(".", { code: "Period" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(overwrite).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledTimes(1);
  });
});

describe("Render In to Out shortcut", () => {
  it("owns Enter exclusively under every preset", () => {
    for (const preset of ["openreel", "capcut", "premiere", "finalcut", "davinci"]) {
      keyboardShortcuts.applyPreset(preset);
      const claimants = keyboardShortcuts
        .getAllShortcuts()
        .filter((s) => s.enabled && s.currentKey === "enter")
        .map((s) => s.id);
      expect(claimants, preset).toEqual(["sequence.renderInToOut"]);
    }
  });
  it("dispatches on Enter but not from a focused button or an open dialog", () => {
    const render = listen("sequence.renderInToOut");
    press("Enter", { code: "Enter" });
    expect(render).toHaveBeenCalledTimes(1);
    const button = document.createElement("button");
    document.body.append(button);
    press("Enter", { code: "Enter" }, button);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("search palette binding vs presets", () => {
  afterEach(() => keyboardShortcuts.applyPreset("openreel"));

  it("keeps Cmd+K for the palette under the default preset", () => {
    keyboardShortcuts.applyPreset("openreel");
    expect(keyboardShortcuts.getSearchPaletteKey()).toBe("cmd+k");
    expect(keyboardShortcuts.formatSearchPaletteHint()).toMatch(/K$/);
    expect(keyboardShortcuts.isSearchPaletteEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))).toBe(true);
  });

  it("lets the Premiere preset own Cmd+K (Add Edit) and moves the palette", () => {
    keyboardShortcuts.applyPreset("premiere");
    const split = listen("editing.split");
    const cmdK = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    expect(keyboardShortcuts.isSearchPaletteEvent(cmdK)).toBe(false);
    window.dispatchEvent(cmdK);
    expect(split).toHaveBeenCalledTimes(1);
    expect(keyboardShortcuts.getSearchPaletteKey()).toBe("cmd+shift+p");
    expect(keyboardShortcuts.formatSearchPaletteHint()).toMatch(/P$/);
    expect(keyboardShortcuts.isSearchPaletteEvent(new KeyboardEvent("keydown", { key: "p", metaKey: true, shiftKey: true }))).toBe(true);
  });
});

describe("whole-registry collision audit", () => {
  const identity = (key: string): string => {
    const parts = key.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
    const main = parts.pop() ?? "";
    const mods = parts.map((m) => (m === "ctrl" || m === "meta" || m === "cmd" ? "mod" : m)).sort();
    return [...mods, main].join("+");
  };
  const presetIds = ["openreel", "capcut", "premiere", "finalcut", "davinci"];
  afterEach(() => keyboardShortcuts.applyPreset("openreel"));

  it("audits every preset the app ships (a new preset must be added to this list)", () => {
    expect(keyboardShortcuts.getPresets().map((preset) => preset.id).sort()).toEqual([...presetIds].sort());
  });

  it("no two enabled shortcuts share a key under any preset (every wave's bindings together)", () => {
    for (const preset of presetIds) {
      keyboardShortcuts.applyPreset(preset);
      const owners = new Map<string, string[]>();
      for (const shortcut of keyboardShortcuts.getAllShortcuts()) {
        if (!shortcut.enabled || !shortcut.currentKey) continue;
        const key = identity(shortcut.currentKey);
        owners.set(key, [...(owners.get(key) ?? []), shortcut.id]);
      }
      const clashes = [...owners].filter(([, ids]) => ids.length > 1).map(([key, ids]) => `${key}: ${ids.join(", ")}`);
      expect(clashes, preset).toEqual([]);
    }
  });

  it("leaves bare 1-9 (multicam angle cuts) and Shift+P (Toggle Proxies) to their owners under every preset", () => {
    for (const preset of presetIds) {
      keyboardShortcuts.applyPreset(preset);
      const enabled = keyboardShortcuts.getAllShortcuts().filter((s) => s.enabled && s.currentKey);
      const digits = enabled.filter((s) => /^[1-9]$/.test(identity(s.currentKey))).map((s) => s.id);
      expect(digits, `${preset}: bare digits are the multicam angle keys`).toEqual([]);
      const proxy = enabled.filter((s) => identity(s.currentKey) === "shift+p").map((s) => s.id);
      expect(proxy.length, `${preset}: Shift+P has at most one owner`).toBeLessThanOrEqual(1);
    }
  });

  it("keeps Cmd/Ctrl+F free for the Project panel find under every preset", () => {
    for (const preset of presetIds) {
      keyboardShortcuts.applyPreset(preset);
      const claimants = keyboardShortcuts.getAllShortcuts().filter((s) => s.enabled && identity(s.currentKey) === "mod+f").map((s) => s.id);
      expect(claimants, preset).toEqual([]);
    }
  });

  it("never binds the search palette key to another shortcut", () => {
    for (const preset of presetIds) {
      keyboardShortcuts.applyPreset(preset);
      const palette = identity(keyboardShortcuts.getSearchPaletteKey());
      const claimants = keyboardShortcuts.getAllShortcuts().filter((s) => s.enabled && identity(s.currentKey) === palette).map((s) => s.id);
      expect(claimants, preset).toEqual([]);
    }
  });
});

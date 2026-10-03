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
  it("opens help with the shifted question-mark key", () => {
    const handler = listen("view.showShortcuts");
    expect(press("?", { code: "Slash", shiftKey: true }).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("supports Backspace deletion and shifted ripple deletion", () => {
    const remove = listen("editing.delete");
    const ripple = listen("editing.rippleDelete");
    press("Backspace");
    press("Backspace", { shiftKey: true });
    expect(remove).toHaveBeenCalledOnce();
    expect(ripple).toHaveBeenCalledOnce();
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
    '<input />', '<textarea></textarea>', '<select><option>One</option></select>',
    '<div contenteditable="true"><span>Caption text</span></div>',
    '<div role="slider" tabindex="0"></div>',
    '<div role="dialog"><button>Confirm</button></div>',
    '<div data-editor-shortcuts="off"><span>Focused tool</span></div>',
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

  it("captures physical Option punctuation consistently on macOS", () => {
    expect(captureKeyCombo({ key: "“", code: "BracketLeft", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false })).toBe("alt+[");
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
    expect(keyboardShortcuts.setShortcut("editing.split", "b")).toBe(true);
    const split = listen("editing.split");
    press("b");
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

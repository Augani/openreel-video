import { describe, expect, it, vi } from "vitest";
import { insertAudioWarmFrame, installAudioWarmFrame } from "./audio-warm-frame";

function fakeDocument(body: boolean) {
  const listeners = new Map<string, () => void>();
  const frame = {
    src: "",
    tabIndex: 0,
    style: { cssText: "" },
    attrs: {} as Record<string, string>,
    listeners: new Map<string, () => void>(),
    removed: false,
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener);
    },
    remove() {
      this.removed = true;
    },
  };
  const appended: unknown[] = [];
  return {
    frame,
    appended,
    listeners,
    doc: {
      body: body ? { appendChild: (node: unknown) => appended.push(node) } : null,
      createElement: () => frame,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    },
  };
}

describe("audio warm frame", () => {
  it("embeds a sandboxed, hidden page of the warm scheme and removes it after it has loaded", () => {
    const { doc, frame, appended } = fakeDocument(true);
    const timers: Array<[() => void, number]> = [];
    insertAudioWarmFrame(doc as never, (fn, ms) => timers.push([fn, ms]));
    expect(frame.src).toBe("openreel-warm://audio/warm.html");
    expect(frame.attrs.sandbox).toBe("allow-scripts");
    expect(frame.attrs["aria-hidden"]).toBe("true");
    expect(frame.tabIndex).toBe(-1);
    expect(appended).toEqual([frame]);
    // A hard stop is armed up front; the load handler arms the short one.
    expect(timers.map(([, ms]) => ms)).toEqual([10_000]);
    frame.listeners.get("load")?.();
    expect(timers.map(([, ms]) => ms)).toEqual([10_000, 1500]);
    timers[1][0]();
    expect(frame.removed).toBe(true);
  });

  it("does nothing without a body and never throws", () => {
    const { doc, appended } = fakeDocument(false);
    expect(() => insertAudioWarmFrame(doc as never, vi.fn())).not.toThrow();
    expect(appended).toEqual([]);
    expect(() => insertAudioWarmFrame({ body: {}, createElement: () => { throw new Error("boom"); } } as never, vi.fn())).not.toThrow();
  });

  it("only waits for DOMContentLoaded when the window asked for the warm-up", () => {
    const off = fakeDocument(true);
    installAudioWarmFrame(off.doc as never, ["electron"], "--openreel-audio-warm");
    expect(off.listeners.size).toBe(0);
    const on = fakeDocument(true);
    installAudioWarmFrame(on.doc as never, ["electron", "--openreel-audio-warm"], "--openreel-audio-warm");
    expect(on.listeners.has("DOMContentLoaded")).toBe(true);
  });
});

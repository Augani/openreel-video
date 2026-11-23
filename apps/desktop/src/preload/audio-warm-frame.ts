/**
 * Pays the audio service's first-use cost (device discovery, 50-160 ms) in a throw-away frame process,
 * in parallel with the renderer's own start-up, so the editor's first `new AudioContext()` does not
 * block on it. The frame is a page from another scheme (`openreel-warm`, served by main/protocol.ts),
 * which Chromium isolates in its own renderer process. It is removed again once it has loaded.
 * Needs `AudioServiceLaunchOnStartup` (main/gpu/switches.ts). See apps/desktop/PERF.md, "Cold start round 3".
 */
const WARM_URL = "openreel-warm://audio/warm.html";
const REMOVE_AFTER_LOAD_MS = 1500;
const REMOVE_AFTER_MS = 10_000;

interface FrameLike {
  src: string;
  tabIndex: number;
  style: { cssText: string };
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: () => void, options?: { once: boolean }): void;
  remove(): void;
}

interface DocumentLike {
  body: { appendChild(node: never): unknown } | null;
  createElement(tag: "iframe"): FrameLike;
  addEventListener(type: "DOMContentLoaded", listener: () => void, options?: { once: boolean }): void;
}

export function insertAudioWarmFrame(doc: DocumentLike, schedule: (fn: () => void, ms: number) => unknown = setTimeout): void {
  try {
    if (!doc.body) return;
    const frame = doc.createElement("iframe");
    frame.src = WARM_URL;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none";
    frame.addEventListener("load", () => schedule(() => frame.remove(), REMOVE_AFTER_LOAD_MS), { once: true });
    schedule(() => frame.remove(), REMOVE_AFTER_MS);
    doc.body.appendChild(frame as never);
  } catch {
    // An optimisation only: the editor builds its own AudioContext when the frame cannot be created.
  }
}

/** Inserts the frame at DOMContentLoaded (about 90 ms into the page), the earliest the body exists. */
export function installAudioWarmFrame(doc: DocumentLike, argv: readonly string[], flag: string): void {
  if (!argv.includes(flag)) return;
  doc.addEventListener("DOMContentLoaded", () => insertAudioWarmFrame(doc), { once: true });
}

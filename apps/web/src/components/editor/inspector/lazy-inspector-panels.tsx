import React from "react";
import { retryableLazy } from "./lazy-retry";

/**
 * The inspector shows one tab at a time, and a tab mounts on its first visit, so the heavy per-tab sections (colour,
 * audio, effects, animate, AI, transition and multi-selection inspectors) are not needed to open the editor. They are
 * separate chunks, fetched on idle right after the inspector mounts (`prefetchInspectorPanels`), so the first visit
 * to a tab finds the code already loaded and only ever shows the Suspense fallback on a very slow connection.
 */
type Loader<P> = () => Promise<React.ComponentType<P>>;

const loaders: Array<() => Promise<unknown>> = [];

function lazyPanel<P extends object>(load: Loader<P>): React.FC<P> {
  const panel = retryableLazy<P>(() => load().then((component) => ({ default: component })));
  loaders.push(panel.load);
  // Once the chunk is in, render the component directly: a resolved React.lazy still suspends for one tick on its
  // first render, which would flash an empty tab body on the first visit after the idle prefetch.
  const Wrapped: React.FC<P> = (props) => {
    const loaded = panel.loaded();
    return loaded ? (
      React.createElement(loaded, props)
    ) : (
      <React.Suspense fallback={null}>{React.createElement(panel.Component, props)}</React.Suspense>
    );
  };
  return Wrapped;
}

export const ColorTab = lazyPanel(() => import("./tabs/ColorTab").then((m) => m.ColorTab));
export const AudioTab = lazyPanel(() => import("./tabs/AudioTab").then((m) => m.AudioTab));
export const SpeedTab = lazyPanel(() => import("./tabs/SpeedTab").then((m) => m.SpeedTab));
export const AnimateTab = lazyPanel(() => import("./tabs/AnimateTab").then((m) => m.AnimateTab));
export const StyleTab = lazyPanel(() => import("./tabs/StyleTab").then((m) => m.StyleTab));
export const EffectsTab = lazyPanel(() => import("./tabs/EffectsTab").then((m) => m.EffectsTab));
export const AiTab = lazyPanel(() => import("./tabs/AiTab").then((m) => m.AiTab));
export const TransitionInspector = lazyPanel(() =>
  import("./TransitionInspector").then((m) => m.TransitionInspector),
);
export const MultiClipInspector = lazyPanel(() =>
  import("./MultiClipInspector").then((m) => m.MultiClipInspector),
);
export const GraphicInspector = lazyPanel(() =>
  import("../graphics/GraphicInspector").then((m) => m.GraphicInspector),
);

/** Resolve once every inspector panel chunk is loaded (tests and idle prefetch use this). */
export async function loadInspectorPanels(): Promise<void> {
  await Promise.all(loaders.map((load) => load()));
}

let prefetched = false;
/** Fetch every inspector panel chunk while the main thread is idle. Safe to call more than once. */
export function prefetchInspectorPanels(): void {
  if (prefetched) return;
  prefetched = true;
  const run = (): void => {
    for (const load of loaders) void load().catch(() => undefined);
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

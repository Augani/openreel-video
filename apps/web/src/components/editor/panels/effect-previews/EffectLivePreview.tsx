import React, { Component, Suspense, lazy, useState } from "react";
import type { EffectPreviewEngine, PreviewEffectDef } from "./preview-engine";
import { EffectPreviewContext, effectPreviewsSupported } from "./preview-context";

/**
 * Thin shell for the real-footage previews. The pipeline itself (engine, window loader, caches, renderer,
 * card component) lives in EffectPreviewRuntime and is fetched with a dynamic import the first time an Effects
 * or Transitions panel mounts, so none of it is part of the editor chunk.
 */
const loadRuntime = () => import("./EffectPreviewRuntime");
const LazyController = lazy(() => loadRuntime().then((m) => ({ default: m.EffectPreviewController })));
const LazyCard = lazy(() => loadRuntime().then((m) => ({ default: m.EffectLivePreviewCard })));

export { effectPreviewsSupported };

/**
 * A failed chunk fetch (offline, stale deploy) must not take the panel down: the cards fall back to their
 * poster-less placeholder and the rest of the panel keeps working.
 */
class PreviewBoundary extends Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[effect-previews] preview runtime unavailable:", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const EffectPreviewProvider: React.FC<{
  children: React.ReactNode;
  /** Cards get the footage uncropped at its own aspect (the Overlays cards lay the sequence frame out themselves). */
  natural?: boolean;
}> = ({ children, natural }) => {
  const [engine, setEngine] = useState<EffectPreviewEngine | null>(null);
  return (
    <EffectPreviewContext.Provider value={engine}>
      {effectPreviewsSupported() ? (
        <PreviewBoundary fallback={null}>
          <Suspense fallback={null}>
            <LazyController onEngine={setEngine} natural={natural} />
          </Suspense>
        </PreviewBoundary>
      ) : null}
      {children}
    </EffectPreviewContext.Provider>
  );
};

const placeholder = <div aria-hidden="true" className="absolute inset-0 bg-bg-2" />;

/** Shown when the preview runtime cannot run at all (no WebCodecs / ImageBitmap) or its chunk failed to load. */
const unavailable = (
  <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-bg-3 px-2 text-center text-[9px] text-fg-3">
    Preview unavailable
  </div>
);

export const EffectLivePreview: React.FC<{ def: PreviewEffectDef; active: boolean }> = ({ def, active }) =>
  effectPreviewsSupported() ? (
    <PreviewBoundary fallback={unavailable}>
      <Suspense fallback={placeholder}>
        <LazyCard def={def} active={active} />
      </Suspense>
    </PreviewBoundary>
  ) : (
    unavailable
  );

/**
 * Hover / keyboard-focus state of a card, for the live preview. Focus counts only when it came from the keyboard,
 * so a mouse click does not start the loop. Spread `handlers` on the card's button.
 */
export function useLivePreviewActivity(): {
  active: boolean;
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: (event: React.FocusEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
} {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return {
    active: hover || focus,
    handlers: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onFocus: (event) => {
        try {
          setFocus(event.currentTarget.matches(":focus-visible"));
        } catch {
          setFocus(true);
        }
      },
      onBlur: () => setFocus(false),
    },
  };
}

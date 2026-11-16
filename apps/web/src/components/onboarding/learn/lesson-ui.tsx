import type { JSX } from "react";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import {
  lessonKeysSignature,
  renderLessonText,
  resolveLessonKeys,
  type LessonKeys,
} from "./lesson-keys";

/** Re-renders when the user focuses the window or another tab changes bindings (preset switches). */
function subscribeKeys(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("keyup", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("keyup", onChange);
  };
}

/** The live split/delete bindings. The signature string is the snapshot, so React re-renders only on a real change. */
export function useLiveLessonKeys(): LessonKeys {
  useSyncExternalStore(subscribeKeys, lessonKeysSignature, lessonKeysSignature);
  return resolveLessonKeys();
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
    const mql = window.matchMedia(REDUCED_MOTION);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  const get = () =>
    typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED_MOTION).matches;
  return useSyncExternalStore(subscribe, get, () => false);
}

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="mx-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded border border-border-strong bg-bg-2 px-1.5 py-0.5 font-mono text-2xs font-medium text-fg">
      {children}
    </kbd>
  );
}

export function LessonText({ template, keys }: { template: string; keys: LessonKeys }): JSX.Element {
  return (
    <>
      {renderLessonText(template, keys).map((part, i) =>
        part.type === "key" ? <Kbd key={i}>{part.label}</Kbd> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

/** Shared button look for the bar, the hub and the finish card. */
export function lessonButton(kind: "primary" | "solid" | "quiet"): string {
  const base =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50";
  if (kind === "solid") return `${base} bg-accent text-accent-fg hover:bg-accent-strong`;
  if (kind === "primary") return `${base} bg-accent-soft text-accent hover:bg-accent/20`;
  return `${base} text-fg-2 hover:bg-hover hover:text-fg`;
}

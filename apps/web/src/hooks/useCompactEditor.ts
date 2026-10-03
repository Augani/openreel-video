import { useSyncExternalStore } from "react";

export const COMPACT_EDITOR_QUERY = "(max-width: 1100px), (pointer: coarse) and (max-width: 1366px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(COMPACT_EDITOR_QUERY);
  media.addEventListener("change", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

export function useCompactEditor(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth <= 1100 || window.matchMedia(COMPACT_EDITOR_QUERY).matches,
    () => false,
  );
}

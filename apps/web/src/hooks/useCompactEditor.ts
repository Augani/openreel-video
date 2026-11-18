import { useSyncExternalStore } from "react";

// A narrow desktop window still needs the desktop editing workspace.
const COMPACT_EDITOR_QUERY = "(max-width: 1366px) and (hover: none) and (pointer: coarse)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(COMPACT_EDITOR_QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

export function useCompactEditor(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_EDITOR_QUERY).matches,
    () => false,
  );
}

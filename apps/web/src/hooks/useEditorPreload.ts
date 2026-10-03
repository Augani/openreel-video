import { useEffect } from "react";

let preloadPromise: Promise<unknown> | null = null;

export function useEditorPreload(shouldPreload: boolean): void {
  useEffect(() => {
    if (!shouldPreload || preloadPromise) return;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) return;

    const preload = () => {
      if (preloadPromise) return;
      preloadPromise = import("../components/editor/EditorInterface").catch((error) => {
        preloadPromise = null;
        console.warn("[Editor] Background preload failed:", error);
      });
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(handle);
  }, [shouldPreload]);
}

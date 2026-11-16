import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useOnboardingStore, type OnboardingSheet } from "../../../stores/onboarding-store";
import type { SheetComponent } from "../types";

/**
 * Mounted once in DesktopApp (itself lazy), so the sheets work on every route, including the editor.
 * Chunks load only when a sheet is opened: the AI stack is never pulled in before A1.
 */

type SheetKey = "ai" | "learn" | "pro" | "agent";

const loaders: Record<SheetKey, () => Promise<{ default: SheetComponent }>> = {
  ai: () => import("../ai"),
  learn: () => import("../learn"),
  pro: () => import("../pro"),
  agent: () => import("../agent"),
};

const lazySheets: Record<SheetKey, React.LazyExoticComponent<SheetComponent>> = {
  ai: lazy(loaders.ai),
  learn: lazy(loaders.learn),
  pro: lazy(loaders.pro),
  agent: lazy(loaders.agent),
};

export function sheetKeyFor(sheet: OnboardingSheet): SheetKey {
  switch (sheet) {
    case "ai":
      return "ai";
    case "learn":
    case "lessons":
      return "learn";
    case "custom-sequence":
      return "pro";
    case "agent":
      return "agent";
  }
}

const MENU_OWNERS = "[role=menu], [role=listbox], [role=combobox][aria-expanded=true]";

class SheetBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    console.warn("[onboarding] sheet failed to load", error);
    this.props.onFail();
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function useEditorRoute(): boolean {
  const [editor, setEditor] = useState(() => window.location.hash.startsWith("#/editor"));
  useEffect(() => {
    const update = () => setEditor(window.location.hash.startsWith("#/editor"));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return editor;
}

export default function OnboardingHost() {
  const openSheet = useOnboardingStore((s) => s.openSheet);
  const editorRoute = useEditorRoute();
  const returnFocus = useRef<Element | null>(null);

  const close = useCallback(() => useOnboardingStore.getState().closeSheet(), []);

  useEffect(() => {
    if (!openSheet) return;
    returnFocus.current = document.activeElement;
    // Esc closes the sheet and nothing else (capture phase, so welcome and app Esc handlers stay out).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(MENU_OWNERS)) return;
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const previous = returnFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [openSheet, close]);

  if (!openSheet) return null;
  const key = sheetKeyFor(openSheet);
  const Sheet = lazySheets[key];
  return (
    <>
      {editorRoute && (
        // The welcome route already has a 44px drag bar; the editor route does not. Keep the macOS
        // traffic lights (top-left 80px) clear.
        <div
          aria-hidden
          data-testid="onboarding-drag-strip"
          className="fixed left-20 right-0 top-0 z-[60] h-11"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      )}
      <SheetBoundary key={openSheet} onFail={close}>
        <Suspense fallback={null}>
          <Sheet onClose={close} />
        </Suspense>
      </SheetBoundary>
    </>
  );
}

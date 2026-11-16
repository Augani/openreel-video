import type { JSX } from "react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { X } from "../../../icons/lucide-compat";

const DRAG: CSSProperties = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG: CSSProperties = { WebkitAppRegion: "no-drag" } as CSSProperties;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SheetFrameProps {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider card for the hub. */
  wide?: boolean;
}

/**
 * Full-screen sheet shell for the Learn views: `fixed inset-0 z-50 pt-11` with its own drag strip (the
 * top-left 80x40 stays empty for the macOS traffic lights), Esc to close, a small focus trap, and focus
 * restore. Opacity-only motion, so it is reduced-motion safe by construction.
 */
export function SheetFrame({ labelledBy, onClose, children, wide }: SheetFrameProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    // Capture phase, so Esc closes the sheet and does not fall through to the router's Esc-to-editor.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      data-testid="learn-sheet"
      className="fixed inset-0 z-50 flex flex-col bg-bg/95 pt-11 backdrop-blur-md animate-in fade-in duration-200 motion-reduce:animate-none"
    >
      <div className="fixed inset-x-0 top-0 h-11" style={DRAG} aria-hidden="true" />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={NO_DRAG}
        className="absolute right-4 top-14 grid h-8 w-8 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <X size={16} aria-hidden="true" />
      </button>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-10">
        <div className={`w-full ${wide ? "max-w-2xl" : "max-w-xl"}`}>{children}</div>
      </div>
    </div>
  );
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { GraduationCap, Keyboard, Plug, Sparkles } from "@/icons/lucide-compat";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { useOnboardingGate } from "./useOnboardingGate";

// The pro row pulls in keyboard-shortcuts and project-replacement, so it stays out of the welcome chunk
// and loads on first open of the "I already edit" tile.
const ProRowSlot = lazy(() => import("./ProRowSlot").then((m) => ({ default: m.ProRowSlot })));

/**
 * The first-run path band (spec 2.2). Eager, static JSX and CSS transitions only: no framer-motion,
 * no images, no fonts. It sits in the page flow above the format cards and never overlaps them, so
 * the "Horizontal" button stays clickable for people and for the perf and e2e harnesses.
 */

const COLLAPSE_MS = 200;

const ESC_OWNERS =
  "input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox], [role=combobox]";

interface Tile {
  id: "ai" | "learn" | "pro";
  title: string;
  body: string;
  Icon: typeof Sparkles;
}

const TILES: Tile[] = [
  {
    id: "ai",
    title: "Edit with AI",
    body: "Describe the video you want. The AI cuts, trims and titles. Undo any step.",
    Icon: Sparkles,
  },
  {
    id: "learn",
    title: "Learn to edit",
    body: "Six short, hands-on lessons on a real project. About 10 minutes.",
    Icon: GraduationCap,
  },
  {
    id: "pro",
    title: "I already edit",
    body: "Premiere, Resolve or Final Cut? Keys, import, your layout.",
    Icon: Keyboard,
  },
];

export function PathBand() {
  const gate = useOnboardingGate();
  const status = useOnboardingStore((s) => s.status);
  // Starting a path from the band (a key chip, a tile) moves the status to "in-progress". Keep the band
  // up for the rest of this visit so the user can finish choosing; Done, Skip or a format card closes it.
  const [shownThisVisit, setShownThisVisit] = useState(gate.showBand);
  if (gate.showBand && !shownThisVisit) setShownThisVisit(true);
  const showBand = gate.showBand || (shownThisVisit && status === "in-progress");
  const [present, setPresent] = useState(showBand);
  const [open, setOpen] = useState(showBand);

  // Collapse with a short height transition, then unmount. Mounting is immediate (first paint).
  useEffect(() => {
    if (showBand) {
      setPresent(true);
      setOpen(true);
      return;
    }
    setOpen(false);
    const timer = window.setTimeout(() => setPresent(false), COLLAPSE_MS + 20);
    return () => window.clearTimeout(timer);
  }, [showBand]);

  if (!present) return null;
  return (
    <div
      data-testid="onboarding-path-band"
      data-state={open ? "open" : "closed"}
      className="mb-4 grid w-full transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-opacity"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
    >
      <div
        className={open ? "min-h-0" : "min-h-0 overflow-hidden"}
        inert={!open}
        aria-hidden={!open}
      >
        <BandContent live={showBand} />
      </div>
    </div>
  );
}

function BandContent({ live }: { live: boolean }) {
  const openSheet = useOnboardingStore((s) => s.openSheet);
  const [proOpen, setProOpen] = useState(false);
  const [rover, setRover] = useState(0);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const dismiss = useCallback(() => useOnboardingStore.getState().skip("user"), []);

  useEffect(() => {
    try {
      performance.mark("openreel:onboarding-visible");
    } catch {
      // Marks are diagnostics only.
    }
  }, []);

  // Esc dismisses the band only. Capture phase + stopPropagation, so the editor-entering Esc handlers
  // on the app and the welcome screen never run for this press (spec section 1).
  useEffect(() => {
    if (!live || openSheet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(ESC_OWNERS)) return;
      e.stopPropagation();
      e.preventDefault();
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [live, openSheet, dismiss]);

  const select = useCallback((id: Tile["id"]) => {
    const store = useOnboardingStore.getState();
    if (id === "pro") {
      store.setPersona("pro");
      setProOpen((v) => !v);
      return;
    }
    store.setPersona(id);
    store.showSheet(id);
  }, []);

  const onTileKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TILES.length - 1;
    let next = index;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    setRover(next);
    tileRefs.current[next]?.focus();
  };

  return (
    <section
      role="group"
      aria-label="Choose how to start"
      className="rounded-2xl border border-border bg-bg-1 p-3"
    >
      <h2 className="mb-2 px-1 text-sm font-semibold tracking-tight text-fg">
        How do you want to start?
      </h2>
      <div className="grid grid-cols-3 gap-2 max-[1099px]:grid-cols-1" data-testid="onboarding-tiles">
        {TILES.map((tile, index) => {
          const expanded = tile.id === "pro" ? proOpen : undefined;
          return (
            <button
              key={tile.id}
              ref={(el) => {
                tileRefs.current[index] = el;
              }}
              type="button"
              tabIndex={rover === index ? 0 : -1}
              aria-expanded={expanded}
              aria-controls={tile.id === "pro" ? "onboarding-pro-row" : undefined}
              onFocus={() => setRover(index)}
              onKeyDown={(e) => onTileKeyDown(e, index)}
              onClick={() => select(tile.id)}
              className="group flex min-w-0 items-start gap-3 rounded-xl border border-border bg-bg-2 p-3 text-left outline-none transition-[border-color,box-shadow,background-color] duration-150 hover:border-accent/40 hover:shadow-glow focus-visible:border-accent/60 focus-visible:shadow-glow focus-visible:ring-2 focus-visible:ring-accent max-[1099px]:items-center max-[1099px]:py-2 motion-reduce:transition-none aria-expanded:border-accent/50"
            >
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent max-[1099px]:h-7 max-[1099px]:w-7"
              >
                <tile.Icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-5 text-fg">{tile.title}</span>
                <span className="block text-xs leading-4 text-fg-3 max-[1099px]:truncate">
                  {tile.body}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {proOpen && (
        <Suspense fallback={<div id="onboarding-pro-row" aria-busy="true" className="mt-2 h-10" />}>
          <ProRowSlot />
        </Suspense>
      )}
      <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-fg-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <Plug size={12} aria-hidden className="shrink-0" />
          <span className="truncate">
            Using Claude Code, Cursor or another agent?{" "}
            <button
              type="button"
              onClick={() => useOnboardingStore.getState().showSheet("agent")}
              className="rounded font-medium text-accent outline-none underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent"
            >
              Connect an agent
            </button>
          </span>
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="flex shrink-0 items-center gap-1.5 rounded text-fg-3 outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        >
          Skip setup
          <kbd className="rounded border border-border bg-bg-2 px-1.5 font-mono text-2xs text-fg-3">
            Esc
          </kbd>
        </button>
      </div>
    </section>
  );
}

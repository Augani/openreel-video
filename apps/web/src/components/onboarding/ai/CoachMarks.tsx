import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useChatStore } from "../../../stores/chat-store";
import { useCoachStore, type CoachStep } from "./coach-store";

interface MarkCopy {
  readonly title: string;
  readonly body: string;
  readonly button: string;
}

export const COACH_COPY: Record<CoachStep, MarkCopy> = {
  watch: {
    title: "Watch each step appear",
    body: "The AI works through your timeline one tool at a time. Every step shows up here as it happens.",
    button: "Got it",
  },
  undo: {
    title: "Don't like it? Undo AI edit puts everything back",
    body: "Open Assistant actions and choose Undo last AI turn. Each AI turn is a single undo step.",
    button: "Got it",
  },
  export: {
    title: "Happy? Open Export",
    body: "The AI can only open the Export dialog. You choose the settings and start the render.",
    button: "Done",
  },
};

/** Finds the on-screen element a mark points at. */
export function coachTarget(step: CoachStep, root: ParentNode = document): HTMLElement | null {
  if (step === "watch") return root.querySelector<HTMLElement>('[data-tour="ai-chat"]');
  if (step === "undo") return root.querySelector<HTMLElement>('[data-tour="ai-actions"]');
  const buttons = Array.from(root.querySelectorAll<HTMLElement>("button"));
  return buttons.find((b) => b.textContent?.trim() === "Export") ?? root.querySelector<HTMLElement>('[data-tour="ai-chat"]');
}

const WIDTH = 288;
const GAP = 10;

interface Placement {
  left: number;
  top: number;
  arrowLeft: number;
  above: boolean;
}

/** Place the card under (or beside) the target, clamped to the window. Pure for testing. */
export function placeCoachCard(
  step: CoachStep,
  rect: { left: number; top: number; right: number; bottom: number },
  viewport: { width: number; height: number },
  cardHeight: number,
): Placement {
  const margin = 12;
  let left: number;
  let top: number;
  let above = false;
  if (step === "watch") {
    // Beside the docked chat: to its left, near the top of the log.
    left = rect.left - WIDTH - GAP;
    top = rect.top + 96;
    if (left < margin) left = Math.max(margin, rect.left + 12);
  } else {
    left = rect.right - WIDTH;
    top = rect.bottom + GAP;
    if (top + cardHeight > viewport.height - margin) {
      top = rect.top - GAP - cardHeight;
      above = true;
    }
  }
  left = Math.min(Math.max(margin, left), Math.max(margin, viewport.width - WIDTH - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, viewport.height - cardHeight - margin));
  const anchorX = step === "watch" ? rect.left : (rect.left + rect.right) / 2;
  const arrowLeft = Math.min(Math.max(16, anchorX - left), WIDTH - 24);
  return { left, top, arrowLeft, above };
}

/**
 * Non-modal coach marks for the first AI turn. Mounted by the chat panel so they live exactly as
 * long as the docked chat does. No scrim and no focus capture: the user keeps editing.
 */
export default function CoachMarks(): JSX.Element | null {
  const active = useCoachStore((s) => s.active);
  const status = useChatStore((s) => s.status);
  const lastEdited = useChatStore((s) => {
    const last = s.messages[s.messages.length - 1];
    return Boolean(last?.editSummary && !last.editSummary.undone);
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // The first turn drives the sequence: finished with edits -> undo mark; failed -> stop quietly.
  useEffect(() => {
    const s = useCoachStore.getState();
    if (!s.armed) return;
    if (status === "error") {
      if (s.active === "watch") s.finish();
      return;
    }
    if (status === "idle" && lastEdited) {
      if (s.active === "watch") s.dismiss("undo");
      else if (!s.active && !s.seen.includes("undo")) s.show("undo");
    }
  }, [status, lastEdited, active]);

  useLayoutEffect(() => {
    if (!active) {
      setPlacement(null);
      return;
    }
    const update = (): void => {
      const target = coachTarget(active);
      if (!target) {
        setPlacement(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setPlacement(
        placeCoachCard(
          active,
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          cardRef.current?.offsetHeight ?? 150,
        ),
      );
    };
    update();
    window.addEventListener("resize", update);
    const timer = window.setInterval(update, 500);
    return () => {
      window.removeEventListener("resize", update);
      window.clearInterval(timer);
    };
  }, [active]);

  if (!active || !placement) return null;
  const copy = COACH_COPY[active];
  const next: CoachStep | undefined = active === "undo" ? "export" : undefined;

  return createPortal(
    <div
      ref={cardRef}
      role="note"
      aria-label={copy.title}
      data-coach-mark={active}
      className="fixed z-[90] rounded-xl border border-accent/40 bg-bg-1 p-3.5 text-left shadow-glow-lg motion-safe:transition-opacity motion-safe:duration-200"
      style={{ left: placement.left, top: placement.top, width: WIDTH }}
    >
      <span
        aria-hidden="true"
        className="absolute h-2.5 w-2.5 rotate-45 border-accent/40 bg-bg-1"
        style={{
          left: placement.arrowLeft - 5,
          ...(placement.above
            ? { bottom: -6, borderRight: "1px solid", borderBottom: "1px solid" }
            : { top: -6, borderLeft: "1px solid", borderTop: "1px solid" }),
        }}
      />
      <div className="text-[13px] font-semibold leading-snug text-fg">{copy.title}</div>
      <p className="mt-1 text-xs leading-relaxed text-fg-2">{copy.body}</p>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          className="rounded text-xs text-fg-3 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => useCoachStore.getState().finish()}
        >
          Skip tips
        </button>
        <button
          type="button"
          className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => {
            if (next) useCoachStore.getState().dismiss(next);
            else if (active === "export") useCoachStore.getState().finish();
            else useCoachStore.getState().dismiss();
          }}
        >
          {copy.button}
        </button>
      </div>
    </div>,
    document.body,
  );
}

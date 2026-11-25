import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@openreel/ui";
import { X, Plus } from "lucide-react";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import type { TransitionType } from "@openreel/core";
import type { ResolvedTransitionHandle } from "./transition-handles";
import { useProjectStore } from "../../../stores/project-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { TRANSITION_CARDS } from "../../../bridges/transition-cards";
import { toast } from "../../../stores/notification-store";
import { selectEditPoint } from "../../../services/edit-point-commands";
import { openTrimMonitor } from "../../../services/trim-monitor";
import { useMorphCutState } from "../inspector/MorphCutControls";

/** "Analysing in background" pill on a Morph Cut cut while its analysis runs; Cancel stops it (the cut stays a dissolve). */
const MorphCutAnalysingBadge: React.FC<{ transitionId: string }> = ({ transitionId }) => {
  const state = useMorphCutState(transitionId);
  if (state.status !== "analysing") return null;
  return (
    <div
      className="pointer-events-auto absolute left-3 top-0 flex items-center gap-1 whitespace-nowrap rounded-[3px] border border-accent bg-bg-2 px-1 text-[9px] text-fg"
      data-testid="morph-cut-badge"
      role="status"
    >
      <span>Analysing in background {Math.round(state.progress * 100)}%</span>
      <button
        type="button"
        className="underline"
        aria-label="Cancel Morph Cut analysis"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void import("@openreel/core/video/morph-cut/analyse-job").then((m) => m.cancelMorphCutAnalysis(transitionId));
        }}
      >
        Cancel
      </button>
    </div>
  );
};

const BADGE_SIZE = 18;
const DOUBLE_CLICK_MS = 450;
const DOUBLE_CLICK_SLOP_PX = 4;
const TRIM_TOOLS: ReadonlySet<string> = new Set(["ripple", "roll", "stretch", "slip", "slide", "hand", "zoom"]);

interface TransitionHandleProps {
  handle: ResolvedTransitionHandle;
  trackId: string;
  isSelected: boolean;
  onSelect: (transitionId: string, trackId: string) => void;
}

/**
 * TrackLane re-resolves its handles on every project change, so each render hands
 * over a fresh `handle` object even when nothing about this cut changed. Compare
 * its fields instead of its identity so an edit elsewhere does not rebuild the
 * whole Radix dropdown tree of every cut.
 */
export function areTransitionHandlePropsEqual(
  prev: TransitionHandleProps,
  next: TransitionHandleProps,
): boolean {
  const a = prev.handle;
  const b = next.handle;
  return (
    prev.trackId === next.trackId &&
    prev.isSelected === next.isSelected &&
    prev.onSelect === next.onSelect &&
    a.clipA === b.clipA &&
    a.clipB === b.clipB &&
    a.transition === b.transition &&
    a.edge === b.edge &&
    a.centerX === b.centerX
  );
}

export const TransitionHandle: React.FC<TransitionHandleProps> = React.memo(function TransitionHandle({
  handle,
  trackId,
  isSelected,
  onSelect,
}) {
  const { centerX, transition, clipA, clipB, edge } = handle;
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  // Arming moves the badge inside the dropdown tree, which remounts the button. Carry keyboard focus
  // over to the new element, otherwise Tab -> Enter / Shift+F10 would find focus on <body>.
  const rootRef = useRef<HTMLDivElement>(null);
  const refocusRef = useRef(false);
  useLayoutEffect(() => {
    if (armed && refocusRef.current) {
      refocusRef.current = false;
      rootRef.current?.querySelector<HTMLElement>("[data-timeline-transition]")?.focus();
    }
  }, [armed]);
  // The badge sits on the cut, exactly where Ripple/Roll/Rate Stretch grab the
  // clip edges. While a trim tool is active it must not swallow those drags; the
  // Hand and Zoom tools never open anything by clicking, and an opened menu would
  // swallow their press (Radix locks pointer events on the page).
  // The badge covers the middle of the cut, so a double-click on the cut lands on it. A single click still
  // opens the transition menu; a second press on the badge within the double-click window instead closes
  // that menu and opens the Trim Monitor on the cut. This listens on the document (capture) because the
  // open menu locks pointer events on the page, so the second press never reaches the badge itself.
  const cancelSecondPress = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelSecondPress.current?.(), []);
  const watchForDoublePress = (first: React.PointerEvent<HTMLButtonElement>) => {
    if (first.button !== 0 || first.ctrlKey) return;
    cancelSecondPress.current?.();
    const { timeStamp, clientX, clientY } = first;
    const onSecond = (event: PointerEvent) => {
      cancelSecondPress.current?.();
      if (event.button !== 0 || event.ctrlKey || event.timeStamp - timeStamp > DOUBLE_CLICK_MS ||
          Math.hypot(event.clientX - clientX, event.clientY - clientY) > DOUBLE_CLICK_SLOP_PX) return;
      if (!clipB && !edge) return;
      setOpen(false);
      selectEditPoint(clipB?.id ?? clipA.id, clipB || edge === "in" ? "left" : "right");
      openTrimMonitor();
      // The dropdown trigger also receives this press. Close it after its toggle.
      window.setTimeout(() => setOpen(false), 0);
    };
    const cancel = () => {
      document.removeEventListener("pointerdown", onSecond, true);
      window.clearTimeout(timer);
      cancelSecondPress.current = null;
    };
    const timer = window.setTimeout(cancel, DOUBLE_CLICK_MS);
    cancelSecondPress.current = cancel;
    document.addEventListener("pointerdown", onSecond, true);
  };
  const trimToolActive = useEditorWorkspaceStore((state) =>
    TRIM_TOOLS.has(state.timelineTool),
  );

  const { addClipTransition, updateClipTransition, removeClipTransition } =
    useProjectStore(useShallow((state) => ({
      addClipTransition: state.addClipTransition,
      updateClipTransition: state.updateClipTransition,
      removeClipTransition: state.removeClipTransition,
    })));
  const bridge = getTransitionBridge();
  const types = TRANSITION_CARDS;

  const applyType = useCallback(
    async (type: TransitionType) => {
      setOpen(false);
      if (transition) {
        await updateClipTransition(transition.id, { type });
        toast.success("Transition updated", type);
        return;
      }
      if (!bridge.isInitialized()) {
        toast.error("Transition engine not ready", "Try again in a moment.");
        return;
      }
      const params = bridge.getDefaultParams(type);
      const duration = useEditorWorkspaceStore.getState().transitionDuration;
      const result = clipB
        ? bridge.createTransition(clipA, clipB, type, duration, params)
        : bridge.createClipEdgeTransition(
            clipA,
            edge ?? "out",
            type,
            duration,
            params,
          );
      if (result.success && result.transitionId) {
        const created = bridge.getTransition(result.transitionId);
        if (created) {
          const saved = await addClipTransition(created);
          if (!saved) {
            toast.error("Transition failed", "The edit could not be saved.");
            return;
          }
          onSelect(saved.id, trackId);
          toast.success(
            "Transition added",
            `${type} · ${saved.duration.toFixed(1)}s`,
          );
          return;
        }
      }
      toast.error(
        "Transition failed",
        result.error || "Could not create transition",
      );
    },
    [
      transition,
      clipA,
      clipB,
      edge,
      addClipTransition,
      updateClipTransition,
      bridge,
      onSelect,
      trackId,
    ],
  );

  const handleRemove = useCallback(async () => {
    setOpen(false);
    if (!transition) return;
    await removeClipTransition(transition.id);
    toast.success("Transition removed", "Hard cut restored");
  }, [transition, removeClipTransition]);

  const label = transition
    ? `${transition.type} · ${transition.duration.toFixed(1)}s`
    : edge === "in"
      ? "Add intro transition"
      : edge === "out"
        ? "Add outro transition"
        : "Add transition";
  const ariaLabel = edge
    ? `Edit ${edge === "in" ? "intro" : "outro"} transition: ${label}`
    : `Edit transition between clips: ${label}`;
  const isActive = Boolean(transition) || isSelected || open;

  const arm = () => setArmed(true);
  const armWithFocus = () => {
    refocusRef.current = true;
    setArmed(true);
  };
  const button = (
    <Button
      type="button"
      variant="ghost"
      title={label}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      data-transition-id={transition?.id}
      data-timeline-transition
      // Until the pointer or focus reaches the badge it is a plain button: the Radix dropdown chain
      // (about 15 components per cut, hundreds per lane) mounts on first contact instead of with every cut.
      onPointerDownCapture={watchForDoublePress}
      onPointerEnter={arm}
      onFocus={armWithFocus}
      onPointerDown={armed ? undefined : (e) => {
        // No hover first (touch): open straight away.
        if (e.button === 0 && !e.ctrlKey) {
          // The remount below swallows the click that would select the cut, so select it here.
          if (transition) onSelect(transition.id, trackId);
          setArmed(true);
          setOpen(true);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (transition) onSelect(transition.id, trackId);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (transition) onSelect(transition.id, trackId);
        refocusRef.current = true;
        setArmed(true);
        setOpen(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "F10" && e.shiftKey) {
          e.preventDefault();
          refocusRef.current = true;
          setArmed(true);
          setOpen(true);
        }
      }}
      className={`${trimToolActive ? "pointer-events-none" : "pointer-events-auto"} flex items-center justify-center rounded-[3px] p-0 border transition-colors ${isActive ? "border-accent bg-accent/20 text-fg" : "border-border-strong bg-bg-2 text-fg-muted hover:border-accent"}`}
      style={{
        width: BADGE_SIZE,
        height: transition ? 34 : 18,
        marginLeft: -(BADGE_SIZE / 2),
      }}
    >
      {transition ? <X size={12} /> : <Plus size={12} />}
    </Button>
  );

  return (
    <div
      ref={rootRef}
      className="absolute top-0 bottom-0 z-30 flex items-center pointer-events-none"
      style={{ left: centerX }}
    >
      {transition?.type === "morphCut" && <MorphCutAnalysingBadge transitionId={transition.id} />}
      {!armed ? button : (
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (!next || !transition) setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-52 max-h-72 overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuLabel>Transition</DropdownMenuLabel>
          {transition && (
            <>
              <DropdownMenuItem
                className="text-red-400"
                onSelect={() => void handleRemove()}
              >
                Remove transition
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {types.map((type) => (
            <DropdownMenuItem
              key={type.type}
              className={transition?.type === type.type ? "text-accent" : ""}
              onSelect={() => void applyType(type.type)}
            >
              {type.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      )}
    </div>
  );
}, areTransitionHandlePropsEqual);

import React, { useCallback, useState } from "react";
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
import { toast } from "../../../stores/notification-store";

const BADGE_SIZE = 18;
const TRIM_TOOLS: ReadonlySet<string> = new Set(["ripple", "roll", "stretch", "slip", "slide", "hand", "zoom"]);

interface TransitionHandleProps {
  handle: ResolvedTransitionHandle;
  trackId: string;
  isSelected: boolean;
  onSelect: (transitionId: string, trackId: string) => void;
}

export const TransitionHandle: React.FC<TransitionHandleProps> = ({
  handle,
  trackId,
  isSelected,
  onSelect,
}) => {
  const { centerX, transition, clipA, clipB, edge } = handle;
  const [open, setOpen] = useState(false);
  // The badge sits on the cut, exactly where Ripple/Roll/Rate Stretch grab the
  // clip edges. While a trim tool is active it must not swallow those drags; the
  // Hand and Zoom tools never open anything by clicking, and an opened menu would
  // swallow their press (Radix locks pointer events on the page).
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
  const types = bridge.getAvailableTransitionTypes();

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

  return (
    <div
      className="absolute top-0 bottom-0 z-30 flex items-center pointer-events-none"
      style={{ left: centerX }}
    >
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (!next || !transition) setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            title={label}
            aria-label={ariaLabel}
            aria-pressed={isSelected}
            data-transition-id={transition?.id}
            data-timeline-transition
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (transition) onSelect(transition.id, trackId);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (transition) onSelect(transition.id, trackId);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "F10" && e.shiftKey) {
                e.preventDefault();
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
        </DropdownMenuTrigger>
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
    </div>
  );
};

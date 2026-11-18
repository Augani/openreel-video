import { useCallback, useEffect, useRef, type ComponentProps } from "react";
import { Slider } from "@openreel/ui";
import type { ActionHistory } from "@openreel/core";
import { useProjectStore } from "../../../../stores/project-store";

const adjustmentKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
type InputKind = "pointer" | "keyboard" | "discrete";

/** Group synchronous authoring updates without changing the shadcn control. */
export function InspectorSlider({ historyKey, onValueChange, onValueCommit, onPointerDownCapture, onKeyDownCapture, onKeyUpCapture, onBlurCapture, ...props }:
  ComponentProps<typeof Slider> & { historyKey: string }) {
  const projectId = useProjectStore(state => state.project.id);
  const gesture = useRef<{ history: ActionHistory | null; input: InputKind } | null>(null);
  const finish = useCallback(() => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("pointerdown", finish, true);
    window.removeEventListener("blur", finish);
    active.history?.endGroup();
  }, []);
  const begin = (input: InputKind) => {
    if (gesture.current) return;
    gesture.current = { history: null, input };
    // Capture also closes an unfinished keyboard adjustment before another
    // control starts a pointer gesture. Pointer-up covers no-change drags.
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("pointerdown", finish, true);
    window.addEventListener("blur", finish);
  };
  useEffect(() => finish, [projectId, historyKey, finish]);

  return <Slider {...props}
    onPointerDownCapture={event => {
      onPointerDownCapture?.(event);
      if (!event.defaultPrevented && !props.disabled && event.button === 0) begin("pointer");
    }}
    onKeyDownCapture={event => {
      onKeyDownCapture?.(event);
      if (!event.defaultPrevented && !props.disabled && !event.metaKey && !event.ctrlKey && !event.altKey && adjustmentKeys.has(event.key)) begin("keyboard");
    }}
    onKeyUpCapture={event => {
      onKeyUpCapture?.(event);
      if (gesture.current?.input === "keyboard" && adjustmentKeys.has(event.key)) finish();
    }}
    onBlurCapture={event => {
      onBlurCapture?.(event);
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish();
    }}
    onValueChange={values => {
      // Native accessibility adjustments can arrive without a pointer/key
      // gesture. Treat each as a discrete edit and never leave a group open.
      const discrete = !gesture.current;
      if (discrete) begin("discrete");
      const active = gesture.current!;
      if (!active.history) {
        // Radix focuses its thumb before calling this handler. A pending
        // numeric-field blur can commit separately before this gesture starts.
        active.history = useProjectStore.getState().actionHistory;
        active.history.beginGroup(`Adjust ${props["aria-label"] ?? "clip property"}`);
      }
      try { onValueChange?.(values); }
      finally { if (discrete) finish(); }
    }}
    onValueCommit={values => {
      try { onValueCommit?.(values); }
      finally {
        // Radix commits each keyboard step before its value-change callback;
        // key-up, blur or unmount owns the end of a held-key adjustment.
        if (gesture.current?.input !== "keyboard") finish();
      }
    }}
  />;
}

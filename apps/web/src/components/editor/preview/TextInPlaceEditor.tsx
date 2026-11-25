import { useEffect, useRef } from "react";
import { useTextSelectionStore } from "../../../stores/text-selection-store";
import type { TextClip } from "@openreel/core";
import {
  inPlaceEditorStyle,
  inPlaceKeyAction,
  normalizeEditedText,
  shouldCommitEdit,
} from "./text-inplace-edit";

/**
 * contenteditable overlay for editing a text clip's text directly on the
 * Program monitor. Positioned over the clip's selection bounds. Enter or
 * clicking away commits (one undoable edit), Escape cancels.
 */
export function TextInPlaceEditor({
  clip,
  centerX,
  centerY,
  minWidth,
  displayScale,
  onCommit,
  onCancel,
}: {
  clip: TextClip;
  /** Centre of the clip's bounds in overlay px. */
  centerX: number;
  centerY: number;
  minWidth: number;
  displayScale: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = clip.text;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    // Seed once per edit session; later clip.text changes must not reset typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish the selected character range so the inspector styles exactly those characters.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0);
      const before = document.createRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      useTextSelectionStore.getState().setSelection(clip.id, start, start + range.toString().length);
    };
    document.addEventListener("selectionchange", publish);
    publish();
    return () => document.removeEventListener("selectionchange", publish);
  }, [clip.id]);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const edited = normalizeEditedText(ref.current?.textContent ?? clip.text);
    if (commit && shouldCommitEdit(clip.text, edited)) onCommit(edited);
    else onCancel();
  };

  return (
    <div
      ref={ref}
      data-text-inplace-editor
      role="textbox"
      aria-label="Edit title text"
      aria-multiline="true"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      className="absolute z-30 outline outline-2 outline-primary rounded-sm bg-black/30 px-1 pointer-events-auto cursor-text"
      style={{
        left: centerX,
        top: centerY,
        minWidth,
        width: "max-content",
        ...inPlaceEditorStyle(clip, displayScale),
      }}
      onKeyDown={(event) => {
        // Keep editor keystrokes away from global shortcuts (space, J/K/L, delete...).
        event.stopPropagation();
        const action = inPlaceKeyAction({
          key: event.key,
          shiftKey: event.shiftKey,
          isComposing: event.nativeEvent.isComposing,
        });
        if (action === "commit") {
          event.preventDefault();
          finish(true);
        } else if (action === "cancel") {
          event.preventDefault();
          finish(false);
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
    />
  );
}

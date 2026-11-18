import { useState } from "react";
import { useEditPointStore } from "../../../stores/edit-point-store";
import { toast } from "../../../stores/notification-store";
import {
  parseTrimFrames,
  toggleSelectedEditPointKind,
  trimSelectedEditPoint,
} from "../../../services/edit-point-commands";

/**
 * Numeric trim for the selected edit point: type +N or -N frames and press
 * Enter. Appears only while an edit point is selected. The Ripple/Roll button
 * does what Cmd/Ctrl-clicking the edit point does.
 */
export function EditPointTrimEntry() {
  const kind = useEditPointStore((s) => (s.selection?.type === "edit" ? s.selection.kind : null));
  const [text, setText] = useState("");
  const dynamicEnabled = useEditPointStore((s) => s.dynamicTrimEnabled);
  const dynamic = useEditPointStore((s) => s.dynamicTrim);
  if (!kind) return null;

  const apply = () => {
    const frames = parseTrimFrames(text);
    if (frames === null) {
      toast.warning("Trim edit point", "Type a whole number of frames, like +5 or -3.");
      return;
    }
    const outcome = trimSelectedEditPoint(frames, false);
    if (!outcome.success) toast.warning("Trim edit point", outcome.message);
    else setText("");
  };

  return (
    <div className="flex items-center gap-1 text-xs" data-testid="edit-point-trim-entry">
      <button
        type="button"
        className="px-1.5 py-0.5 rounded border border-border hover:bg-background-secondary"
        title="Toggle Ripple / Roll (Cmd/Ctrl-click the edit point)"
        onClick={toggleSelectedEditPointKind}
      >
        {kind === "roll" ? "Roll" : "Ripple"}
      </button>
      <button
        type="button"
        aria-pressed={dynamicEnabled}
        className={`px-1.5 py-0.5 rounded border border-border hover:bg-background-secondary ${dynamicEnabled ? "bg-background-secondary" : ""}`}
        title="Dynamic trimming: J / K / L trim the selected edit point"
        onClick={() => useEditPointStore.getState().setDynamicTrimEnabled(!dynamicEnabled)}
      >
        JKL
      </button>
      {dynamic && (
        <span
          data-testid="dynamic-trim-indicator"
          role="status"
          title="The Program monitor shows the trimmed result live. K or Space commits, Esc cancels."
          className={dynamic.limited ? "text-warning" : undefined}
        >
          {dynamic.appliedFrames > 0 ? "+" : ""}
          {dynamic.appliedFrames}f{dynamic.limited ? " (limit)" : ""}
        </span>
      )}
      <input
        aria-label="Trim selected edit point by frames"
        className="w-16 px-1 py-0.5 rounded border border-border bg-background text-foreground"
        placeholder="+5 / -3"
        inputMode="numeric"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          } else if (event.key === "Escape") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

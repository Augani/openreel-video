import type { CSSProperties } from "react";
import { Button } from "@openreel/ui";
import { Check, X } from "lucide-react";
import type { ExportRunnerState } from "../../services/export-runner";
import { EditorHeaderIcon } from "./EditorHeaderIcon";

export function EditorExportControl({ state, disabled, compact = false, style, onOpen, onCancel, onDismissError }: {
  state: ExportRunnerState;
  disabled: boolean;
  compact?: boolean;
  style?: CSSProperties;
  onOpen: () => void;
  onCancel: () => void;
  onDismissError: () => void;
}) {
  const status = state.isExporting ? "exporting" : state.error ? "error" : state.complete ? "complete" : "idle";
  const retry = () => { onDismissError(); onOpen(); };
  const title = status === "error" ? state.error!
    : status === "exporting" ? `Cancel export (${Math.round(state.progress)}%)`
      : status === "complete" ? "Export saved"
        : disabled ? "Add media or text to the timeline to export" : "Choose export settings";
  return <Button
    type="button"
    className={compact ? "mobile-editor-export" : "workspace-export"}
    data-editor-export-control=""
    data-export-state={status}
    style={style}
    title={title}
    aria-label={status === "exporting" ? "Cancel export" : status === "error" ? compact ? "Retry export" : "Dismiss export error" : undefined}
    disabled={status === "complete" || (status === "idle" && disabled)}
    onClick={status === "exporting" ? onCancel : status === "error" ? compact ? retry : onDismissError : onOpen}
  >
    {status === "idle" ? <>{!compact && <EditorHeaderIcon kind="export" />}Export</>
      : status === "exporting" ? <><span className="tabular-nums">{Math.round(state.progress)}%</span>{!compact && <X className="editor-export-state-icon" />}</>
        : status === "error" ? <><span className="min-w-0 truncate">{compact ? "Retry" : state.error}</span>{!compact && <X className="editor-export-state-icon" />}</>
          : <>{!compact && <Check className="editor-export-state-icon" />}{compact ? "Saved" : "Saved!"}</>}
  </Button>;
}

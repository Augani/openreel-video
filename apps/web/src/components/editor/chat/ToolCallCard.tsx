import type { JSX } from "react";
import { memo, useState } from "react";
import {
  Button,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@openreel/ui";
import {
  ChevronRight,
  Loader2,
  Check,
  X,
  Ban,
  Wrench,
  Undo2,
} from "@/icons/lucide-compat";
import type { ToolCallView } from "../../../stores/chat-store";

const STATUS_META: Record<
  ToolCallView["status"],
  { icon: JSX.Element; tint: string; label: string }
> = {
  running: {
    icon: <Loader2 size={12} className="animate-spin" />,
    tint: "text-fg-2",
    label: "Running",
  },
  done: {
    icon: <Check size={12} />,
    tint: "text-status-success",
    label: "Done",
  },
  retrying: {
    icon: <Wrench size={12} />,
    tint: "text-status-warning",
    label: "Correcting",
  },
  corrected: {
    icon: <Check size={12} />,
    tint: "text-fg-muted",
    label: "Corrected",
  },
  error: {
    icon: <X size={12} />,
    tint: "text-status-error",
    label: "Failed",
  },
  rejected: {
    icon: <Ban size={12} />,
    tint: "text-fg-muted",
    label: "Skipped",
  },
};

function ToolCallDetails({ call }: { call: ToolCallView }): JSX.Element {
  return <>
    <div className="font-mono text-fg-muted">{call.name}</div>
    {Object.keys(call.args ?? {}).length > 0 && (
      <div>
        <div className="mb-0.5 text-[9px] uppercase tracking-wide text-fg-muted">Arguments</div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-bg-2 p-1.5 font-mono text-[10px] text-fg-2">
          {JSON.stringify(call.args, null, 2)}
        </pre>
      </div>
    )}
    {call.result && (
      <div>
        <div className="mb-0.5 text-[9px] uppercase tracking-wide text-fg-muted">Result</div>
        <div className={call.result.ok || call.status === "corrected" ? "text-fg-2" : call.status === "retrying" ? "text-status-warning" : "text-status-error"}>
          {call.result.summary}
          {call.result.error && !call.result.ok ? ` — ${call.result.error.message}` : ""}
        </div>
        {call.result.data !== undefined && (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-2 p-1.5 text-[10px]">
            {JSON.stringify(call.result.data, null, 2)}
          </pre>
        )}
      </div>
    )}
  </>;
}

export const ToolCallCard = memo(function ToolCallCard({ call, undone = false }: { call: ToolCallView; undone?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const meta = undone ? { icon: <Undo2 size={12}/>, tint: "text-fg-muted", label: "Undone" } : STATUS_META[call.status];
  const hasDetail =
    Object.keys(call.args ?? {}).length > 0 || call.result !== undefined;
  const readableName = call.name
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
  const label = call.result?.summary || readableName;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="workspace-tool-call rounded-md border border-border bg-bg-1/60 text-[11px]"
    >
      <CollapsibleTrigger asChild disabled={!hasDetail}>
        <Button
          type="button"
          aria-label={`${label} ${meta.label}`}
          variant="ghost"
          disabled={!hasDetail}
          className="workspace-tool-call-trigger group flex h-auto w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-[11px] disabled:cursor-default"
        >
          <span className={`flex shrink-0 ${meta.tint}`} aria-hidden="true">
            {meta.icon}
          </span>
          <span className="min-w-0 truncate text-fg">{label}</span>
          {(undone || call.status !== "done") && (
            <span className={`ml-auto text-[10px] ${meta.tint}`}>
              {meta.label}
            </span>
          )}
          {hasDetail && (
            <ChevronRight
              size={12}
              aria-hidden="true"
              className={`ml-auto shrink-0 text-fg-muted opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 ${open ? "rotate-90 opacity-100" : ""}`}
            />
          )}
        </Button>
      </CollapsibleTrigger>

      {hasDetail && (
        <CollapsibleContent className="space-y-1.5 border-t border-border px-2 py-1.5">
          <ToolCallDetails call={call} />
        </CollapsibleContent>
      )}

      {!open && call.result?.error && !call.result.ok && (
        <p className="px-2 pb-1.5 text-status-error">
          {call.result.error.message}
        </p>
      )}
    </Collapsible>
  );
});

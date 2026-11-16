import type { JSX } from "react";
import { Button } from "@openreel/ui";
import { AlertTriangle } from "@/icons/lucide-compat";
import type { ToolCall } from "@openreel/agent";
import { useChatStore } from "../../../stores/chat-store";

export function InlineConfirmCard({ call }: { call: ToolCall }): JSX.Element {
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);
  const argKeys = Object.keys(call.args ?? {});

  return (
    <div className="workspace-chat-confirm rounded-lg border border-status-warning/40 bg-status-warning/10 p-2.5 text-[12px]">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
        <AlertTriangle size={13} className="text-status-warning" />
        Confirm action
      </div>
      <p className="mb-2 text-[12px] leading-5 text-fg-2">
        The assistant wants to run{" "}
        <span className="font-mono text-fg">{call.name}</span>, which may modify
        your project or incur cost.
      </p>
      {argKeys.length > 0 && (
        <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-2 p-1.5 font-mono text-[10px] text-fg-2">
          {JSON.stringify(call.args, null, 2)}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={() => resolveConfirm("approve")}
          className="h-7 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent/90"
        >Approve</Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => resolveConfirm("approve_for_turn")}
          className="h-7 rounded-md border border-border bg-bg-2 px-2.5 py-1 text-[11px] font-medium text-fg-2 hover:bg-hover"
        >Approve all this turn</Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => resolveConfirm("reject")}
          className="h-7 rounded-md px-2.5 py-1 text-[11px] font-medium text-status-error hover:bg-status-error/10 hover:text-status-error"
        >Reject</Button>
      </div>
    </div>
  );
}

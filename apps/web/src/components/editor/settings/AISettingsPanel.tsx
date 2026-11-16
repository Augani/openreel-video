import { useId } from "react";
import { Button, Label, Switch } from "@openreel/ui";
import { useChatStore } from "../../../stores/chat-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { AIConnectionPanel } from "./AIConnectionPanel";

export function AISettingsPanel() {
  const dryRunId = useId(), autoConfirmId = useId();
  const status = useChatStore((state) => state.status);
  const busy = status === "running" || status === "awaiting_confirm";
  const autoConfirm = useSettingsStore((state) => state.agentAutoConfirm);
  const setAutoConfirm = useSettingsStore((state) => state.setAgentAutoConfirm);
  const dryRun = useSettingsStore((state) => state.agentDryRun);
  const setDryRun = useSettingsStore((state) => state.setAgentDryRun);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  return (
    <div className="space-y-5 pb-1">
      <div>
        <h3 className="text-sm font-medium text-fg">Model connection</h3>
        <p className="mt-1 text-xs text-fg-muted">Choose the model that helps edit your timeline.</p>
      </div>
      {busy && <p role="status" className="text-xs text-fg-muted">You can change these settings when the current edit finishes.</p>}
      <AIConnectionPanel disabled={busy} />
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div><Label htmlFor={dryRunId} className="text-xs">Preview edits only</Label><p id={`${dryRunId}-description`} className="mt-1 text-[11px] leading-4 text-fg-2">Plan changes without applying them to the timeline.</p></div>
          <Switch id={dryRunId} aria-describedby={`${dryRunId}-description`} checked={dryRun} disabled={busy} onCheckedChange={value => { if (!["running", "awaiting_confirm"].includes(useChatStore.getState().status)) setDryRun(value); }} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div><Label htmlFor={autoConfirmId} className="text-xs">Auto-approve edits</Label><p id={`${autoConfirmId}-description`} className="mt-1 text-[11px] leading-4 text-fg-2">Run actions such as deleting clips without asking for confirmation.</p></div>
          <Switch id={autoConfirmId} aria-describedby={`${autoConfirmId}-description`} checked={autoConfirm} disabled={busy} onCheckedChange={value => { if (!["running", "awaiting_confirm"].includes(useChatStore.getState().status)) setAutoConfirm(value); }} />
        </div>
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={closeSettings} type="button" aria-label="Done" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
          <span className="truncate">{"Done"}</span>
        </Button>
      </div>
    </div>
  );
}

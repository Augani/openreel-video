import { ToolcraftButton as Button, ToolcraftSwitchControl } from "@openreel/ui";
import { useChatStore } from "../../../stores/chat-store";
import { useSettingsStore } from "../../../stores/settings-store";

export function AISettingsPanel() {
  const status = useChatStore((state) => state.status);
  const busy = status === "running" || status === "awaiting_confirm";
  const autoConfirm = useSettingsStore((state) => state.agentAutoConfirm);
  const setAutoConfirm = useSettingsStore((state) => state.setAgentAutoConfirm);
  const dryRun = useSettingsStore((state) => state.agentDryRun);
  const setDryRun = useSettingsStore((state) => state.setAgentDryRun);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  return (
    <div className="space-y-5 pb-1">
      {/* Hawsh Khalifa build: no model connection section — AI runs only on Director's Eyes points. */}
      {busy && <p role="status" className="text-xs text-fg-muted">You can change these settings when the current edit finishes.</p>}
      <div className="space-y-3">
        <ToolcraftSwitchControl
          label="Preview edits only"
          description="Plan changes without applying them to the timeline."
          checked={dryRun}
          onCheckedChange={setDryRun}
          disabled={busy}
        />
        <ToolcraftSwitchControl
          label="Auto-approve edits"
          description="Run actions such as deleting clips without asking for confirmation."
          checked={autoConfirm}
          onCheckedChange={setAutoConfirm}
          disabled={busy}
        />
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <Button label="Done" variant="primary" size="sm" onClick={closeSettings} />
      </div>
    </div>
  );
}

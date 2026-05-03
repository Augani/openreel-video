import React from "react";
import { useAgentStore } from "../../stores/agent-store";

export const AgentFreezeOverlay: React.FC = () => {
  const frozen = useAgentStore((s) => s.frozen);
  const reason = useAgentStore((s) => s.reason);
  const setFrozen = useAgentStore((s) => s.setFrozen);

  if (!frozen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black/30 backdrop-blur-[1px] flex items-start justify-center pt-3 pointer-events-auto">
      <div className="flex items-center gap-3 px-4 py-2 rounded-md bg-background border border-primary/40 shadow-lg text-sm">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span className="text-text-primary font-medium">
          Agent is editing
        </span>
        {reason && (
          <span className="text-text-secondary truncate max-w-[40ch]">
            — {reason}
          </span>
        )}
        <button
          type="button"
          onClick={() => setFrozen(false)}
          className="ml-2 px-2 py-1 rounded text-text-secondary hover:text-text-primary hover:bg-border/50 transition-colors"
        >
          Stop
        </button>
      </div>
    </div>
  );
};

import React from "react";
import { Plug, TriangleAlert } from "@/icons/lucide-compat";
import { Switch, cn } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { ConnectSnippets } from "./ConnectSnippets";
import { connectionLabel, useMcpConnection } from "./mcp-connect";

interface AgentConnectCardProps {
  className?: string;
  /** Id of the headline, so a hosting dialog can label itself with it. */
  headingId?: string;
}

/**
 * G1 "Connect an agent". Everything shown is live: the tool count comes from a real tools/list,
 * the snippets use the real shim path, and the indicator follows the main-side initialize tracker.
 */
export const AgentConnectCard: React.FC<AgentConnectCardProps> = ({ className, headingId }) => {
  const { status, toolCount, clientStatus, refresh } = useMcpConnection();
  const autoAllow = useSettingsStore((s) => s.mcpAutoAllowTrustedLocal);
  const setAutoAllow = useSettingsStore((s) => s.setMcpAutoAllowTrustedLocal);
  const running = status?.running === true;
  const connection = connectionLabel(clientStatus);
  const startError = clientStatus?.startError ?? null;

  const chip = running
    ? toolCount === null
      ? "Server running"
      : `Server running · ${toolCount} tools`
    : status
      ? "Server not running"
      : "Checking server…";

  return (
    <section className={cn("mx-auto w-full max-w-xl space-y-5", className)}>
      <header className="space-y-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Plug size={18} aria-hidden />
        </div>
        <h2 id={headingId} className="text-xl font-semibold tracking-tight text-fg">
          Let your agent drive OpenReel.
        </h2>
        <p className="text-sm text-fg-2">
          Claude Code, Claude Desktop, Cursor and Cline can create projects, import media, edit and export through the same
          tools as the built-in chat.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="mcp-status-chip"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            running ? "border-accent/40 bg-accent-soft text-fg" : "border-border bg-bg-1 text-fg-2",
          )}
        >
          <i aria-hidden className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-accent" : "bg-fg-2")} />
          {chip}
        </span>
        <span
          role="status"
          aria-live="polite"
          data-testid="mcp-connection-indicator"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
            connection.connected ? "border-accent/40 bg-accent-soft text-fg" : "border-border bg-bg-1 text-fg-2",
          )}
        >
          <i
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connection.connected ? "bg-accent" : "bg-fg-2 motion-safe:animate-pulse",
            )}
          />
          {connection.text}
        </span>
      </div>

      {startError && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-border bg-bg-1 px-3 py-2.5 text-xs text-fg"
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-fg-2" aria-hidden />
          <span>
            The MCP server could not start: <span className="font-mono">{startError}</span>. Quit and reopen OpenReel, or set
            a different port with OPENREEL_MCP_PORT.
          </span>
        </div>
      )}

      <ConnectSnippets status={status} onRetry={() => void refresh()} />

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-1 px-4 py-3">
        <div className="space-y-0.5">
          <label htmlFor="agent-auto-allow" className="block text-sm font-medium text-fg">
            Allow agents to delete and export without asking.
          </label>
          <p className="text-xs text-fg-2">
            When this is off, destructive and long-running tool calls are refused. Turn it back on to allow them. It is on by
            default so existing agent setups keep working.
          </p>
        </div>
        <Switch id="agent-auto-allow" checked={autoAllow} onCheckedChange={setAutoAllow} />
      </div>

      <p className="text-xs text-fg-2">Agents don't need this window open or in front.</p>
    </section>
  );
};

export default AgentConnectCard;

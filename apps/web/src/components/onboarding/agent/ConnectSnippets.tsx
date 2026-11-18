import React, { useCallback, useId, useRef, useState } from "react";
import { Check, Copy } from "@/icons/lucide-compat";
import { cn } from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import type { OpenReelMcpStatus } from "../../../types/global";
import {
  claudeCodeCommand,
  clientConfigJson,
  directHttpSnippet,
  doctorCommand,
} from "./mcp-connect";

type TabId = "claude-code" | "desktop" | "http";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "desktop", label: "Claude Desktop · Cursor · Cline" },
  { id: "http", label: "Direct HTTP" },
];

export async function copyText(value: string, label: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
    return true;
  } catch {
    toast.error("Copy failed", "Clipboard is unavailable.");
    return false;
  }
}

interface ConnectSnippetsProps {
  status: OpenReelMcpStatus | null;
  /** Re-reads the connection status; offered when the shim path is not known yet. */
  onRetry?: () => void;
  className?: string;
}

/**
 * Copy-ready setup for each way of connecting a client. Every snippet is built from the live
 * `getStatus` values (real shim path, real URL and token), never a placeholder when they are known.
 */
export const ConnectSnippets: React.FC<ConnectSnippetsProps> = ({ status, onRetry, className }) => {
  const [tab, setTab] = useState<TabId>("claude-code");
  const [copied, setCopied] = useState<TabId | null>(null);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shimPath = status?.shimPath ?? "";

  const content: Record<TabId, { shown: string; copy: string; label: string; help: string }> = {
    "claude-code": {
      shown: claudeCodeCommand(shimPath),
      copy: claudeCodeCommand(shimPath),
      label: "Command",
      help: "Run this once in a terminal. Claude Code then lists OpenReel as an MCP server.",
    },
    desktop: {
      shown: clientConfigJson(shimPath),
      copy: clientConfigJson(shimPath),
      label: "Config",
      help: "Add this to the client's MCP config and restart it. The shim finds the running app on its own.",
    },
    http: {
      shown: directHttpSnippet(status ? { url: status.url, token: status.token ? "•".repeat(16) : "" } : null),
      copy: directHttpSnippet(status),
      label: "Connection details",
      help: "For clients that speak HTTP directly. Loopback only; the token is required on every request.",
    },
  };

  const onCopy = useCallback(
    async (id: TabId) => {
      const ok = await copyText(content[id].copy, content[id].label);
      if (ok) {
        setCopied(id);
        window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status],
  );

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const active = content[tab];

  return (
    <div className={className}>
      <div role="tablist" aria-label="Connection method" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t, i) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-3 py-2 text-xs font-medium outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-accent text-fg" : "border-transparent text-fg-2 hover:text-fg",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="space-y-2 pt-3"
      >
        <p className="text-xs text-fg-2">{active.help}</p>
        {!shimPath && tab !== "http" ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2.5 text-xs text-fg-2">
            <span>The connection helper is not available yet, so there is no command to copy. Make sure OpenReel finished starting, then try again.</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 rounded-[7px] border border-border px-3 py-1.5 font-medium text-fg outline-none transition-colors hover:bg-bg-2 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            )}
          </div>
        ) : (
        <div className="relative">
          <pre
            tabIndex={0}
            aria-label={active.label}
            className="overflow-x-auto rounded-md border border-border bg-bg px-3 py-2.5 pr-11 font-mono text-[11px] leading-5 text-fg-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {active.shown}
          </pre>
          <button
            type="button"
            onClick={() => void onCopy(tab)}
            aria-label={`Copy ${active.label.toLowerCase()}`}
            title={`Copy ${active.label.toLowerCase()}`}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-fg-2 outline-none transition-colors hover:bg-bg-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied === tab ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          </button>
        </div>
        )}
        {tab !== "http" && shimPath && (
          <p className="text-[11px] text-fg-2">
            Not connecting? Run <code className="font-mono text-fg">{doctorCommand(shimPath)}</code> to see which step fails.
          </p>
        )}
      </div>
    </div>
  );
};

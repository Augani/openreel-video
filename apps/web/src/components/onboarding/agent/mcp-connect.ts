import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenReelMcpClientStatus, OpenReelMcpStatus } from "../../../types/global";

const SHIM_PLACEHOLDER = "<path to openreel-mcp shim>";
const CLIENT_POLL_MS = 3000;

/** Wraps a value for a POSIX shell only when it needs it, so simple paths stay readable. */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function claudeCodeCommand(shimPath: string): string {
  return `claude mcp add openreel -- node ${shellQuote(shimPath || SHIM_PLACEHOLDER)}`;
}

export function clientConfigJson(shimPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openreel: {
          command: "node",
          args: [shimPath || SHIM_PLACEHOLDER],
        },
      },
    },
    null,
    2,
  );
}

export function directHttpSnippet(status: Pick<OpenReelMcpStatus, "url" | "token"> | null): string {
  const url = status?.url || "http://127.0.0.1:<port>/mcp";
  const token = status?.token ? status.token : "<token from Settings > MCP>";
  return [`URL: ${url}`, `Authorization: Bearer ${token}`].join("\n");
}

export function doctorCommand(shimPath: string): string {
  return `node ${shellQuote(shimPath || SHIM_PLACEHOLDER)} --doctor`;
}

export interface McpConnection {
  status: OpenReelMcpStatus | null;
  /** Live count from a real tools/list; null until known or when the server is not running. */
  toolCount: number | null;
  clientStatus: OpenReelMcpClientStatus | null;
  refresh: () => Promise<void>;
  setStatus: (status: OpenReelMcpStatus) => void;
  setToolCount: (count: number | null) => void;
}

/**
 * Live view of the desktop MCP server: status, tool count (from tools/list, never hardcoded) and
 * which clients have connected. Polls the client tracker lightly while mounted.
 */
export function useMcpConnection(): McpConnection {
  const [status, setStatus] = useState<OpenReelMcpStatus | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [clientStatus, setClientStatus] = useState<OpenReelMcpClientStatus | null>(null);
  const alive = useRef(true);

  const refreshClients = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge?.getClientStatus) return;
    try {
      const next = await bridge.getClientStatus();
      if (alive.current) setClientStatus(next);
    } catch {
      // The indicator simply stays on its last known state.
    }
  }, []);

  const refresh = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      const nextStatus = await bridge.getStatus();
      if (!alive.current) return;
      setStatus(nextStatus);
      if (nextStatus.running) {
        const connection = await bridge.testConnection();
        if (alive.current) setToolCount(connection.ok ? (connection.toolCount ?? 0) : null);
      } else {
        setToolCount(null);
      }
    } catch {
      if (alive.current) {
        setStatus(null);
        setToolCount(null);
      }
    }
    await refreshClients();
  }, [refreshClients]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => void refreshClients(), CLIENT_POLL_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [refresh, refreshClients]);

  return { status, toolCount, clientStatus, refresh, setStatus, setToolCount };
}

/** "Waiting for a client…" or "Connected: Claude Code 2.1.0", from the main-side tracker. */
export function connectionLabel(clientStatus: OpenReelMcpClientStatus | null): {
  connected: boolean;
  text: string;
} {
  if (!clientStatus?.connected || clientStatus.clients.length === 0) {
    return { connected: false, text: "Waiting for a client…" };
  }
  const [latest] = clientStatus.clients;
  const name = latest.version ? `${latest.name} ${latest.version}` : latest.name;
  const extra = clientStatus.clients.length > 1 ? ` +${clientStatus.clients.length - 1}` : "";
  return { connected: true, text: `Connected: ${name}${extra}` };
}

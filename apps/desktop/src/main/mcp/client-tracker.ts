import type { McpClientStatus } from "../../shared/onboarding";

/** A client counts as connected while it has talked to the server within this window. */
export const CLIENT_ACTIVE_WINDOW_MS = 5 * 60_000;
const MAX_TRACKED_CLIENTS = 20;
/** `--doctor` identifies itself with this name; it is a diagnostic, not a connected client. */
export const DOCTOR_CLIENT_NAME = "openreel-mcp-doctor";

interface TrackedClient {
  name: string;
  version?: string;
  connectedAt: number;
  lastSeenAt: number;
}

let clients: TrackedClient[] = [];
let initializeCount = 0;
let startError: string | null = null;
let now: () => number = () => Date.now();

function keyOf(name: string, version?: string): string {
  return `${name}|${version ?? ""}`;
}

/** Records an `initialize` handshake. Called by the HTTP server for every initialize. */
export function recordInitialize(info: { name: string; version?: string }): void {
  if (info.name === DOCTOR_CLIENT_NAME) return;
  initializeCount += 1;
  const t = now();
  const key = keyOf(info.name, info.version);
  const existing = clients.find((c) => keyOf(c.name, c.version) === key);
  if (existing) {
    // A reconnect of the same client: it is a fresh connection, not a long-lived one.
    existing.connectedAt = t;
    existing.lastSeenAt = t;
  } else {
    clients.push({ name: info.name, version: info.version, connectedAt: t, lastSeenAt: t });
    if (clients.length > MAX_TRACKED_CLIENTS) {
      clients.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      clients = clients.slice(0, MAX_TRACKED_CLIENTS);
    }
  }
}

/**
 * Any authorized request refreshes the most recent client. The transport is
 * stateless, so requests cannot be attributed to a specific client; the one
 * that initialized last is the best guess.
 */
export function recordActivity(): void {
  if (clients.length === 0) return;
  let latest = clients[0];
  for (const c of clients) if (c.lastSeenAt >= latest.lastSeenAt) latest = c;
  latest.lastSeenAt = now();
}

export function recordStartError(message: string | null): void {
  startError = message;
}

export function getMcpClientStatus(): McpClientStatus {
  const t = now();
  const sorted = [...clients].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return {
    connected: sorted.some((c) => t - c.lastSeenAt <= CLIENT_ACTIVE_WINDOW_MS),
    clients: sorted.map((c) => ({
      name: c.name,
      ...(c.version !== undefined ? { version: c.version } : {}),
      connectedAt: c.connectedAt,
      lastSeenAt: c.lastSeenAt,
    })),
    initializeCount,
    startError,
  };
}

/** Test hook: clears state and optionally injects a clock. */
export function resetClientTrackerForTests(clock?: () => number): void {
  clients = [];
  initializeCount = 0;
  startError = null;
  now = clock ?? (() => Date.now());
}

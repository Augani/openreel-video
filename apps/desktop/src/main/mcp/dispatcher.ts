import { randomUUID } from "node:crypto";
import type { McpBridgeRequest, McpBridgeResponse } from "../../shared/mcp";

export type BridgeRequest = McpBridgeRequest;
export type BridgeResponse = McpBridgeResponse;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DispatcherOptions {
  readonly send: (request: BridgeRequest) => void;
  readonly genId?: () => string;
  readonly defaultTimeoutMs?: number;
}

export interface Dispatcher {
  request(
    kind: BridgeRequest["kind"],
    payload?: { name?: string; args?: Record<string, unknown> },
    timeoutMs?: number,
  ): Promise<unknown>;
  handleResponse(response: BridgeResponse): void;
  rejectAll(reason: string): void;
  readonly pendingCount: number;
}

/**
 * Pure callId-correlated request dispatcher. Decoupled from Electron so the
 * correlation/timeout logic is unit-testable; the electron wiring injects `send`.
 */
export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const pending = new Map<string, PendingCall>();
  const genId = options.genId ?? (() => randomUUID());
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;

  const request = (
    kind: BridgeRequest["kind"],
    payload: { name?: string; args?: Record<string, unknown> } = {},
    timeoutMs = defaultTimeoutMs,
  ): Promise<unknown> => {
    const callId = genId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(callId);
        reject(new Error(`MCP renderer '${kind}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(callId, { resolve, reject, timer });
      try {
        options.send({ callId, kind, ...payload });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(callId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const handleResponse = (response: BridgeResponse): void => {
    const call = pending.get(response.callId);
    if (!call) return;
    pending.delete(response.callId);
    clearTimeout(call.timer);
    if (response.ok) call.resolve(response.result);
    else call.reject(new Error(response.error ?? "Renderer returned an error"));
  };

  const rejectAll = (reason: string): void => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
    }
    pending.clear();
  };

  return {
    request,
    handleResponse,
    rejectAll,
    get pendingCount() {
      return pending.size;
    },
  };
}

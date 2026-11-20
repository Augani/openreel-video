import { randomUUID } from "node:crypto";
import type { McpBridgeRequest, McpBridgeResponse } from "../../shared/mcp";

export type BridgeRequest = McpBridgeRequest;
export type BridgeResponse = McpBridgeResponse;

/** A bridge failure with a stable MCP error code, mapped to an isError tool result by core.ts. */
export class McpBridgeError extends Error {
  constructor(
    readonly code: "NO_WINDOW" | "TIMEOUT" | "UNAVAILABLE" | "RENDERER_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "McpBridgeError";
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface DispatcherOptions {
  readonly send: (request: BridgeRequest) => void;
  readonly genId?: () => string;
  readonly defaultTimeoutMs?: number;
  /** Called when a request times out, so the caller can drop it from any queue before it runs late. */
  readonly onExpire?: (callId: string) => void;
}

export interface Dispatcher {
  request(
    kind: BridgeRequest["kind"],
    payload?: { name?: string; args?: Record<string, unknown>; origin?: BridgeRequest["origin"] },
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
    payload: { name?: string; args?: Record<string, unknown>; origin?: BridgeRequest["origin"] } = {},
    timeoutMs = defaultTimeoutMs,
  ): Promise<unknown> => {
    const callId = genId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(callId);
        options.onExpire?.(callId);
        reject(new McpBridgeError("TIMEOUT", `MCP renderer '${kind}' timed out after ${timeoutMs}ms`));
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
    else call.reject(new McpBridgeError("RENDERER_ERROR", response.error ?? "Renderer returned an error"));
  };

  const rejectAll = (reason: string): void => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new McpBridgeError("UNAVAILABLE", reason));
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

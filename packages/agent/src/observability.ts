import type { AgentEvent } from "./types";

export interface AgentLogRecord {
  readonly type: AgentEvent["type"];
  readonly tool?: string;
  readonly ok?: boolean;
  readonly error?: string;
  readonly summary?: string;
}

const truncate = (text: string, max = 200): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Maps a loop event to a flat, serializable record for structured logging. */
export function toLogRecord(event: AgentEvent): AgentLogRecord {
  switch (event.type) {
    case "text_delta":
    case "turn_complete":
      return { type: event.type, summary: truncate(event.text) };
    case "tool_call":
    case "awaiting_confirmation":
      return { type: event.type, tool: event.call.name };
    case "tool_result":
      return {
        type: event.type,
        tool: event.call.name,
        ok: event.result.ok,
        summary: event.result.summary,
        error: event.result.error?.message,
      };
    case "error":
      return { type: event.type, error: event.error.message };
  }
}

/** Adapts a structured-record sink into a loop onEvent handler. */
export function createEventLogger(
  sink: (record: AgentLogRecord) => void,
): (event: AgentEvent) => void {
  return (event) => sink(toLogRecord(event));
}

/** Collects structured records in memory (telemetry / debugging / tests). */
export function collectEvents(): {
  onEvent: (event: AgentEvent) => void;
  records: AgentLogRecord[];
} {
  const records: AgentLogRecord[] = [];
  return { onEvent: createEventLogger((record) => records.push(record)), records };
}

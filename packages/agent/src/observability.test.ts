import { describe, it, expect } from "vitest";
import { toLogRecord, collectEvents } from "./observability";

describe("observability", () => {
  it("maps a tool_result event to a structured record", () => {
    expect(
      toLogRecord({
        type: "tool_result",
        call: { id: "1", name: "add_track", args: {} },
        result: { ok: true, summary: "Added track" },
      }),
    ).toEqual({ type: "tool_result", tool: "add_track", ok: true, summary: "Added track", error: undefined });
  });

  it("captures the error message from a failed tool result", () => {
    const rec = toLogRecord({
      type: "tool_result",
      call: { id: "1", name: "remove_track", args: {} },
      result: { ok: false, summary: "failed", error: { code: "X", message: "boom" } },
    });
    expect(rec.ok).toBe(false);
    expect(rec.error).toBe("boom");
  });

  it("collectEvents accumulates records across a turn", () => {
    const { onEvent, records } = collectEvents();
    onEvent({ type: "tool_call", call: { id: "1", name: "add_track", args: {} } });
    onEvent({
      type: "tool_result",
      call: { id: "1", name: "add_track", args: {} },
      result: { ok: true, summary: "ok" },
    });
    onEvent({ type: "turn_complete", text: "done" });
    expect(records.map((r) => r.type)).toEqual(["tool_call", "tool_result", "turn_complete"]);
    expect(records[0].tool).toBe("add_track");
  });
});

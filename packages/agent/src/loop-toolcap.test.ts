import { describe, it, expect } from "vitest";
import { runTurn } from "./loop";
import { HeadlessHost } from "./headless-host";
import { MockLLMClient } from "./llm";
import type { LLMResponse, LoopMessage } from "./llm";
import { makeEmptyProject } from "./test-fixtures";

function toolResultIds(messages: LoopMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    if (m.role === "tool") for (const r of m.results) ids.push(r.toolUseId);
  }
  return ids;
}

function assistantToolUseIds(messages: LoopMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant") for (const u of m.toolUses) ids.push(u.id);
  }
  return ids;
}

describe("runTurn max_tool_calls transcript integrity", () => {
  it("answers every tool_use even when the budget is hit mid-step", async () => {
    const script: LLMResponse[] = [
      {
        text: "",
        stopReason: "tool_use",
        toolUses: [
          { id: "t1", name: "add_track", input: { trackType: "video" } },
          { id: "t2", name: "add_track", input: { trackType: "audio" } },
        ],
      },
    ];
    const result = await runTurn({
      host: new HeadlessHost(makeEmptyProject()),
      llm: new MockLLMClient(script),
      tools: [],
      messages: [{ role: "user", content: "add two tracks" }],
      limits: { maxToolCalls: 1 },
    });

    expect(result.stoppedReason).toBe("max_tool_calls");
    expect(result.committed).toBe(true);

    // Every assistant tool_use must have a matching tool_result (no dangling
    // blocks) so the persisted transcript is resumable.
    const useIds = assistantToolUseIds(result.messages).sort();
    const resultIds = toolResultIds(result.messages).sort();
    expect(resultIds).toEqual(useIds);
    expect(useIds).toEqual(["t1", "t2"]);
  });
});

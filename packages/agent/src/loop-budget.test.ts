import { describe, it, expect } from "vitest";
import { runTurn } from "./loop";
import { HeadlessHost } from "./headless-host";
import { MockLLMClient } from "./llm";
import type { LLMResponse } from "./llm";
import { makeEmptyProject } from "./test-fixtures";

describe("runTurn cost ceiling", () => {
  it("stops with stoppedReason 'budget' once the token ceiling is reached", async () => {
    const script: LLMResponse[] = [
      {
        text: "",
        stopReason: "tool_use",
        toolUses: [{ id: "t1", name: "rename_project", input: { name: "X" } }],
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      { text: "should not reach here", stopReason: "end_turn", toolUses: [] },
    ];
    const result = await runTurn({
      host: new HeadlessHost(makeEmptyProject()),
      llm: new MockLLMClient(script),
      tools: [],
      messages: [{ role: "user", content: "rename it" }],
      limits: { maxTokens: 50 },
    });

    expect(result.stoppedReason).toBe("budget");
    expect(result.committed).toBe(true);
    expect(result.usage.inputTokens + result.usage.outputTokens).toBeGreaterThanOrEqual(50);
    expect(result.text).not.toContain("should not reach here");
  });

  it("commits edits already applied before the ceiling was hit (deliberate partial commit)", async () => {
    const script: LLMResponse[] = [
      {
        text: "",
        stopReason: "tool_use",
        toolUses: [{ id: "t1", name: "add_track", input: { trackType: "video" } }],
        usage: { inputTokens: 80, outputTokens: 0 },
      },
      { text: "more", stopReason: "end_turn", toolUses: [] },
    ];
    const host = new HeadlessHost(makeEmptyProject());
    const result = await runTurn({
      host,
      llm: new MockLLMClient(script),
      tools: [],
      messages: [{ role: "user", content: "add a track" }],
      limits: { maxTokens: 50 },
    });
    expect(result.stoppedReason).toBe("budget");
    expect(result.committed).toBe(true);
    // The tool that ran before the budget was exceeded stays applied.
    expect(host.getProject().timeline.tracks).toHaveLength(1);
  });

  it("completes normally when under the ceiling", async () => {
    const script: LLMResponse[] = [
      { text: "Done.", stopReason: "end_turn", toolUses: [], usage: { inputTokens: 10, outputTokens: 5 } },
    ];
    const result = await runTurn({
      host: new HeadlessHost(makeEmptyProject()),
      llm: new MockLLMClient(script),
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      limits: { maxTokens: 10_000 },
    });
    expect(result.stoppedReason).toBe("end_turn");
  });
});

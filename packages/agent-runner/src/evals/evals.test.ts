import { describe, it, expect } from "vitest";
import { MockLLMClient } from "@openreel/agent";
import { runEvals, runEvalCase } from "./harness";
import { SCRIPTED_CASES } from "./cases";
import { createEmptyProject } from "../project-io";

describe("eval suite", () => {
  it("passes the deterministic baseline corpus", async () => {
    const { outcomes, passRate } = await runEvals(SCRIPTED_CASES);
    const failed = outcomes.filter((o) => !o.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    expect(passRate).toBe(1);
  });

  it("flags a case whose assertion fails", async () => {
    const outcome = await runEvalCase({
      name: "wrong expectation",
      makeProject: () => createEmptyProject("X"),
      prompt: "add a track",
      llm: new MockLLMClient([
        {
          text: "",
          stopReason: "tool_use",
          toolUses: [{ id: "t1", name: "add_track", input: { trackType: "video" } }],
        },
        { text: "done", stopReason: "end_turn", toolUses: [] },
      ]),
      assert: (project) =>
        project.timeline.tracks.length === 5 ? [] : ["expected 5 tracks"],
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain("expected 5 tracks");
  });

  it("detects a tool-sequence mismatch", async () => {
    const outcome = await runEvalCase({
      name: "sequence mismatch",
      makeProject: () => createEmptyProject("X"),
      prompt: "add a track",
      llm: new MockLLMClient([
        {
          text: "",
          stopReason: "tool_use",
          toolUses: [{ id: "t1", name: "add_track", input: { trackType: "video" } }],
        },
        { text: "done", stopReason: "end_turn", toolUses: [] },
      ]),
      expectedTools: ["rename_project"],
      assert: () => [],
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.includes("tool sequence mismatch"))).toBe(true);
  });
});

import type { LLMClient, RunTurnResult, LoopMessage } from "@openreel/agent";
import type { Project } from "@openreel/core/types/project";
import { runHeadlessEdit } from "../run";
import type { LlmProvider } from "../node-llm";

export interface EvalCase {
  readonly name: string;
  readonly makeProject: () => Project;
  readonly prompt: string;
  /** Deterministic client for CI; omit to drive a real BYOK model. */
  readonly llm?: LLMClient;
  /** Exact tool-call sequence the turn should produce. */
  readonly expectedTools?: string[];
  /** Returns failure messages (empty = pass). */
  readonly assert: (project: Project, result: RunTurnResult) => string[];
}

export interface EvalOutcome {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: string[];
}

export interface EvalRunOptions {
  readonly provider?: LlmProvider;
  readonly model?: string;
  readonly apiKey?: string;
}

function toolSequence(messages: LoopMessage[]): string[] {
  const names: string[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const use of message.toolUses) names.push(use.name);
    }
  }
  return names;
}

export async function runEvalCase(
  testCase: EvalCase,
  opts: EvalRunOptions = {},
): Promise<EvalOutcome> {
  const failures: string[] = [];
  // Real-LLM mode (no scripted client) must be configured explicitly; never
  // silently fall back to a non-functional model/key.
  if (!testCase.llm && (!opts.apiKey || !opts.model)) {
    return {
      name: testCase.name,
      passed: false,
      failures: [
        "real-LLM eval requires opts.model + opts.apiKey when the case has no scripted llm",
      ],
    };
  }
  try {
    const { project, result } = await runHeadlessEdit({
      project: testCase.makeProject(),
      prompt: testCase.prompt,
      provider: opts.provider ?? "anthropic",
      model: opts.model ?? "mock",
      apiKey: opts.apiKey ?? "unused",
      llm: testCase.llm,
    });

    if (result.stoppedReason === "error") {
      failures.push("turn stopped with an error");
    }
    if (testCase.expectedTools) {
      const actual = toolSequence(result.messages);
      if (
        actual.length !== testCase.expectedTools.length ||
        actual.some((name, i) => name !== testCase.expectedTools![i])
      ) {
        failures.push(
          `tool sequence mismatch: expected [${testCase.expectedTools.join(", ")}], got [${actual.join(", ")}]`,
        );
      }
    }
    failures.push(...testCase.assert(project, result));
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { name: testCase.name, passed: failures.length === 0, failures };
}

export async function runEvals(
  cases: EvalCase[],
  opts?: EvalRunOptions,
): Promise<{ outcomes: EvalOutcome[]; passRate: number }> {
  const outcomes: EvalOutcome[] = [];
  for (const testCase of cases) {
    outcomes.push(await runEvalCase(testCase, opts));
  }
  const passed = outcomes.filter((o) => o.passed).length;
  return { outcomes, passRate: cases.length === 0 ? 1 : passed / cases.length };
}

import type { EditingHost, TxnHandle } from "./host";
import type { AgentEvent, ConfirmDecision, ToolCall, ToolResult } from "./types";
import type {
  LLMClient,
  LoopMessage,
  LLMUsage,
  LoopToolResult,
  LoopToolResultBlock,
} from "./llm";
import { executeTool, isDestructive, isExpensive } from "./executor";
import { getTool } from "./registry";

export interface RunTurnInput {
  readonly host: EditingHost;
  readonly llm: LLMClient;
  /** Provider-formatted tool defs (registry.toAnthropicTools()/toOpenAITools()). */
  readonly tools: unknown[];
  readonly system?: string;
  /** Conversation so far; the new user turn should already be appended. */
  readonly messages: LoopMessage[];
  readonly confirmGate?: (call: ToolCall) => Promise<ConfirmDecision> | ConfirmDecision;
  readonly onEvent?: (event: AgentEvent) => void;
  /**
   * maxTokens is a soft ceiling checked between steps: the turn stops before the
   * next completion once cumulative usage reaches it, so it can overshoot by at
   * most the step that crosses the threshold (it can't un-spend a completion).
   */
  readonly limits?: { maxSteps?: number; maxToolCalls?: number; maxTokens?: number };
  readonly dryRun?: boolean;
  readonly turnLabel?: string;
  /** Closed tool catalog and atomic policy used by the browser AI workspace. */
  readonly execute?: (name: string, args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult>;
  readonly readOnly?: (name: string) => boolean;
  readonly atomic?: boolean;
  readonly signal?: AbortSignal;
}

export type StopReason =
  | "end_turn"
  | "max_steps"
  | "max_tool_calls"
  | "budget"
  | "error";

export interface RunTurnResult {
  readonly text: string;
  readonly messages: LoopMessage[];
  readonly toolCalls: number;
  readonly stoppedReason: StopReason;
  readonly committed: boolean;
  readonly usage: LLMUsage;
}

const isReadOnly = (name: string): boolean => getTool(name)?.readOnly ?? false;

const DATA_URL_PREFIX = /^data:([^;,]+)?(?:;[^,]*)?,/;

function stripDataUrlPrefix(dataUrl: string): {
  base64: string;
  mimeType: string;
} {
  const match = DATA_URL_PREFIX.exec(dataUrl);
  if (match) {
    return {
      base64: dataUrl.slice(match[0].length),
      mimeType: match[1] || "image/png",
    };
  }
  return { base64: dataUrl, mimeType: "image/png" };
}

function buildToolResultContent(
  result: ToolResult,
): string | LoopToolResultBlock[] {
  const text = JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    data: result.data,
    error: result.error,
  });
  if (!result.image) return text;
  const { base64, mimeType } = stripDataUrlPrefix(result.image.dataUrl);
  return [
    { type: "text", text },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: result.image.mimeType ?? mimeType,
        data: base64,
      },
    },
  ];
}

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const {
    host,
    llm,
    tools,
    system,
    confirmGate,
    onEvent,
    dryRun = false,
    turnLabel = "AI edit",
  } = input;
  const maxSteps = input.limits?.maxSteps ?? 12;
  const maxToolCalls = input.limits?.maxToolCalls ?? 64;
  const maxTokens = input.limits?.maxTokens;

  const emit = (event: AgentEvent): void => onEvent?.(event);
  const messages: LoopMessage[] = [...input.messages];
  let toolCalls = 0;
  let approveAll = false;
  let lastText = "";
  const usage: { inputTokens: number; outputTokens: number } = {
    inputTokens: 0,
    outputTokens: 0,
  };

  let txn: TxnHandle | undefined;
  const pendingCorrections = new Map<string, { call: ToolCall; result: ToolResult; previousCallIds: string[] }>();
  let correctionAttempts = 0;
  const checkCancelled = (): void => { if (input.signal?.aborted) throw new DOMException("Edit cancelled; pending changes were discarded.", "AbortError"); };
  const commit = async (): Promise<void> => {
    checkCancelled();
    const unresolved = pendingCorrections.values().next().value;
    if (unresolved) throw new Error(`${unresolved.call.name}: ${unresolved.result.error?.message ?? unresolved.result.summary}. The failed call was not corrected; pending changes were discarded.`);
    if (txn) await host.commitTransaction(txn, turnLabel);
  };

  try {
    checkCancelled();
    txn = host.beginTransaction(turnLabel);
    for (let step = 0; step < maxSteps; step++) {
      checkCancelled();
      if (
        maxTokens !== undefined &&
        usage.inputTokens + usage.outputTokens >= maxTokens
      ) {
        if (input.atomic) throw new Error("Token budget reached; pending changes were discarded.");
        await commit();
        return {
          text: lastText,
          messages,
          toolCalls,
          stoppedReason: "budget",
          committed: true,
          usage,
        };
      }
      const response = await llm.complete({ system, messages, tools });
      checkCancelled();
      lastText = response.text;
      if (input.atomic && response.stopReason === "max_tokens") throw new Error("The model response was truncated; pending changes were discarded.");
      if (response.usage) {
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
      }
      if (response.text) emit({ type: "text_delta", text: response.text });

      if (response.toolUses.length === 0) {
        messages.push({ role: "assistant", content: response.text, toolUses: [] });
        await commit();
        emit({ type: "turn_complete", text: response.text });
        return {
          text: response.text,
          messages,
          toolCalls,
          stoppedReason: response.stopReason === "max_tokens" ? "budget" : "end_turn",
          committed: true,
          usage,
        };
      }

      messages.push({
        role: "assistant",
        content: response.text,
        toolUses: response.toolUses,
      });

      const results: LoopToolResult[] = [];
      let hitToolCallLimit = false;
      for (let ti = 0; ti < response.toolUses.length; ti++) {
        checkCancelled();
        const toolUse = response.toolUses[ti];
        if (toolCalls >= maxToolCalls) {
          // Answer every remaining tool_use so the transcript stays valid for
          // resumption (an unanswered tool_use is rejected by both providers).
          for (let ri = ti; ri < response.toolUses.length; ri++) {
            const pending = response.toolUses[ri];
            const capped = {
              ok: false as const,
              summary: "Tool-call budget reached",
              error: {
                code: "MAX_TOOL_CALLS",
                message: "Per-turn tool-call limit reached",
              },
            };
            emit({
              type: "tool_result",
              call: { id: pending.id, name: pending.name, args: pending.input },
              result: capped,
            });
            results.push({
              toolUseId: pending.id,
              content: JSON.stringify(capped),
              isError: true,
            });
          }
          hitToolCallLimit = true;
          break;
        }
        toolCalls++;
        const call: ToolCall = {
          id: toolUse.id,
          name: toolUse.name,
          args: toolUse.input,
        };
        emit({ type: "tool_call", call });
        const retryOf = call.args.retryOf;
        const correction = typeof retryOf === "string" ? pendingCorrections.get(retryOf) : undefined;
        if (input.atomic && retryOf !== undefined && (!correction || correction.call.name !== call.name)) {
          throw new Error("The corrected call must reference an unresolved failure of the same tool. Pending changes were discarded.");
        }

        const needsConfirm =
          !dryRun &&
          !approveAll &&
          (isDestructive(call.name) || isExpensive(call.name));
        if (needsConfirm && confirmGate) {
          emit({ type: "awaiting_confirmation", call });
          const decision = await confirmGate(call);
          if (decision === "approve_for_turn") approveAll = true;
          if (decision === "reject") {
            const rejected = {
              ok: false as const,
              summary: "Rejected by user",
              error: { code: "REJECTED", message: "User rejected this action" },
            };
            emit({ type: "tool_result", call, result: rejected });
            results.push({
              toolUseId: call.id,
              content: JSON.stringify(rejected),
              isError: true,
            });
            if (input.atomic) throw new Error("The edit was rejected; pending changes were discarded.");
            continue;
          }
        }

        let result;
        if (dryRun && !(input.readOnly ?? isReadOnly)(call.name)) {
          result = {
            ok: true as const,
            summary: `[dry-run] would call ${call.name}`,
          };
        } else {
          result = await (input.execute ?? executeTool)(call.name, call.args, host);
        }
        checkCancelled();
        if (input.atomic && !result.ok && result.error?.recoverable && correctionAttempts < 3) {
          // Only tools that guarantee a mutation-free rejected preflight may
          // enter this path. Every failed request must be explicitly repaired.
          correctionAttempts++;
          result = { ...result, error: { ...result.error, retryOf: call.id } };
          if (typeof retryOf === "string") pendingCorrections.delete(retryOf);
          pendingCorrections.set(call.id, { call, result, previousCallIds: correction ? [...correction.previousCallIds, correction.call.id] : [] });
        }
        emit({ type: "tool_result", call, result });
        if (input.atomic && !result.ok && !pendingCorrections.has(call.id)) throw new Error(`${call.name}: ${result.error?.message ?? result.summary}. Pending changes were discarded.`);
        if (input.atomic && result.ok && correction && typeof retryOf === "string") {
          pendingCorrections.delete(retryOf);
          emit({ type: "tool_recovered", callIds: [...correction.previousCallIds, correction.call.id], repairedBy: call.id });
        }
        results.push({
          toolUseId: call.id,
          content: buildToolResultContent(result),
          isError: !result.ok,
        });
      }

      messages.push({ role: "tool", results });

      if (hitToolCallLimit) {
        if (input.atomic) throw new Error("Tool-call budget reached; pending changes were discarded.");
        await commit();
        return {
          text: lastText,
          messages,
          toolCalls,
          stoppedReason: "max_tool_calls",
          committed: true,
          usage,
        };
      }
    }

    if (input.atomic) throw new Error("Step limit reached; pending changes were discarded.");
    await commit();
    return {
      text: lastText,
      messages,
      toolCalls,
      stoppedReason: "max_steps",
      committed: true,
      usage,
    };
  } catch (error) {
    if (txn) await host.rollbackTransaction(txn);
    const message = error instanceof Error ? error.message : "Agent turn failed";
    emit({ type: "error", error: { code: "LOOP_ERROR", message } });
    return {
      text: lastText,
      messages,
      toolCalls,
      stoppedReason: "error",
      committed: false,
      usage,
    };
  }
}

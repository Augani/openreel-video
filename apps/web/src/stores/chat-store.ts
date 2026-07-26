import { create } from "zustand";
import {
  runTurn,
  toAnthropicTools,
  toOpenAITools,
  toGeminiTools,
  buildSystemPrompt,
} from "@openreel/agent";
import type {
  AgentEvent,
  ConfirmDecision,
  ToolCall,
  ToolResult,
  LoopMessage,
} from "@openreel/agent";
import { isSessionUnlocked, getSecret } from "../services/secure-storage";
import { getLiveEditorHost, runExclusive } from "../services/agent/host-singleton";
import { makeBYOKClient } from "../services/agent/llm-transport";
import { defaultModelFor, modelsFor } from "../services/agent/models";
import { useSettingsStore } from "./settings-store";
import { useProjectStore } from "./project-store";

export type ChatStatus = "idle" | "running" | "awaiting_confirm" | "error";

export type ToolCallStatus = "running" | "done" | "error" | "rejected";

export interface ToolCallView {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly result?: ToolResult;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolCalls: ToolCallView[];
}

interface PendingConfirm {
  readonly call: ToolCall;
  readonly resolve: (decision: ConfirmDecision) => void;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface ChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  conversation: LoopMessage[];
  pendingConfirm: PendingConfirm | null;
  error: string | null;
  abortController: AbortController | null;
  lastTurnCommitted: boolean;
  lastTurnUndoSize: number | null;
  usage: TokenUsage;

  send: (text: string) => Promise<void>;
  resolveConfirm: (decision: ConfirmDecision) => void;
  stop: () => void;
  undoLastTurn: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
    ?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isDesktop = (): boolean =>
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

// Monotonic turn id: a completion whose seq is stale (reset/superseded) must not
// write back into the store.
let activeSeq = 0;

function undoStackSize(): number | null {
  try {
    return useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
  } catch {
    return null;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  status: "idle",
  conversation: [],
  pendingConfirm: null,
  error: null,
  abortController: null,
  lastTurnCommitted: false,
  lastTurnUndoSize: null,
  usage: { inputTokens: 0, outputTokens: 0 },

  send: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = get();
    if (current.status === "running" || current.status === "awaiting_confirm") {
      return;
    }
    if (!useProjectStore.getState().hasOpenProject) {
      set({ error: "Open or create a project before chatting." });
      return;
    }

    const provider = useSettingsStore.getState().defaultLlmProvider;
    const storedModel = useSettingsStore.getState().llmModel;
    const model = modelsFor(provider).some((m) => m.id === storedModel)
      ? storedModel
      : defaultModelFor(provider);

    if (!isDesktop() && !isSessionUnlocked()) {
      set({ error: "Unlock secure storage to use your API key." });
      return;
    }
    let apiKey = "";
    try {
      apiKey = isDesktop() ? "" : ((await getSecret(provider)) ?? "");
    } catch {
      set({ error: "Unlock secure storage to use your API key." });
      return;
    }
    if (!isDesktop() && !apiKey) {
      set({
        error: `No ${provider} API key configured. Add it in Settings → API Keys.`,
      });
      return;
    }

    const userMessage: ChatMessage = {
      id: genId(),
      role: "user",
      text: trimmed,
      toolCalls: [],
    };
    const assistantMessage: ChatMessage = {
      id: genId(),
      role: "assistant",
      text: "",
      toolCalls: [],
    };
    const assistantId = assistantMessage.id;
    const controller = new AbortController();
    const seq = ++activeSeq;

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      conversation: [...state.conversation, { role: "user", content: trimmed }],
      status: "running",
      error: null,
      abortController: controller,
      pendingConfirm: null,
    }));

    const updateAssistant = (fn: (m: ChatMessage) => ChatMessage): void => {
      if (activeSeq !== seq) return;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === assistantId ? fn(m) : m)),
      }));
    };

    const onEvent = (event: AgentEvent): void => {
      switch (event.type) {
        case "text_delta":
        case "turn_complete":
          updateAssistant((m) => ({ ...m, text: event.text || m.text }));
          break;
        case "tool_call":
          updateAssistant((m) => ({
            ...m,
            toolCalls: [
              ...m.toolCalls,
              {
                id: event.call.id,
                name: event.call.name,
                args: event.call.args,
                status: "running",
              },
            ],
          }));
          break;
        case "tool_result":
          updateAssistant((m) => ({
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === event.call.id
                ? {
                    ...tc,
                    result: event.result,
                    status: event.result.ok
                      ? "done"
                      : event.result.error?.code === "REJECTED"
                        ? "rejected"
                        : "error",
                  }
                : tc,
            ),
          }));
          break;
        case "error":
          if (activeSeq === seq) set({ error: event.error.message });
          break;
        case "awaiting_confirmation":
          break;
      }
    };

    const host = getLiveEditorHost();
    const llm = makeBYOKClient({
      provider,
      model,
      apiKey,
      signal: controller.signal,
    });
    const tools =
      provider === "anthropic"
        ? toAnthropicTools()
        : provider === "gemini"
          ? toGeminiTools()
          : toOpenAITools();
    const autoConfirm = useSettingsStore.getState().agentAutoConfirm;
    const dryRun = useSettingsStore.getState().agentDryRun;

    const result = await runExclusive(() =>
      runTurn({
        host,
        llm,
        tools,
        system: buildSystemPrompt(host),
        messages: get().conversation,
        dryRun,
        confirmGate: autoConfirm
          ? () => "approve_for_turn"
          : (call) =>
              new Promise<ConfirmDecision>((resolve) => {
                set({ status: "awaiting_confirm", pendingConfirm: { call, resolve } });
              }),
        onEvent,
        turnLabel: "AI edit",
      }),
    );

    // A reset() (or a newer turn) during the run supersedes this completion.
    if (activeSeq !== seq) return;
    const wasAborted = controller.signal.aborted;
    set((state) => ({
      conversation: result.messages,
      status: wasAborted
        ? "idle"
        : result.stoppedReason === "error"
          ? "error"
          : "idle",
      lastTurnCommitted: result.committed,
      lastTurnUndoSize: result.committed ? undoStackSize() : null,
      abortController: null,
      pendingConfirm: null,
      usage: {
        inputTokens: state.usage.inputTokens + result.usage.inputTokens,
        outputTokens: state.usage.outputTokens + result.usage.outputTokens,
      },
      error: wasAborted
        ? null
        : result.stoppedReason === "error"
          ? (state.error ?? "The AI turn failed.")
          : state.error,
    }));
  },

  resolveConfirm: (decision: ConfirmDecision) => {
    const pending = get().pendingConfirm;
    if (!pending) return;
    set({ pendingConfirm: null, status: "running" });
    pending.resolve(decision);
  },

  stop: () => {
    const { abortController, pendingConfirm } = get();
    pendingConfirm?.resolve("reject");
    abortController?.abort();
    set({ pendingConfirm: null });
  },

  undoLastTurn: async () => {
    if (!get().lastTurnCommitted) return;
    // If the project's undo stack moved since the turn committed, a later edit
    // is on top — undoing it would hit the wrong action, so just drop the
    // affordance rather than clobber the user's edit.
    const checkpoint = get().lastTurnUndoSize;
    if (checkpoint !== null && undoStackSize() !== checkpoint) {
      set({ lastTurnCommitted: false, lastTurnUndoSize: null });
      return;
    }
    await useProjectStore.getState().undo();
    set({ lastTurnCommitted: false, lastTurnUndoSize: null });
  },

  clearError: () => set({ error: null }),

  reset: () => {
    get().pendingConfirm?.resolve("reject");
    get().abortController?.abort();
    // Supersede any in-flight turn so its completion can't write back.
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  },
}));

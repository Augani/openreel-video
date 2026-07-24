import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RunTurnInput, RunTurnResult } from "@openreel/agent";

const h = vi.hoisted(() => ({
  runTurn: vi.fn(),
  getSecret: vi.fn(async () => "test-key"),
  isSessionUnlocked: vi.fn(() => true),
  undo: vi.fn(async () => ({ success: true })),
  projectState: { hasOpenProject: true },
  undoStackSize: 0,
  settings: {
    defaultLlmProvider: "openai",
    llmModel: "gpt-4o",
    agentAutoConfirm: false,
    agentDryRun: false,
  },
}));

vi.mock("@openreel/agent", () => ({
  runTurn: h.runTurn,
  toAnthropicTools: () => [],
  toOpenAITools: () => [],
  buildSystemPrompt: () => "system",
}));

vi.mock("../services/secure-storage", () => ({
  isSessionUnlocked: h.isSessionUnlocked,
  getSecret: h.getSecret,
}));

vi.mock("../services/agent/live-host", () => ({
  LiveEditorHost: class {},
}));

vi.mock("../services/agent/llm-transport", () => ({
  makeBYOKClient: () => ({ complete: vi.fn() }),
}));

vi.mock("../services/agent/models", () => ({
  defaultModelFor: () => "gpt-4o",
  modelsFor: () => [{ id: "gpt-4o", label: "GPT-4o" }],
}));

vi.mock("./settings-store", () => ({
  useSettingsStore: {
    getState: () => h.settings,
  },
}));

vi.mock("./project-store", () => ({
  useProjectStore: {
    getState: () => ({
      hasOpenProject: h.projectState.hasOpenProject,
      undo: h.undo,
      actionExecutor: {
        getHistory: () => ({ getUndoStackSize: () => h.undoStackSize }),
      },
    }),
  },
}));

import { useChatStore } from "./chat-store";

type RunTurnImpl = (input: RunTurnInput) => Promise<RunTurnResult>;
type RunTurnImplLoose = (
  input: RunTurnInput,
) => Promise<Omit<RunTurnResult, "usage"> & Partial<Pick<RunTurnResult, "usage">>>;
const impl = (fn: RunTurnImplLoose): RunTurnImpl => async (input) => {
  const result = await fn(input);
  return { usage: { inputTokens: 0, outputTokens: 0 }, ...result };
};

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const store = () => useChatStore.getState();

describe("chat-store", () => {
  beforeEach(() => {
    store().reset();
    vi.clearAllMocks();
    h.getSecret.mockResolvedValue("test-key");
    h.isSessionUnlocked.mockReturnValue(true);
    h.undo.mockResolvedValue({ success: true });
    h.projectState.hasOpenProject = true;
    h.settings.agentAutoConfirm = false;
    h.settings.agentDryRun = false;
    h.undoStackSize = 0;
  });

  it("refuses to run without an open project", async () => {
    h.projectState.hasOpenProject = false;
    await store().send("hello");
    expect(h.runTurn).not.toHaveBeenCalled();
    expect(store().error).toMatch(/project/i);
    expect(store().status).toBe("idle");
  });

  it("refuses to run when the secure session is locked", async () => {
    h.isSessionUnlocked.mockReturnValue(false);
    await store().send("hello");
    expect(h.runTurn).not.toHaveBeenCalled();
    expect(store().error).toMatch(/unlock/i);
  });

  it("ignores empty input", async () => {
    await store().send("   ");
    expect(h.runTurn).not.toHaveBeenCalled();
    expect(store().messages).toHaveLength(0);
  });

  it("runs a turn and records user + assistant messages", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent, messages }) => {
        onEvent?.({ type: "text_delta", text: "working" });
        onEvent?.({ type: "turn_complete", text: "Done!" });
        return {
          text: "Done!",
          messages: [
            ...messages,
            { role: "assistant", content: "Done!", toolUses: [] },
          ],
          toolCalls: 0,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("hello");
    const st = store();
    expect(st.status).toBe("idle");
    expect(st.lastTurnCommitted).toBe(true);
    expect(st.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(st.messages[0].text).toBe("hello");
    expect(st.messages[1].text).toBe("Done!");
    expect(st.conversation.at(-1)).toEqual({
      role: "assistant",
      content: "Done!",
      toolUses: [],
    });
  });

  it("accumulates token usage across turns", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "ok",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
        usage: { inputTokens: 100, outputTokens: 40 },
      })),
    );

    await store().send("one");
    await store().send("two");

    expect(store().usage).toEqual({ inputTokens: 200, outputTokens: 80 });
  });

  it("reflects tool calls and results on the assistant message", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent }) => {
        const call = { id: "t1", name: "addTextClip", args: { text: "Hi" } };
        onEvent?.({ type: "tool_call", call });
        onEvent?.({
          type: "tool_result",
          call,
          result: { ok: true, summary: "Added text" },
        });
        onEvent?.({ type: "turn_complete", text: "Added." });
        return {
          text: "Added.",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("add text");
    const assistant = store().messages.find((m) => m.role === "assistant");
    expect(assistant?.toolCalls).toHaveLength(1);
    expect(assistant?.toolCalls[0].status).toBe("done");
    expect(assistant?.toolCalls[0].result?.summary).toBe("Added text");
  });

  it("marks rejected tool results distinctly from errors", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent }) => {
        const call = { id: "t1", name: "deleteClip", args: {} };
        onEvent?.({ type: "tool_call", call });
        onEvent?.({
          type: "tool_result",
          call,
          result: {
            ok: false,
            summary: "Rejected by user",
            error: { code: "REJECTED", message: "User rejected this action" },
          },
        });
        return {
          text: "",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("delete");
    const assistant = store().messages.find((m) => m.role === "assistant");
    expect(assistant?.toolCalls[0].status).toBe("rejected");
  });

  it("gates destructive calls through pendingConfirm", async () => {
    let decision: string | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ onEvent, confirmGate }) => {
        const call = { id: "t1", name: "deleteClip", args: {} };
        onEvent?.({ type: "tool_call", call });
        decision = await confirmGate!(call);
        onEvent?.({
          type: "tool_result",
          call,
          result: { ok: true, summary: "Deleted" },
        });
        return {
          text: "ok",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    const pending = store().send("delete clip");
    await flush();
    expect(store().status).toBe("awaiting_confirm");
    expect(store().pendingConfirm?.call.name).toBe("deleteClip");

    store().resolveConfirm("approve");
    await pending;

    expect(decision).toBe("approve");
    expect(store().status).toBe("idle");
    expect(store().pendingConfirm).toBeNull();
  });

  it("stop() rejects a pending confirmation", async () => {
    let decision: string | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ confirmGate }) => {
        decision = await confirmGate!({
          id: "t1",
          name: "deleteClip",
          args: {},
        });
        return {
          text: "",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: false,
        };
      }),
    );

    const pending = store().send("delete");
    await flush();
    expect(store().status).toBe("awaiting_confirm");

    store().stop();
    await pending;

    expect(decision).toBe("reject");
    expect(store().pendingConfirm).toBeNull();
  });

  it("undoLastTurn undoes once and clears the committed flag", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );

    await store().send("do something");
    expect(store().lastTurnCommitted).toBe(true);

    await store().undoLastTurn();
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(store().lastTurnCommitted).toBe(false);

    await store().undoLastTurn();
    expect(h.undo).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error result as error status", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent, messages }) => {
        onEvent?.({
          type: "error",
          error: { code: "LOOP_ERROR", message: "boom" },
        });
        return {
          text: "",
          messages,
          toolCalls: 0,
          stoppedReason: "error",
          committed: false,
        };
      }),
    );

    await store().send("break it");
    expect(store().status).toBe("error");
    expect(store().error).toBe("boom");
    expect(store().lastTurnCommitted).toBe(false);
  });

  it("auto-approves destructive calls when the policy is on (no confirm UI)", async () => {
    h.settings.agentAutoConfirm = true;
    let decision: string | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ confirmGate }) => {
        decision = await confirmGate!({ id: "t1", name: "deleteClip", args: {} });
        return {
          text: "ok",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("delete it");
    expect(decision).toBe("approve_for_turn");
    expect(store().pendingConfirm).toBeNull();
    expect(store().status).toBe("idle");
  });

  it("passes dryRun to runTurn when the dry-run policy is on", async () => {
    h.settings.agentDryRun = true;
    let sawDryRun: boolean | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ dryRun, messages }) => {
        sawDryRun = dryRun;
        return {
          text: "planned",
          messages,
          toolCalls: 0,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("plan an edit");
    expect(sawDryRun).toBe(true);
  });

  it("treats Stop as a clean stop, not an error", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ confirmGate }) => {
        await confirmGate!({ id: "t1", name: "deleteClip", args: {} });
        return {
          text: "",
          messages: [],
          toolCalls: 1,
          stoppedReason: "error",
          committed: false,
        };
      }),
    );
    const pending = store().send("delete it");
    await flush();
    expect(store().status).toBe("awaiting_confirm");
    const controller = store().abortController;
    store().stop();
    expect(controller?.signal.aborted).toBe(true);
    await pending;
    expect(store().status).toBe("idle");
    expect(store().error).toBeNull();
  });

  it("discards an in-flight completion after reset()", async () => {
    let release: (() => void) | undefined;
    h.runTurn.mockImplementation(
      impl(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                text: "late",
                messages: [{ role: "assistant", content: "late", toolUses: [] }],
                toolCalls: 0,
                stoppedReason: "end_turn",
                committed: true,
              });
          }),
      ),
    );
    const pending = store().send("hi");
    await flush();
    expect(store().messages.length).toBeGreaterThan(0);
    store().reset();
    expect(store().messages).toHaveLength(0);
    release?.();
    await pending;
    // The superseded completion must not write messages/committed back.
    expect(store().messages).toHaveLength(0);
    expect(store().lastTurnCommitted).toBe(false);
  });

  it("undoLastTurn becomes a no-op once a later edit lands on the undo stack", async () => {
    h.undoStackSize = 0;
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "",
        messages,
        toolCalls: 1,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );
    await store().send("do");
    expect(store().lastTurnCommitted).toBe(true);
    // Simulate a manual edit after the turn (undo stack advanced).
    h.undoStackSize = 3;
    await store().undoLastTurn();
    expect(h.undo).not.toHaveBeenCalled();
    expect(store().lastTurnCommitted).toBe(false);
  });

  it("ignores a second send while a turn is running", async () => {
    let release: (() => void) | undefined;
    h.runTurn.mockImplementation(
      impl(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                text: "",
                messages: [],
                toolCalls: 0,
                stoppedReason: "end_turn",
                committed: true,
              });
          }),
      ),
    );
    const first = store().send("first");
    await flush();
    expect(store().status).toBe("running");
    await store().send("second");
    expect(h.runTurn).toHaveBeenCalledTimes(1);
    expect(store().messages.filter((m) => m.role === "user")).toHaveLength(1);
    release?.();
    await first;
  });

  it("reset clears conversation state", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );
    await store().send("hi");
    expect(store().messages.length).toBeGreaterThan(0);

    store().reset();
    expect(store().messages).toHaveLength(0);
    expect(store().conversation).toHaveLength(0);
    expect(store().lastTurnCommitted).toBe(false);
    expect(store().status).toBe("idle");
  });
});

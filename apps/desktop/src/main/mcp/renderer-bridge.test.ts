import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../../shared/channels";

type Handler = (event: unknown, payload?: unknown) => void;
const ipcHandlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    on: (channel: string, handler: Handler) => void ipcHandlers.set(channel, handler),
    removeListener: (channel: string) => void ipcHandlers.delete(channel),
  },
}));

import {
  LONG_RUNNING_TIMEOUT_MS,
  PRIME_WAIT_MS,
  STANDARD_CALL_TIMEOUT_MS,
  installRendererBridge,
  queuedRequestCount,
  teardownRendererBridge,
} from "./renderer-bridge";
import { registerEditorWindow, resetEditorWindowForTests, setEditorWindowFactory } from "./editor-window";

interface FakeContents {
  sent: Array<{ channel: string; payload: { callId: string; kind: string; name?: string } }>;
  send(channel: string, payload: { callId: string; kind: string; name?: string }): void;
  isDestroyed(): boolean;
  navHandler?: (...args: unknown[]) => void;
  on(event: string, fn: (...args: unknown[]) => void): void;
  removeListener(): void;
}

function fakeWindow(label: string) {
  const contents: FakeContents = {
    sent: [],
    send(channel, payload) {
      contents.sent.push({ channel, payload });
    },
    isDestroyed: () => false,
    on: (event, fn) => {
      if (event === "did-start-navigation") contents.navHandler = fn;
    },
    removeListener: () => undefined,
  };
  const listeners = new Map<string, () => void>();
  const win = {
    label,
    webContents: contents,
    isDestroyed: () => false,
    once: (event: string, fn: () => void) => void listeners.set(event, fn),
  };
  return { win, contents, close: () => listeners.get("closed")?.() };
}

const ready = (contents: FakeContents) => ipcHandlers.get(CHANNELS.mcpReady)!({ sender: contents });
const respond = (callId: string, result: unknown) =>
  ipcHandlers.get(CHANNELS.mcpResponse)!({}, { callId, ok: true, result });

/** Lets queued microtasks (the lazy listTools priming) run. */
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};

const TOOLS = [
  { name: "export_video", description: "", inputSchema: {}, _meta: { "openreel/expensive": true } },
  { name: "add_text", description: "", inputSchema: {}, _meta: { "openreel/expensive": false } },
];

describe("renderer bridge", () => {
  beforeEach(() => {
    ipcHandlers.clear();
    resetEditorWindowForTests();
  });
  afterEach(() => {
    teardownRendererBridge();
    resetEditorWindowForTests();
    vi.useRealTimers();
  });

  it("routes to the registered editor window, not another window", async () => {
    const editor = fakeWindow("editor");
    registerEditorWindow(editor.win as never);
    const provider = installRendererBridge();
    ready(editor.contents);
    const pending = provider.listTools();
    expect(editor.contents.sent).toHaveLength(1);
    expect(editor.contents.sent[0].payload.kind).toBe("listTools");
    respond(editor.contents.sent[0].payload.callId, TOOLS);
    await expect(pending).resolves.toHaveLength(2);
  });

  it("creates a hidden editor window on demand when none exists, and waits for mcpReady", async () => {
    const created = fakeWindow("on-demand");
    const factory = vi.fn(() => created.win as never);
    setEditorWindowFactory(factory);
    // A previous editor window that has since closed.
    const old = fakeWindow("old");
    registerEditorWindow(old.win as never);
    old.close();

    const provider = installRendererBridge();
    const pending = provider.listTools();
    expect(factory).toHaveBeenCalledTimes(1);
    // The renderer is still booting: the request is held, not dropped.
    expect(created.contents.sent).toHaveLength(0);
    expect(queuedRequestCount()).toBe(1);

    ready(created.contents);
    expect(queuedRequestCount()).toBe(0);
    expect(created.contents.sent).toHaveLength(1);
    respond(created.contents.sent[0].payload.callId, TOOLS);
    await expect(pending).resolves.toHaveLength(2);
  });

  it("does not create a second window for further requests", async () => {
    const created = fakeWindow("on-demand");
    const factory = vi.fn(() => created.win as never);
    setEditorWindowFactory(factory);
    const provider = installRendererBridge();
    void provider.listTools().catch(() => undefined);
    void provider.listTools().catch(() => undefined);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("fails with NO_WINDOW when no window exists and none can be created", async () => {
    const provider = installRendererBridge();
    await expect(provider.listTools()).rejects.toMatchObject({ code: "NO_WINDOW" });
  });

  it("expires queued requests so a late mutating call never runs after the client gave up", async () => {
    vi.useFakeTimers();
    const created = fakeWindow("on-demand");
    registerEditorWindow(created.win as never);
    const provider = installRendererBridge();
    // Prime the expensive-tool cache with a ready renderer first.
    ready(created.contents);
    const list = provider.listTools();
    respond(created.contents.sent[0].payload.callId, TOOLS);
    await list;
    created.contents.sent.length = 0;

    // The renderer goes away (reload): the call is queued, then times out.
    teardownReady(created.contents);
    const call = provider.callTool("add_text", { text: "hi" });
    const assertion = expect(call).rejects.toMatchObject({ code: "TIMEOUT" });
    await flush();
    expect(queuedRequestCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(STANDARD_CALL_TIMEOUT_MS);
    await assertion;
    expect(queuedRequestCount()).toBe(0);

    // The renderer comes back: nothing stale is delivered.
    ready(created.contents);
    expect(created.contents.sent).toHaveLength(0);
  });

  it("gives tools flagged expensive the 30 minute budget without a hardcoded name list", async () => {
    vi.useFakeTimers();
    const editor = fakeWindow("editor");
    registerEditorWindow(editor.win as never);
    const provider = installRendererBridge();
    ready(editor.contents);
    const list = provider.listTools();
    respond(editor.contents.sent[0].payload.callId, TOOLS);
    await list;

    const heavy = provider.callTool("export_video", {});
    const heavyAssertion = expect(heavy).rejects.toMatchObject({ code: "TIMEOUT" });
    await flush();
    await vi.advanceTimersByTimeAsync(STANDARD_CALL_TIMEOUT_MS + 1_000);
    // Still pending after the standard budget.
    expect(editor.contents.sent.filter((s) => s.payload.kind === "callTool")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LONG_RUNNING_TIMEOUT_MS);
    await heavyAssertion;
  });

  it("primes the expensive cache itself when a tool is called before tools/list", async () => {
    const editor = fakeWindow("editor");
    registerEditorWindow(editor.win as never);
    const provider = installRendererBridge();
    ready(editor.contents);
    const call = provider.callTool("add_text", {});
    await flush();
    expect(editor.contents.sent[0].payload.kind).toBe("listTools");
    respond(editor.contents.sent[0].payload.callId, TOOLS);
    await flush();
    expect(editor.contents.sent[1].payload).toMatchObject({ kind: "callTool", name: "add_text" });
    respond(editor.contents.sent[1].payload.callId, { ok: true, summary: "done" });
    await expect(call).resolves.toEqual({ ok: true, summary: "done" });
  });

  it("shares one prime between concurrent first calls", async () => {
    const editor = fakeWindow("editor");
    registerEditorWindow(editor.win as never);
    const provider = installRendererBridge();
    ready(editor.contents);
    const a = provider.callTool("add_text", {});
    const b = provider.callTool("add_text", {});
    await flush();
    expect(editor.contents.sent.filter((s) => s.payload.kind === "listTools")).toHaveLength(1);
    respond(editor.contents.sent[0].payload.callId, TOOLS);
    await flush();
    const calls = editor.contents.sent.filter((s) => s.payload.kind === "callTool");
    expect(calls).toHaveLength(2);
    for (const c of calls) respond(c.payload.callId, { ok: true, summary: "x" });
    await Promise.all([a, b]);
  });

  it("does not hold the first call past PRIME_WAIT_MS when the prime is slow", async () => {
    vi.useFakeTimers();
    const editor = fakeWindow("editor");
    registerEditorWindow(editor.win as never);
    const provider = installRendererBridge();
    ready(editor.contents);
    const call = provider.callTool("add_text", {});
    await flush();
    await vi.advanceTimersByTimeAsync(PRIME_WAIT_MS + 10);
    const sent = editor.contents.sent.filter((s) => s.payload.kind === "callTool");
    expect(sent).toHaveLength(1);
    // The slow prime still lands later and fills the cache without affecting this call.
    respond(editor.contents.sent[0].payload.callId, TOOLS);
    respond(sent[0].payload.callId, { ok: true, summary: "done" });
    await expect(call).resolves.toEqual({ ok: true, summary: "done" });
  });
});

/** Simulates a main-frame navigation: the renderer's listener is gone until it announces again. */
function teardownReady(contents: FakeContents): void {
  // The bridge forgets readiness when it sees a new-document navigation on the ready sender.
  contents.navHandler?.({}, "", false, true);
}

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentBridge } from "./agent-bridge";

const { mockExecuteAction, mockUndo, mockRedo, mockImportMedia, mockSubscribe } =
  vi.hoisted(() => ({
    mockExecuteAction: vi.fn(),
    mockUndo: vi.fn(),
    mockRedo: vi.fn(),
    mockImportMedia: vi.fn(),
    mockSubscribe: vi.fn(() => () => {}),
  }));

const fakeProject = { id: "p-1", name: "test", mediaLibrary: { items: [] } };

vi.mock("../stores/project-store", () => ({
  useProjectStore: {
    getState: () => ({
      project: fakeProject,
      executeAction: mockExecuteAction,
      undo: mockUndo,
      redo: mockRedo,
      importMedia: mockImportMedia,
    }),
    subscribe: mockSubscribe,
  },
}));

vi.mock("@openreel/core", () => ({
  ActionSerializer: class {
    deserialize(json: string) {
      const parsed = JSON.parse(json);
      if (
        typeof parsed.type !== "string" ||
        typeof parsed.id !== "string" ||
        typeof parsed.timestamp !== "number" ||
        typeof parsed.params !== "object" ||
        parsed.params === null
      ) {
        throw new Error("Invalid action JSON: missing required fields");
      }
      return parsed;
    }
  },
}));

/**
 * Minimal in-memory WebSocket double. Mirrors the subset of the WebSocket
 * surface the bridge uses: addEventListener, send, close, readyState, OPEN.
 */
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = FakeWebSocket.OPEN;
  url: string;
  sent: string[] = [];
  private listeners: Record<string, ((ev: unknown) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    (this.listeners[type] ||= []).push(fn);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  /** Test helper: simulate the agent sending us a frame. */
  receive(frame: unknown): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  private emit(type: string, ev: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("AgentBridge", () => {
  let bridge: AgentBridge;
  let socket: FakeWebSocket | null = null;

  const FakeWebSocketCtor = vi
    .fn()
    .mockImplementation((url: string) => {
      socket = new FakeWebSocket(url);
      return socket;
    }) as unknown as typeof WebSocket;
  // The bridge reads `wsImpl.OPEN` to compare readyState.
  (FakeWebSocketCtor as unknown as { OPEN: number }).OPEN = FakeWebSocket.OPEN;

  beforeEach(() => {
    socket = null;
    mockExecuteAction.mockReset();
    mockUndo.mockReset();
    mockRedo.mockReset();
    mockImportMedia.mockReset();
    mockSubscribe.mockClear();
    bridge = new AgentBridge({
      url: "ws://test",
      webSocketImpl: FakeWebSocketCtor,
    });
  });

  afterEach(() => {
    bridge.dispose();
  });

  it("starts uninitialized", () => {
    expect(bridge.isInitialized()).toBe(false);
  });

  it("opens a WebSocket and emits a 'ready' frame on connect", async () => {
    bridge.initialize();
    expect(bridge.isInitialized()).toBe(true);
    await flush();

    expect(socket).not.toBeNull();
    const sent = JSON.parse(socket!.sent[0]);
    expect(sent.kind).toBe("ready");
    expect(sent.projectId).toBe("p-1");
    expect(sent.project).toEqual(fakeProject);
  });

  it("dispatches an Action through the project store and replies with the result", async () => {
    mockExecuteAction.mockResolvedValue({ success: true, actionId: "a-1" });
    bridge.initialize();
    await flush();

    socket!.receive({
      kind: "dispatch",
      requestId: "r-1",
      action: {
        type: "track/add",
        id: "a-1",
        timestamp: 123,
        params: { trackType: "video" },
      },
    });
    await flush();

    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
    expect(mockExecuteAction.mock.calls[0][0]).toMatchObject({
      type: "track/add",
      id: "a-1",
    });

    const reply = JSON.parse(socket!.sent[1]);
    expect(reply).toMatchObject({
      kind: "dispatchResult",
      requestId: "r-1",
      success: true,
      actionId: "a-1",
    });
  });

  it("returns INVALID_PARAMS when the action JSON is malformed", async () => {
    bridge.initialize();
    await flush();

    socket!.receive({
      kind: "dispatch",
      requestId: "r-bad",
      action: { not: "an action" },
    });
    await flush();

    expect(mockExecuteAction).not.toHaveBeenCalled();
    const reply = JSON.parse(socket!.sent[1]);
    expect(reply.success).toBe(false);
    expect(reply.error.code).toBe("INVALID_PARAMS");
  });

  it("forwards undo and redo to the project store", async () => {
    mockUndo.mockResolvedValue({ success: true });
    mockRedo.mockResolvedValue({ success: true });
    bridge.initialize();
    await flush();

    socket!.receive({ kind: "undo", requestId: "u-1" });
    await flush();
    socket!.receive({ kind: "redo", requestId: "r-1" });
    await flush();

    expect(mockUndo).toHaveBeenCalledTimes(1);
    expect(mockRedo).toHaveBeenCalledTimes(1);
    const undoReply = JSON.parse(socket!.sent[1]);
    const redoReply = JSON.parse(socket!.sent[2]);
    expect(undoReply).toMatchObject({
      kind: "dispatchResult",
      requestId: "u-1",
      success: true,
    });
    expect(redoReply).toMatchObject({
      kind: "dispatchResult",
      requestId: "r-1",
      success: true,
    });
  });

  it("returns the current project state on getProjectState", async () => {
    bridge.initialize();
    await flush();

    socket!.receive({ kind: "getProjectState", requestId: "g-1" });
    await flush();

    const reply = JSON.parse(socket!.sent[1]);
    expect(reply).toMatchObject({
      kind: "projectState",
      requestId: "g-1",
      project: fakeProject,
    });
  });

  it("stops dispatchMany on the first failure", async () => {
    mockExecuteAction
      .mockResolvedValueOnce({ success: true, actionId: "a-1" })
      .mockResolvedValueOnce({
        success: false,
        error: { code: "CLIP_NOT_FOUND", message: "nope" },
      });
    bridge.initialize();
    await flush();

    socket!.receive({
      kind: "dispatchMany",
      requestId: "m-1",
      actions: [
        { type: "x/y", id: "1", timestamp: 1, params: {} },
        { type: "x/y", id: "2", timestamp: 2, params: {} },
        { type: "x/y", id: "3", timestamp: 3, params: {} },
      ],
    });
    await flush();

    expect(mockExecuteAction).toHaveBeenCalledTimes(2);
    const reply = JSON.parse(socket!.sent[1]);
    expect(reply.success).toBe(false);
    expect(reply.results).toHaveLength(2);
    expect(reply.error.code).toBe("CLIP_NOT_FOUND");
  });

  it("dispose() unsubscribes from the project store and closes the socket", async () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockReturnValueOnce(unsubscribe);
    bridge.initialize();
    await flush();

    bridge.dispose();
    expect(unsubscribe).toHaveBeenCalled();
    expect(socket!.readyState).toBe(FakeWebSocket.CLOSED);
    expect(bridge.isInitialized()).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import { createDispatcher, type BridgeRequest } from "./dispatcher";

function makeDispatcher() {
  const sent: BridgeRequest[] = [];
  let n = 0;
  const dispatcher = createDispatcher({
    send: (req) => sent.push(req),
    genId: () => `call-${++n}`,
  });
  return { dispatcher, sent };
}

describe("createDispatcher", () => {
  it("correlates a response back to its request by callId", async () => {
    const { dispatcher, sent } = makeDispatcher();
    const pending = dispatcher.request("listTools");
    expect(sent).toEqual([{ callId: "call-1", kind: "listTools" }]);
    expect(dispatcher.pendingCount).toBe(1);

    dispatcher.handleResponse({ callId: "call-1", ok: true, result: ["a"] });
    await expect(pending).resolves.toEqual(["a"]);
    expect(dispatcher.pendingCount).toBe(0);
  });

  it("rejects when the response carries an error", async () => {
    const { dispatcher } = makeDispatcher();
    const pending = dispatcher.request("callTool", { name: "x" });
    dispatcher.handleResponse({ callId: "call-1", ok: false, error: "boom" });
    await expect(pending).rejects.toThrow("boom");
  });

  it("keeps concurrent calls independent", async () => {
    const { dispatcher } = makeDispatcher();
    const a = dispatcher.request("callTool", { name: "a" });
    const b = dispatcher.request("callTool", { name: "b" });
    expect(dispatcher.pendingCount).toBe(2);
    dispatcher.handleResponse({ callId: "call-2", ok: true, result: "B" });
    dispatcher.handleResponse({ callId: "call-1", ok: true, result: "A" });
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });

  it("ignores responses for unknown callIds", () => {
    const { dispatcher } = makeDispatcher();
    expect(() =>
      dispatcher.handleResponse({ callId: "nope", ok: true, result: 1 }),
    ).not.toThrow();
  });

  it("times out a request that never gets a response", async () => {
    vi.useFakeTimers();
    try {
      const { dispatcher } = makeDispatcher();
      const pending = dispatcher.request("listTools", {}, 5_000);
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
      expect(dispatcher.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects synchronously if send throws", async () => {
    const dispatcher = createDispatcher({
      send: () => {
        throw new Error("no window");
      },
      genId: () => "call-1",
    });
    await expect(dispatcher.request("listTools")).rejects.toThrow("no window");
    expect(dispatcher.pendingCount).toBe(0);
  });

  it("rejectAll clears and rejects every pending call", async () => {
    const { dispatcher } = makeDispatcher();
    const a = dispatcher.request("callTool", { name: "a" });
    const b = dispatcher.request("callTool", { name: "b" });
    dispatcher.rejectAll("shutting down");
    await expect(a).rejects.toThrow("shutting down");
    await expect(b).rejects.toThrow("shutting down");
    expect(dispatcher.pendingCount).toBe(0);
  });
});

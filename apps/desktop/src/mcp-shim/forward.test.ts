import { describe, it, expect, vi } from "vitest";
import { forwardLine } from "./index";

describe("forwardLine", () => {
  it("returns null for blank lines without calling post", async () => {
    const post = vi.fn();
    expect(await forwardLine("   ", post)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("returns null for unparseable lines", async () => {
    const post = vi.fn();
    expect(await forwardLine("not json", post)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("forwards a request and serializes the response", async () => {
    const post = vi.fn().mockResolvedValue({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const out = await forwardLine('{"jsonrpc":"2.0","id":1,"method":"ping"}', post);
    expect(post).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(JSON.parse(out!)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("emits nothing for notifications (post returns null)", async () => {
    const post = vi.fn().mockResolvedValue(null);
    const out = await forwardLine(
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      post,
    );
    expect(out).toBeNull();
  });

  it("returns a JSON-RPC error for a failed request with an id", async () => {
    const post = vi.fn().mockRejectedValue(new Error("connection refused"));
    const out = await forwardLine('{"jsonrpc":"2.0","id":9,"method":"tools/list"}', post);
    expect(JSON.parse(out!)).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32000, message: "connection refused" },
    });
  });

  it("swallows errors for failed notifications", async () => {
    const post = vi.fn().mockRejectedValue(new Error("connection refused"));
    const out = await forwardLine('{"jsonrpc":"2.0","method":"ping/notify"}', post);
    expect(out).toBeNull();
  });
});

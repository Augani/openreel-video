import { describe, it, expect, vi } from "vitest";
import {
  EndpointMissingError,
  EndpointUnreadableError,
  HttpStatusError,
  NOT_RUNNING_MESSAGE,
  createRetryingPoster,
  forwardLine,
  runDoctor,
} from "./index";

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

const EP_A = { url: "http://127.0.0.1:4001/mcp", port: 4001, token: "aaa" };
const EP_B = { url: "http://127.0.0.1:4002/mcp", port: 4002, token: "bbb" };
const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

describe("createRetryingPoster", () => {
  it("re-reads the endpoint and retries once after a 401 (token rotated)", async () => {
    const readEndpoint = vi.fn().mockReturnValueOnce(EP_A).mockReturnValueOnce({ ...EP_A, token: "rotated" });
    const post = vi
      .fn()
      .mockRejectedValueOnce(new HttpStatusError(401, "Unauthorized"))
      .mockResolvedValueOnce({ result: "ok" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const poster = createRetryingPoster({ readEndpoint, post, sleep });
    await expect(poster({ id: 1, method: "ping" })).resolves.toEqual({ result: "ok" });
    expect(readEndpoint).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].token).toBe("rotated");
    // The endpoint changed, so there is no reason to wait before retrying.
    expect(sleep).not.toHaveBeenCalled();
  });

  it("follows an app relaunch to a new port after ECONNREFUSED", async () => {
    const readEndpoint = vi.fn().mockReturnValueOnce(EP_A).mockReturnValueOnce(EP_B);
    const post = vi.fn().mockRejectedValueOnce(refused).mockResolvedValueOnce({ result: 1 });
    const poster = createRetryingPoster({ readEndpoint, post, sleep: vi.fn() });
    await poster({ id: 1, method: "tools/list" });
    expect(post.mock.calls[1][0]).toEqual(EP_B);
  });

  it("re-reads once when the endpoint file is half written", async () => {
    const readEndpoint = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new EndpointUnreadableError("/tmp/ep.json");
      })
      .mockReturnValueOnce(EP_A);
    const post = vi.fn().mockResolvedValue({ result: 1 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await createRetryingPoster({ readEndpoint, post, sleep })({ id: 1, method: "ping" });
    expect(readEndpoint).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith(EP_A, expect.anything());
  });

  it("waits briefly when the endpoint file is unchanged, then retries once", async () => {
    const readEndpoint = vi.fn().mockReturnValue(EP_A);
    const post = vi.fn().mockRejectedValueOnce(refused).mockResolvedValueOnce({ result: 1 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await createRetryingPoster({ readEndpoint, post, sleep })({ id: 1, method: "ping" });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("gives a clear message when the retry also fails", async () => {
    const readEndpoint = vi.fn().mockReturnValue(EP_A);
    const post = vi.fn().mockRejectedValue(refused);
    const poster = createRetryingPoster({ readEndpoint, post, sleep: vi.fn() });
    await expect(poster({ id: 1, method: "ping" })).rejects.toThrow(NOT_RUNNING_MESSAGE);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("reports not-running when the endpoint file is missing", async () => {
    const readEndpoint = vi.fn(() => {
      throw new EndpointMissingError();
    });
    const poster = createRetryingPoster({ readEndpoint, post: vi.fn(), sleep: vi.fn() });
    await expect(poster({ id: 1, method: "ping" })).rejects.toThrow("OpenReel isn't running. Start the app and retry.");
  });

  it("does not retry other HTTP errors", async () => {
    const post = vi.fn().mockRejectedValue(new HttpStatusError(500, "boom"));
    const poster = createRetryingPoster({ readEndpoint: () => EP_A, post, sleep: vi.fn() });
    await expect(poster({ id: 1, method: "ping" })).rejects.toThrow("HTTP 500");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("surfaces the not-running message through forwardLine as a -32000 error", async () => {
    const poster = createRetryingPoster({
      readEndpoint: () => {
        throw new EndpointMissingError();
      },
      post: vi.fn(),
    });
    const out = await forwardLine('{"jsonrpc":"2.0","id":3,"method":"tools/list"}', poster);
    expect(JSON.parse(out!).error).toEqual({ code: -32000, message: NOT_RUNNING_MESSAGE });
  });
});

describe("runDoctor", () => {
  const base = { endpointFile: "/home/u/.openreel/mcp-endpoint.json", nodeVersion: "v20.11.0" };

  it("passes when the server initializes and lists tools", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ result: { protocolVersion: "2025-06-18", serverInfo: { version: "1.2.3" } } })
      .mockResolvedValueOnce({ result: { tools: [{}, {}, {}] } });
    const report = await runDoctor({ ...base, readEndpoint: () => EP_A, post });
    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain("tools/list OK (3 tools)");
  });

  it("tells the user to start the app when the endpoint file is missing", async () => {
    const report = await runDoctor({
      ...base,
      readEndpoint: () => {
        throw new EndpointMissingError();
      },
      post: vi.fn(),
    });
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toMatch(/Start the OpenReel desktop app/);
  });

  it("flags a stale endpoint file when nothing is listening", async () => {
    const report = await runDoctor({ ...base, readEndpoint: () => EP_A, post: vi.fn().mockRejectedValue(refused) });
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toMatch(/stale/);
  });

  it("flags a rejected token", async () => {
    const report = await runDoctor({
      ...base,
      readEndpoint: () => EP_A,
      post: vi.fn().mockRejectedValue(new HttpStatusError(401, "Unauthorized")),
    });
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toMatch(/401/);
  });

  it("rejects an old Node", async () => {
    const report = await runDoctor({ ...base, nodeVersion: "v16.0.0", readEndpoint: () => EP_A, post: vi.fn() });
    expect(report.ok).toBe(false);
  });
});

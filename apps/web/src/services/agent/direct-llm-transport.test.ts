import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDirectBYOKClient, validateAIEndpoint } from "./direct-llm-transport";

afterEach(() => { vi.unstubAllGlobals(); });
describe("direct BYOK adapters", () => {
  it.each(["http://example.com/v1", "https://user:pass@example.com/v1", "https://example.com/v1?key=x", "javascript:alert(1)"])("rejects unsafe endpoint %s", (url) => expect(() => validateAIEndpoint(url)).toThrow());
  it("supports localhost without authentication and custom model IDs", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ready" }, finish_reason: "stop" }] }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    const client = makeDirectBYOKClient({ provider: "compatible", baseUrl: "http://localhost:1234/v1/", model: "custom/model", apiKey: "" });
    expect((await client.complete({ messages: [], tools: [] })).text).toBe("ready");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, globalThis.RequestInit];
    expect(url).toBe("http://localhost:1234/v1/chat/completions"); expect(init.credentials).toBe("omit"); expect(init.redirect).toBe("error"); expect(JSON.parse(init.body as string).model).toBe("custom/model");
  });
  it("uses the Anthropic adapter and never exposes upstream credential echoes in errors", async () => {
    const fetch = vi.fn(async () => new Response("fixture-secret-echo", { status: 401 })); vi.stubGlobal("fetch", fetch);
    const client = makeDirectBYOKClient({ provider: "anthropic", baseUrl: "https://example.com/v1", model: "fixture-model", apiKey: "fixture-key" });
    await expect(client.complete({ messages: [], tools: [] })).rejects.toThrow(/HTTP 401/);
    await expect(client.complete({ messages: [], tools: [] })).rejects.not.toThrow(/fixture-secret/);
  });
  it("explains browser network/CORS failure without proxying", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const client = makeDirectBYOKClient({ provider: "openai", baseUrl: "https://example.com/v1", model: "fixture", apiKey: "fixture" });
    await expect(client.complete({ messages: [], tools: [] })).rejects.toThrow(/CORS/);
  });
});

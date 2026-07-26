import { describe, it, expect, vi } from "vitest";
import { makeNodeLLMSend } from "./node-llm";

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

describe("makeNodeLLMSend", () => {
  it("sends the anthropic key via x-api-key only (never in the body)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    const send = makeNodeLLMSend("anthropic", "sk-ant-secret", fetchFn as unknown as typeof fetch);
    await send({ model: "claude", messages: [] });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("api.anthropic.com");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-secret");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.body).not.toContain("sk-ant-secret");
  });

  it("sends the openai key via Authorization Bearer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    const send = makeNodeLLMSend("openai", "sk-openai", fetchFn as unknown as typeof fetch);
    await send({ model: "gpt-4o" });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("api.openai.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-openai");
  });

  it("sends the gemini key via x-goog-api-key, with the model embedded in the URL", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    const send = makeNodeLLMSend(
      "gemini",
      "gm-secret",
      fetchFn as unknown as typeof fetch,
      "gemini-2.5-flash",
    );
    await send({ contents: [] });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gm-secret");
    expect(init.body).not.toContain("gm-secret");
  });

  it("throws when no key is provided", () => {
    expect(() => makeNodeLLMSend("anthropic", "")).toThrow(/Missing API key/);
  });

  it("throws with the provider + status on a non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
      headers: { get: () => null },
    } as unknown as Response);
    const send = makeNodeLLMSend("openai", "k", fetchFn as unknown as typeof fetch);
    await expect(send({})).rejects.toThrow(/openai 429/);
  });
});

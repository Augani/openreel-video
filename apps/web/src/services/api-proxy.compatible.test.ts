import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  normalizeCompatibleBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
} from "./api-proxy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible API transport", () => {
  it("normalizes base and complete Chat Completions URLs", () => {
    expect(normalizeOpenAICompatibleBaseUrl("https://example.test/v1/")).toBe(
      "https://example.test/v1",
    );
    expect(
      normalizeOpenAICompatibleBaseUrl(
        "http://localhost:11434/v1/chat/completions",
      ),
    ).toBe("http://localhost:11434/v1");
    expect(
      normalizeCompatibleBaseUrl("https://gateway.example/v1/messages"),
    ).toBe("https://gateway.example/v1");
  });

  it("rejects unsafe or ambiguous endpoint URLs", () => {
    expect(() => normalizeOpenAICompatibleBaseUrl("file:///tmp/model"))
      .toThrow(/http/i);
    expect(() => normalizeOpenAICompatibleBaseUrl("https://key@example.test/v1"))
      .toThrow(/credentials/i);
    expect(() => normalizeOpenAICompatibleBaseUrl("https://example.test/v1?key=x"))
      .toThrow(/query/i);
  });

  it("calls a compatible endpoint directly with bearer authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("openai-compatible", "/chat/completions", "secret", {
      method: "POST",
      baseUrl: "https://provider.example/v1",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("supports endpoints that do not require a key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("openai-compatible", "/chat/completions", "", {
      baseUrl: "http://localhost:1234/v1",
    });

    const init = fetchMock.mock.calls[0][1] as globalThis.RequestInit;
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("does not allow caller headers to override compatible endpoint authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("openai-compatible", "/chat/completions", "stored-key", {
      baseUrl: "https://provider.example/v1",
      headers: { authorization: "Bearer injected" },
    });

    const init = fetchMock.mock.calls[0][1] as globalThis.RequestInit;
    expect(init.headers).toEqual({ Authorization: "Bearer stored-key" });
  });

  it("discovers models from OpenAI-compatible endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("openai-compatible", "/models", "stored-key", {
      baseUrl: "https://provider.example/v1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer stored-key" },
      }),
    );
  });

  it("supports Anthropic-compatible messages and model discovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("anthropic-compatible", "/messages", "stored-key", {
      method: "POST",
      baseUrl: "https://gateway.example/v1",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example/v1/messages",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "x-api-key": "stored-key",
          Authorization: "Bearer stored-key",
        },
      }),
    );
  });
});

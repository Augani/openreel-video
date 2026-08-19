import { describe, it, expect } from "vitest";
import { buildUpstreamRequest } from "../src/main/ipc/cloud";

describe("buildUpstreamRequest", () => {
  it("elevenlabs: xi-api-key + base url + path", () => {
    const r = buildUpstreamRequest("elevenlabs", "/voices", "KEY", { method: "GET" });
    expect(r.url).toBe("https://api.elevenlabs.io/v1/voices");
    expect(r.method).toBe("GET");
    expect(r.headers["xi-api-key"]).toBe("KEY");
  });

  it("openai: Authorization Bearer + forwards POST body", () => {
    const r = buildUpstreamRequest("openai", "/chat/completions", "KEY", {
      method: "POST",
      body: '{"model":"gpt-4o-mini"}',
    });
    expect(r.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(r.method).toBe("POST");
    expect(r.headers["Authorization"]).toBe("Bearer KEY");
    expect(r.body).toBe('{"model":"gpt-4o-mini"}');
  });

  it("anthropic: x-api-key + anthropic-version", () => {
    const r = buildUpstreamRequest("anthropic", "/messages", "KEY", { method: "POST", body: "{}" });
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.headers["x-api-key"]).toBe("KEY");
    expect(r.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("merges renderer-supplied non-secret headers (e.g. content-type)", () => {
    const r = buildUpstreamRequest("openai", "/chat/completions", "KEY", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.headers["Authorization"]).toBe("Bearer KEY");
  });

  it("defaults method to GET when omitted", () => {
    const r = buildUpstreamRequest("elevenlabs", "/models", "KEY", {});
    expect(r.method).toBe("GET");
  });

  it("routes an OpenAI-compatible request to its user-defined endpoint", () => {
    const r = buildUpstreamRequest("openai-compatible", "/chat/completions", "CUSTOM", {
      method: "POST",
      baseUrl: "http://localhost:11434/v1/",
      body: "{}",
    });
    expect(r.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(r.headers.Authorization).toBe("Bearer CUSTOM");
  });

  it("allows keyless local compatible endpoints and complete endpoint URLs", () => {
    const r = buildUpstreamRequest("openai-compatible", "/chat/completions", "", {
      baseUrl: "http://127.0.0.1:1234/v1/chat/completions",
    });
    expect(r.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(r.headers.Authorization).toBeUndefined();
  });

  it("does not accept renderer-supplied compatible authorization", () => {
    const r = buildUpstreamRequest("openai-compatible", "/chat/completions", "STORED", {
      baseUrl: "https://provider.example/v1",
      headers: { authorization: "Bearer injected" },
    });
    expect(r.headers.authorization).toBeUndefined();
    expect(r.headers.Authorization).toBe("Bearer STORED");
  });

  it("routes Anthropic-compatible messages and model discovery", () => {
    const message = buildUpstreamRequest(
      "anthropic-compatible",
      "/messages",
      "STORED",
      {
        method: "POST",
        baseUrl: "https://gateway.example/v1/messages",
        body: "{}",
      },
    );
    expect(message.url).toBe("https://gateway.example/v1/messages");
    expect(message.headers["x-api-key"]).toBe("STORED");
    expect(message.headers.Authorization).toBe("Bearer STORED");
    expect(message.headers["anthropic-version"]).toBe("2023-06-01");

    const models = buildUpstreamRequest(
      "anthropic-compatible",
      "/models",
      "",
      { baseUrl: "http://localhost:4000/v1" },
    );
    expect(models.url).toBe("http://localhost:4000/v1/models");
  });
});

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
});

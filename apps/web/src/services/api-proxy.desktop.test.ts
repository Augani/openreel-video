import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch } from "./api-proxy";

let cloudFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cloudFetch = vi.fn().mockResolvedValue({
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode('{"ok":true}').buffer,
  });
  (window as unknown as { openreel: unknown }).openreel = {
    platform: "desktop",
    cloud: { fetch: cloudFetch },
  };
});

afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("apiFetch desktop branch", () => {
  it("routes through window.openreel.cloud.fetch and ignores the passed key", async () => {
    const res = await apiFetch("openai", "/chat/completions", "IGNORED", {
      method: "POST",
      body: "{}",
    });

    expect(cloudFetch).toHaveBeenCalledWith("openai", "/chat/completions", {
      method: "POST",
      headers: undefined,
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("forwards renderer headers and defaults a missing method/body", async () => {
    await apiFetch("elevenlabs", "/voices", "IGNORED", {
      headers: { "x-custom": "v" },
    });
    expect(cloudFetch).toHaveBeenCalledWith("elevenlabs", "/voices", {
      method: undefined,
      headers: { "x-custom": "v" },
      body: undefined,
    });
  });

  it("forwards a custom base URL for desktop-compatible endpoints", async () => {
    await apiFetch("openai-compatible", "/chat/completions", "", {
      method: "POST",
      baseUrl: "http://localhost:11434/v1",
      body: "{}",
    });
    expect(cloudFetch).toHaveBeenCalledWith(
      "openai-compatible",
      "/chat/completions",
      {
        method: "POST",
        headers: undefined,
        body: "{}",
        baseUrl: "http://localhost:11434/v1",
      },
    );
  });

  it("forwards Anthropic-compatible model discovery", async () => {
    await apiFetch("anthropic-compatible", "/models", "", {
      baseUrl: "https://gateway.example/v1",
    });
    expect(cloudFetch).toHaveBeenCalledWith(
      "anthropic-compatible",
      "/models",
      {
        method: undefined,
        headers: undefined,
        body: undefined,
        baseUrl: "https://gateway.example/v1",
      },
    );
  });
});

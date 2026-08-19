import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("../api-proxy", () => ({
  apiFetch: h.apiFetch,
}));

import { makeBYOKClient } from "./llm-transport";

describe("compatible LLM transport", () => {
  beforeEach(() => {
    h.apiFetch.mockReset();
  });

  it("uses OpenAI message formatting for an arbitrary OpenAI-compatible model", async () => {
    h.apiFetch.mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "done" }, finish_reason: "stop" }],
      }),
    );
    const client = makeBYOKClient({
      provider: "openai-compatible",
      baseUrl: "https://gateway.example/v1",
      model: "vendor/custom-tool-model",
      apiKey: "secret",
    });

    await expect(
      client.complete({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      }),
    ).resolves.toMatchObject({ text: "done" });

    expect(h.apiFetch).toHaveBeenCalledWith(
      "openai-compatible",
      "/chat/completions",
      "secret",
      expect.objectContaining({
        baseUrl: "https://gateway.example/v1",
        body: expect.stringContaining('"model":"vendor/custom-tool-model"'),
      }),
    );
    const body = JSON.parse(
      (h.apiFetch.mock.calls[0][3] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("uses Anthropic message formatting for an arbitrary Anthropic-compatible model", async () => {
    h.apiFetch.mockResolvedValue(
      Response.json({
        content: [{ type: "text", text: "done" }],
        stop_reason: "end_turn",
      }),
    );
    const client = makeBYOKClient({
      provider: "anthropic-compatible",
      baseUrl: "https://gateway.example/v1",
      model: "gateway/claude-tool-model",
      apiKey: "secret",
    });

    await expect(
      client.complete({
        system: "edit the video",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      }),
    ).resolves.toMatchObject({ text: "done" });

    const body = JSON.parse(
      (h.apiFetch.mock.calls[0][3] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(h.apiFetch).toHaveBeenCalledWith(
      "anthropic-compatible",
      "/messages",
      "secret",
      expect.objectContaining({ baseUrl: "https://gateway.example/v1" }),
    );
    expect(body).toMatchObject({
      model: "gateway/claude-tool-model",
      max_tokens: 4096,
      system: "edit the video",
    });
  });
});

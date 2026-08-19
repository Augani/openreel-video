import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCompatibleModels } from "./model-discovery";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compatible model discovery", () => {
  it("loads OpenAI-compatible model IDs from GET /models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { id: "local/tool-model", owned_by: "local" },
          { id: "second-model" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverCompatibleModels({
        provider: "openai-compatible",
        baseUrl: "http://localhost:11434/v1/",
        apiKey: "",
      }),
    ).resolves.toEqual([
      { id: "local/tool-model", label: "local/tool-model" },
      { id: "second-model", label: "second-model" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("loads Anthropic-compatible IDs and display names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { id: "gateway/claude", display_name: "Gateway Claude" },
          { id: "gateway/claude", display_name: "Duplicate" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverCompatibleModels({
        provider: "anthropic-compatible",
        baseUrl: "https://gateway.example/v1/messages",
        apiKey: "secret",
      }),
    ).resolves.toEqual([
      { id: "gateway/claude", label: "Gateway Claude" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "secret",
          Authorization: "Bearer secret",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });

  it("surfaces endpoint discovery errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: { message: "Model listing is disabled" } },
          { status: 404 },
        ),
      ),
    );

    await expect(
      discoverCompatibleModels({
        provider: "openai-compatible",
        baseUrl: "https://gateway.example/v1",
        apiKey: "",
      }),
    ).rejects.toThrow("Model listing is disabled");
  });
});

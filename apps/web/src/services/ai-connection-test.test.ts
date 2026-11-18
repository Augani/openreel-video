import { describe, expect, it, vi } from "vitest";
import { LLMHttpError, MockLLMClient, type LLMClient } from "@openreel/agent";
import { NO_TOOLS_MESSAGE, probeToolFor, testAIConnection } from "./ai-connection-test";

vi.mock("./agent/direct-llm-transport", () => ({
  validateAIEndpoint: (url: string) => new URL(url).href,
  makeDirectBYOKClient: () => {
    throw new Error("not used");
  },
}));

const draft = { provider: "openai" as const, baseUrl: "https://example.test/v1", model: "m", apiKey: "k" };
const ok = { text: "OK", toolUses: [], stopReason: "end_turn" as const };
const toolCall = {
  text: "",
  toolUses: [{ id: "1", name: "report_ready", input: { ok: true } }],
  stopReason: "tool_use" as const,
};

describe("testAIConnection", () => {
  it("passes when the model answers and calls the probe tool", async () => {
    const result = await testAIConnection(draft, { makeClient: () => new MockLLMClient([ok, toolCall]) });
    expect(result.ok).toBe(true);
  });

  it("reports the exact no-tools message when the model answers but cannot call tools", async () => {
    const result = await testAIConnection(draft, { makeClient: () => new MockLLMClient([ok, ok]) });
    expect(result).toEqual({ ok: false, reason: "no-tools", message: NO_TOOLS_MESSAGE });
    expect(NO_TOOLS_MESSAGE).toBe("This model answered but can't use editing tools. Try another model.");
  });

  it("maps a 400 on the tool request to the no-tools message", async () => {
    let call = 0;
    const client: LLMClient = {
      complete: async () => {
        call += 1;
        if (call === 1) return ok;
        throw new LLMHttpError("Model endpoint returned HTTP 400.", 400);
      },
    };
    const result = await testAIConnection(draft, { makeClient: () => client });
    expect(result).toMatchObject({ ok: false, reason: "no-tools" });
  });

  it("reports an unreachable endpoint from the first request", async () => {
    const client: LLMClient = {
      complete: async () => {
        throw new Error("The model endpoint could not be reached.");
      },
    };
    const result = await testAIConnection(draft, { makeClient: () => client });
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("tells the user to set OLLAMA_ORIGINS when a local Ollama request cannot be made", async () => {
    const client: LLMClient = {
      complete: async () => {
        throw new TypeError("Failed to fetch");
      },
    };
    const result = await testAIConnection(
      { ...draft, provider: "compatible", baseUrl: "http://localhost:11434/v1", apiKey: "" },
      { makeClient: () => client },
    );
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
    expect(result.ok ? "" : result.message).toContain("OLLAMA_ORIGINS");
  });

  it("validates before sending anything", async () => {
    const make = vi.fn();
    expect(await testAIConnection({ ...draft, apiKey: "" }, { makeClient: make })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await testAIConnection({ ...draft, model: " " }, { makeClient: make })).toMatchObject({ ok: false, reason: "invalid" });
    expect(make).not.toHaveBeenCalled();
  });

  it("formats the probe tool per provider", () => {
    expect(probeToolFor("anthropic")).toMatchObject({ name: "report_ready", input_schema: expect.any(Object) });
    expect(probeToolFor("openai")).toMatchObject({ type: "function", function: { name: "report_ready" } });
  });
});

import { describe, expect, it } from "vitest";
import { useAIConnectionStore } from "../stores/ai-connection-store";
import { HAWSH_AI_MODEL, HAWSH_AI_URL, initHawshAI, isHawshAI } from "./ai";

describe("initHawshAI", () => {
  it("fixes the AI Editor connection to Director's Eyes points, replacing any own key", () => {
    useAIConnectionStore.getState().configure({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "sk-123" });
    initHawshAI();
    const s = useAIConnectionStore.getState();
    expect({ provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey })
      .toEqual({ provider: "compatible", baseUrl: HAWSH_AI_URL, model: HAWSH_AI_MODEL, apiKey: "" });
  });
});

describe("isHawshAI", () => {
  it("matches the editor-ai URL with or without a trailing slash", () => {
    expect(isHawshAI(HAWSH_AI_URL)).toBe(true);
    expect(isHawshAI(`${HAWSH_AI_URL}/`)).toBe(true);
    expect(isHawshAI("https://api.openai.com/v1")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { AI_PROVIDER_DEFAULTS } from "../stores/ai-connection-store";
import { HAWSH_AI_MODEL, HAWSH_AI_URL, isHawshAI, nextConnection } from "./ai";

const def = { provider: "openai" as const, ...AI_PROVIDER_DEFAULTS.openai, apiKey: "" };
const hawsh = { provider: "compatible" as const, baseUrl: HAWSH_AI_URL, model: HAWSH_AI_MODEL, apiKey: "" };

describe("nextConnection", () => {
  it("switches an untouched connection to Director's Eyes on sign-in", () => {
    expect(nextConnection(true, def)).toEqual(hawsh);
  });
  it("never overwrites a connection the user set up", () => {
    expect(nextConnection(true, { ...def, apiKey: "sk-123" })).toBeNull();
    expect(nextConnection(true, { provider: "anthropic", ...AI_PROVIDER_DEFAULTS.anthropic, apiKey: "" })).toBeNull();
    expect(nextConnection(true, hawsh)).toBeNull();
  });
  it("goes back to the default on sign-out only when it was on Director's Eyes", () => {
    expect(nextConnection(false, hawsh)).toEqual(def);
    expect(nextConnection(false, { ...def, apiKey: "sk-123" })).toBeNull();
  });
});

describe("isHawshAI", () => {
  it("matches the editor-ai URL with or without a trailing slash", () => {
    expect(isHawshAI(HAWSH_AI_URL)).toBe(true);
    expect(isHawshAI(`${HAWSH_AI_URL}/`)).toBe(true);
    expect(isHawshAI("https://api.openai.com/v1")).toBe(false);
  });
});

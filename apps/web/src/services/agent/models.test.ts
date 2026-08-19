import { describe, expect, it } from "vitest";
import { defaultModelFor, modelsFor } from "./models";
import type { LlmProvider } from "../../stores/settings-store";

describe("agent model registry", () => {
  it("offers model defaults for both BYOK providers", () => {
    expect(modelsFor("openai").length).toBeGreaterThan(1);
    expect(modelsFor("anthropic").length).toBeGreaterThan(1);
  });

  it("falls back safely when persisted settings name a removed provider", () => {
    const removedProvider = "openai-compatible" as LlmProvider;

    expect(modelsFor(removedProvider)).toEqual(modelsFor("openai"));
    expect(defaultModelFor(removedProvider)).toBe(defaultModelFor("openai"));
  });
});

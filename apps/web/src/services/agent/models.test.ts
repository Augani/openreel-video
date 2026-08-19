import { describe, expect, it } from "vitest";
import {
  defaultModelFor,
  isKnownModel,
  modelsFor,
  resolveModel,
} from "./models";
import type { LlmProvider } from "../../stores/settings-store";

describe("agent model registry", () => {
  it("does not preconfigure models for compatible endpoints", () => {
    expect(modelsFor("openai-compatible")).toEqual([]);
    expect(modelsFor("anthropic-compatible")).toEqual([]);
    expect(defaultModelFor("openai-compatible")).toBe("");
    expect(defaultModelFor("anthropic-compatible")).toBe("");
  });

  it("preserves any model ID entered by the user", () => {
    expect(isKnownModel("openai-compatible", "account-deployment")).toBe(false);
    expect(resolveModel("openai-compatible", "  account-deployment  ")).toBe(
      "account-deployment",
    );
  });

  it("falls back only when a model ID is blank", () => {
    expect(resolveModel("anthropic-compatible", "   ")).toBe("");
  });

  it("falls back safely when persisted settings name a removed provider", () => {
    const removedProvider = "removed-provider" as LlmProvider;

    expect(modelsFor(removedProvider)).toEqual([]);
    expect(defaultModelFor(removedProvider)).toBe("");
  });

  it("falls back safely when a persisted model value is missing", () => {
    expect(resolveModel("openai-compatible", undefined)).toBe("");
  });
});

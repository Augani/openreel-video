import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore, type LlmProvider } from "./settings-store";

describe("settings store migrations", () => {
  afterEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      autoSave: true,
      defaultLlmProvider: "openai",
      llmModel: "gpt-4o",
    });
  });

  it("repairs a removed provider without discarding other preferences", async () => {
    localStorage.setItem(
      "openreel-settings",
      JSON.stringify({
        version: 5,
        state: {
          autoSave: false,
          defaultLlmProvider: "openai-compatible" as LlmProvider,
          llmModel: "account-specific-model",
        },
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      autoSave: false,
      defaultLlmProvider: "openai",
      llmModel: "account-specific-model",
    });
  });
});

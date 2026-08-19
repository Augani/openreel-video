import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  discoverCompatibleModels: vi.fn(),
}));

vi.mock("../../../services/agent/model-discovery", () => ({
  discoverCompatibleModels: h.discoverCompatibleModels,
}));

vi.mock("../../../services/secure-storage", () => ({
  getSecret: vi.fn(async () => ""),
  isSessionUnlocked: vi.fn(() => false),
  onSessionLock: vi.fn(),
}));

vi.mock("@openreel/ui", async () => {
  const actual = await vi.importActual<typeof import("@openreel/ui")>(
    "@openreel/ui",
  );
  return {
    ...actual,
    ToolcraftPopover: ({
      children,
      content,
    }: {
      children: ReactNode;
      content: ReactNode;
    }) => (
      <>
        {children}
        {content}
      </>
    ),
  };
});

import { useSettingsStore } from "../../../stores/settings-store";
import { ProviderModelPicker } from "./ProviderModelPicker";

describe("ProviderModelPicker", () => {
  beforeEach(() => {
    h.discoverCompatibleModels.mockReset();
    useSettingsStore.setState({
      defaultLlmProvider: null,
      llmBaseUrl: "",
      llmModel: "",
      configuredServices: [],
    });
  });

  it("starts unconfigured and accepts either compatible API format", () => {
    render(<ProviderModelPicker />);

    expect(screen.getByRole("button", { name: "Configure AI" })).toBeTruthy();
    const format = screen.getByRole("combobox", { name: "API format" });
    expect(format).toHaveValue("");
    expect(screen.getByRole("option", { name: "OpenAI-compatible" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Anthropic-compatible" })).toBeTruthy();

    fireEvent.change(format, { target: { value: "anthropic-compatible" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
      target: { value: "https://gateway.example/v1" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Model ID" }), {
      target: { value: "gateway/custom-model" },
    });

    expect(useSettingsStore.getState()).toMatchObject({
      defaultLlmProvider: "anthropic-compatible",
      llmBaseUrl: "https://gateway.example/v1",
      llmModel: "gateway/custom-model",
    });
  });

  it("discovers endpoint models without auto-selecting one", async () => {
    h.discoverCompatibleModels.mockResolvedValue([
      { id: "tool-model-a", label: "Tool Model A" },
      { id: "tool-model-b", label: "Tool Model B" },
    ]);
    useSettingsStore.setState({
      defaultLlmProvider: "openai-compatible",
      llmBaseUrl: "http://localhost:11434/v1",
    });
    render(<ProviderModelPicker />);

    fireEvent.click(screen.getByRole("button", { name: "Load models" }));

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Models from endpoint" }),
      ).toBeTruthy(),
    );
    expect(useSettingsStore.getState().llmModel).toBe("");

    fireEvent.change(
      screen.getByRole("combobox", { name: "Models from endpoint" }),
      { target: { value: "tool-model-b" } },
    );
    expect(useSettingsStore.getState().llmModel).toBe("tool-model-b");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIConnectionPanel } from "./AIConnectionPanel";
import { AI_PROVIDER_DEFAULTS, useAIConnectionStore } from "../../../stores/ai-connection-store";

beforeEach(() => useAIConnectionStore.getState().configure({ provider: "openai", ...AI_PROVIDER_DEFAULTS.openai, apiKey: "" }));
afterEach(() => { vi.restoreAllMocks(); });

describe("AI settings session connections", () => {
  it("accepts custom model IDs and localhost endpoints with a keyless compatible adapter", () => {
    render(<AIConnectionPanel />);
    fireEvent.change(screen.getByLabelText("AI provider"), { target: { value: "compatible" } });
    fireEvent.change(screen.getByLabelText("AI base URL"), { target: { value: "http://localhost:11434/v1" } });
    fireEvent.change(screen.getByLabelText("AI model ID"), { target: { value: "my-custom/model" } });
    expect(useAIConnectionStore.getState()).toMatchObject({ provider: "compatible", baseUrl: "http://localhost:11434/v1", model: "my-custom/model", apiKey: "" });
  });
  it("masks and forgets the session key without writing credentials to browser storage", () => {
    const saved = vi.spyOn(Storage.prototype, "setItem");
    render(<AIConnectionPanel />);
    const key = screen.getByLabelText("Session API key");
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(key, { target: { value: "fixture-session-key" } });
    expect(useAIConnectionStore.getState().apiKey).toBe("fixture-session-key");
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Forget key"));
    expect(useAIConnectionStore.getState().apiKey).toBe("");
    expect(saved).not.toHaveBeenCalled();
  });
});

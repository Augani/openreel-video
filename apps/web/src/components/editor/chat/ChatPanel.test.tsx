import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useChatStore } from "../../../stores/chat-store";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { CHAT_STARTER_PROMPTS } from "../../onboarding/ai/starter-prompts";

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }) as MediaQueryList,
  );
  useChatStore.getState().reset();
  useProjectStore.getState().loadProject(createEmptyProject("Chat panel QA"));
  useUIStore.getState().setPanelVisible("agentChat", true);
  useAIConnectionStore.setState({
    provider: "compatible",
    baseUrl: "http://localhost:9911/v1",
    model: "Fixture model",
    apiKey: "",
    remember: false,
  });
});
afterEach(() => {
  cleanup();
  useChatStore.getState().reset();
  vi.restoreAllMocks();
});

describe("ChatPanel empty state", () => {
  it("shows the catalog-honest starter chips and sends one on click", () => {
    const send = vi.fn(async () => undefined);
    useChatStore.setState({ send });
    render(<ChatPanel />);
    for (const prompt of CHAT_STARTER_PROMPTS) {
      expect(screen.getByRole("button", { name: prompt.text })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Make a 9:16 version with a title card" }));
    expect(send).toHaveBeenCalledWith("Make a 9:16 version with a title card");
  });

  it("asks to connect a model when none is configured", () => {
    useAIConnectionStore.setState({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "" });
    render(<ChatPanel />);
    expect(screen.getByRole("button", { name: "Connect a model" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No model connected" })).toBeInTheDocument();
    expect(screen.queryByText(/gpt-4o/i)).toBeNull();
  });
});

describe("ChatPanel keep going", () => {
  const turn = (notice: string) => ({
    status: "idle" as const,
    projectId: useProjectStore.getState().project.id,
    messages: [
      { id: "u", role: "user" as const, text: "Edit it", toolCalls: [] },
      { id: "a", role: "assistant" as const, text: "Partly done", toolCalls: [], notice },
    ],
  });

  it("offers a Keep going button when the turn hit its step cap", () => {
    const send = vi.fn(async () => undefined);
    useChatStore.setState({ ...turn("I stopped after reaching this turn's step limit. Ask me to continue if more work is needed."), send });
    render(<ChatPanel />);
    act(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(send).toHaveBeenCalledWith("Continue where you left off.");
  });

  it("does not offer it for an ordinary notice", () => {
    useChatStore.setState(turn("The edits finished, but the model did not provide a written summary."));
    render(<ChatPanel />);
    expect(screen.queryByRole("button", { name: "Keep going" })).toBeNull();
  });

  it("exposes the coach mark anchors", () => {
    const { container } = render(<ChatPanel />);
    expect(container.querySelector('[data-tour="ai-chat"]')).not.toBeNull();
    expect(container.querySelector('[data-tour="ai-actions"]')).not.toBeNull();
  });
});

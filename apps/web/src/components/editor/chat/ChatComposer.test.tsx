import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./ChatComposer";
import { useChatStore } from "../../../stores/chat-store";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";

const STARTERS = ["Add captions", "Make a 9:16 version", "Balance audio"];

function connect(ready: boolean) {
  useAIConnectionStore.setState({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKey: ready ? "sk-test-fixture" : "",
    remember: false,
  });
}

beforeEach(() => useChatStore.getState().reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useChatStore.getState().reset();
});

describe("ChatComposer connection state", () => {
  it("disables starter chips, Send and submit when no model is connected", () => {
    connect(false);
    const send = vi.fn();
    useChatStore.setState({ send } as never);
    render(<ChatComposer text="Add captions" onTextChange={() => undefined} />);
    for (const name of STARTERS) expect(screen.getByRole("button", { name })).toBeDisabled();
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeDisabled();
    expect(sendButton).toHaveAttribute("title", "Connect a model to send");
    fireEvent.keyDown(screen.getByLabelText("AI edit request"), { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
  });

  it("enables chips and Send, and submits on Enter, once a model is connected", () => {
    connect(true);
    const send = vi.fn();
    useChatStore.setState({ send } as never);
    render(<ChatComposer text="Add captions" onTextChange={() => undefined} />);
    for (const name of STARTERS) expect(screen.getByRole("button", { name })).toBeEnabled();
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeEnabled();
    expect(sendButton).toHaveAttribute("title", "Send");
    fireEvent.keyDown(screen.getByLabelText("AI edit request"), { key: "Enter" });
    expect(send).toHaveBeenCalledWith("Add captions");
  });
});

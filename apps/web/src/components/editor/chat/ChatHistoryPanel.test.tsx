import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useChatHistoryStore } from "../../../stores/chat-history-store";
import { useChatStore } from "../../../stores/chat-store";
import { ChatHistoryPanel } from "./ChatHistoryPanel";

describe("ChatHistoryPanel", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useChatHistoryStore.getState().clearHistory();
    useChatStore.setState({ projectId: "project-a" });
    useChatHistoryStore.getState().saveConversation({
      id: "chat-1",
      projectId: "project-a",
      title: "Fix the opening title",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "message-1",
          role: "user",
          text: "Fix the opening title",
          toolCalls: [],
        },
      ],
      usage: { inputTokens: 12, outputTokens: 4 },
    });
  });

  it("shows project conversations and opens one", () => {
    const onClose = vi.fn();
    render(<ChatHistoryPanel projectId="project-a" onClose={onClose} />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Fix the opening title/ }),
    );

    expect(useChatStore.getState().currentConversationId).toBe("chat-1");
    expect(useChatStore.getState().messages[0].text).toBe(
      "Fix the opening title",
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("starts a new chat from history", () => {
    useChatStore.setState({
      currentConversationId: "chat-1",
      conversationStartedAt: 1,
      messages: useChatHistoryStore.getState().conversations[0].messages,
    });
    const onClose = vi.fn();
    render(<ChatHistoryPanel projectId="project-a" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().currentConversationId).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

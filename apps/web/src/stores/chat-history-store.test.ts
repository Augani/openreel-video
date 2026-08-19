import { beforeEach, describe, expect, it } from "vitest";
import { conversationTitle, useChatHistoryStore } from "./chat-history-store";
import type { ChatMessage } from "./chat-store";

const messages: ChatMessage[] = [
  {
    id: "user-1",
    role: "user",
    text: "Create a strong opening title for this short video",
    toolCalls: [],
  },
  {
    id: "assistant-1",
    role: "assistant",
    text: "Done.",
    toolCalls: [],
  },
];

describe("chat history store", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatHistoryStore.getState().clearHistory();
  });

  it("creates a concise title from the first user request", () => {
    expect(conversationTitle(messages)).toBe(
      "Create a strong opening title for this short video",
    );
  });

  it("saves and updates a project-scoped conversation", () => {
    const save = useChatHistoryStore.getState().saveConversation;
    save({
      id: "chat-1",
      projectId: "project-a",
      title: "Opening title",
      createdAt: 1,
      updatedAt: 2,
      messages,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    save({
      id: "chat-1",
      projectId: "project-a",
      title: "Opening title updated",
      createdAt: 1,
      updatedAt: 3,
      messages,
      usage: { inputTokens: 20, outputTokens: 8 },
    });

    expect(useChatHistoryStore.getState().conversations).toEqual([
      expect.objectContaining({
        id: "chat-1",
        projectId: "project-a",
        title: "Opening title updated",
        updatedAt: 3,
      }),
    ]);
  });

  it("removes a saved conversation", () => {
    useChatHistoryStore.getState().saveConversation({
      id: "chat-1",
      projectId: "project-a",
      title: "Opening title",
      createdAt: 1,
      updatedAt: 2,
      messages,
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    useChatHistoryStore.getState().deleteConversation("chat-1");

    expect(useChatHistoryStore.getState().conversations).toEqual([]);
  });
});

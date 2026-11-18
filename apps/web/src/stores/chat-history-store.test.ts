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
  it("keeps compact navigation metadata while removing large result data", () => {
    const timelineTarget = { projectId: "project-a", id: "title-1", trackId: "titles", kind: "text" as const, startTime: 4, duration: 3 };
    useChatHistoryStore.getState().saveConversation({ id: "saved-target", projectId: "project-a", title: "Title edit", createdAt: 1, updatedAt: 2,
      messages: [{ id: "assistant", role: "assistant", text: "Done", toolCalls: [{ id: "create", name: "create_text_clip", args: {}, status: "done", timelineTarget,
        result: { ok: true, summary: "Created title", data: { id: "title-1", large: "x".repeat(50000) } } }] }], usage: { inputTokens: 1, outputTokens: 1 } });
    const saved = useChatHistoryStore.getState().conversations[0].messages[0].toolCalls[0];
    expect(saved.result?.data).toBeUndefined();
    expect(saved.timelineTarget).toEqual(timelineTarget);
  });

});

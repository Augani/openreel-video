import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, TokenUsage } from "./chat-store";

export interface SavedChatConversation {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: ChatMessage[];
  readonly usage: TokenUsage;
  readonly error?: string;
}

interface ChatHistoryState {
  conversations: SavedChatConversation[];
  saveConversation: (conversation: SavedChatConversation) => void;
  deleteConversation: (conversationId: string) => void;
  clearHistory: () => void;
}

const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 100;

function compactValue(value: unknown, depth = 0): unknown {
  if (depth >= 3) return "[Details omitted]";
  if (typeof value === "string") {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => compactValue(item, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, item]) => [key, compactValue(item, depth + 1)]),
    );
  }
  return value;
}

function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_MESSAGES_PER_CONVERSATION).map((message) => ({
    ...message,
    toolCalls: message.toolCalls.map((call) => ({
      ...call,
      args: compactValue(call.args) as Record<string, unknown>,
      result: call.result
        ? {
            ok: call.result.ok,
            summary: call.result.summary,
            error: call.result.error,
          }
        : undefined,
    })),
  }));
}

export function conversationTitle(messages: ChatMessage[]): string {
  const firstRequest = messages.find(
    (message) => message.role === "user" && message.text.trim(),
  )?.text;
  if (!firstRequest) return "New conversation";
  const title = firstRequest.replace(/\s+/g, " ").trim();
  return title.length > 56 ? `${title.slice(0, 55)}…` : title;
}

export const useChatHistoryStore = create<ChatHistoryState>()(
  persist(
    (set) => ({
      conversations: [],
      saveConversation: (conversation) =>
        set((state) => ({
          conversations: [
            {
              ...conversation,
              messages: compactMessages(conversation.messages),
            },
            ...state.conversations.filter(
              (item) => item.id !== conversation.id,
            ),
          ]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_CONVERSATIONS),
        })),
      deleteConversation: (conversationId) =>
        set((state) => ({
          conversations: state.conversations.filter(
            (item) => item.id !== conversationId,
          ),
        })),
      clearHistory: () => set({ conversations: [] }),
    }),
    {
      name: "openreel-ai-chat-history",
      version: 1,
    },
  ),
);

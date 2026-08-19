import type { JSX, MouseEvent } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { MessageSquareText, Plus, Trash2 } from "@/icons/lucide-compat";
import { useChatHistoryStore } from "../../../stores/chat-history-store";
import { useChatStore } from "../../../stores/chat-store";

function formatUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" }),
  }).format(date);
}

export function ChatHistoryPanel({
  projectId,
  onClose,
}: {
  readonly projectId: string | null;
  readonly onClose: () => void;
}): JSX.Element {
  const conversations = useChatHistoryStore((state) => state.conversations);
  const activeConversationId = useChatStore(
    (state) => state.currentConversationId,
  );
  const openConversation = useChatStore((state) => state.openConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const newChat = useChatStore((state) => state.newChat);
  const visibleConversations = conversations.filter(
    (conversation) => !projectId || conversation.projectId === projectId,
  );

  const removeConversation = (
    event: MouseEvent<HTMLButtonElement>,
    conversationId: string,
  ): void => {
    event.stopPropagation();
    deleteConversation(conversationId);
  };

  return (
    <div className="absolute inset-x-2 top-11 z-30 overflow-hidden rounded-xl border border-border bg-bg-1 shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div>
          <div className="text-[12px] font-semibold text-fg">Conversations</div>
          <div className="mt-0.5 text-[10px] text-fg-muted">
            Saved on this device for this project
          </div>
        </div>
        <Button
          label="New chat"
          size="sm"
          variant="secondary"
          onClick={() => {
            newChat();
            onClose();
          }}
        >
          <Plus size={12} aria-hidden />
        </Button>
      </div>

      <div className="max-h-72 overflow-y-auto p-1.5">
        {visibleConversations.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-bg-2 text-fg-muted">
              <MessageSquareText size={15} aria-hidden />
            </div>
            <div className="mt-2 text-[11px] font-medium text-fg-2">
              No saved conversations yet
            </div>
            <div className="mt-1 max-w-48 text-[10px] leading-relaxed text-fg-muted">
              Completed chats will appear here automatically.
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {visibleConversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <div
                  key={conversation.id}
                  className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "bg-accent-soft text-fg"
                      : "text-fg-2 hover:bg-hover hover:text-fg"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      openConversation(conversation.id);
                      onClose();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <MessageSquareText
                      size={13}
                      className={active ? "shrink-0 text-accent" : "shrink-0 text-fg-muted"}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">
                        {conversation.title}
                      </span>
                      <span className="mt-0.5 block text-[9px] text-fg-muted">
                        {conversation.messages.filter((message) => message.role === "user").length} requests · {formatUpdatedAt(conversation.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <IconButton
                    label={`Delete ${conversation.title}`}
                    icon={<Trash2 size={12} aria-hidden />}
                    size="sm"
                    variant="ghost"
                    onClick={(event) => removeConversation(event, conversation.id)}
                    className="shrink-0 text-fg-muted opacity-0 transition-opacity hover:text-status-error focus:opacity-100 group-hover:opacity-100"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

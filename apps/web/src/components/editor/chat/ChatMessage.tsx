import { memo, type JSX } from "react";
import type { ChatMessage as ChatMessageData } from "../../../stores/chat-store";
import { MarkdownMessage } from "./MarkdownMessage";
import { editingToolReadOnly } from "../../../services/agent/editing-tools";
import { ToolCallCard } from "./ToolCallCard";
import { AssistantIcon } from "./AssistantIcon";

export const ChatMessage = memo(function ChatMessage({
  message,
  pending = false,
}: {
  message: ChatMessageData;
  pending?: boolean;
}): JSX.Element {
  const isUser = message.role === "user";

  return (
    <div
      className={`workspace-chat-message ${isUser ? "is-user" : "is-assistant"}`}
    >
      {!isUser && (
        <div
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${
            isUser ? "bg-bg-2 text-fg-2" : "bg-accent-soft text-accent"
          }`}
        >
          <AssistantIcon />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        {message.text &&
          (isUser ? (
            <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">
              {message.text}
            </div>
          ) : (
            <MarkdownMessage text={message.text} />
          ))}
        {!isUser &&
          pending &&
          !message.text &&
          message.toolCalls.length === 0 && (
            <div
              className="flex items-center gap-1.5 py-1 text-[12px] text-fg-muted"
              role="status"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              <span>Thinking…</span>
            </div>
          )}
        {message.toolCalls.length > 0 && (
          <div className="workspace-tool-results">
            {message.toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} undone={message.editSummary?.undone && !editingToolReadOnly(call.name)} />
            ))}
          </div>
        )}
        {!isUser && message.notice && (
          <div className="rounded-md border border-border bg-bg-2/70 px-2.5 py-2 text-[11px] leading-relaxed text-fg-2">
            {message.notice}
          </div>
        )}
      </div>
    </div>
  );
});

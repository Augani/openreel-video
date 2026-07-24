import type { JSX } from "react";
import { Bot, User } from "@/icons/lucide-compat";
import type { ChatMessage as ChatMessageData } from "../../../stores/chat-store";
import { ToolCallCard } from "./ToolCallCard";

export function ChatMessage({
  message,
}: {
  message: ChatMessageData;
}): JSX.Element {
  const isUser = message.role === "user";

  return (
    <div className="flex gap-2">
      <div
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${
          isUser ? "bg-bg-2 text-fg-2" : "bg-accent-soft text-accent"
        }`}
      >
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {message.text && (
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">
            {message.text}
          </div>
        )}
        {message.toolCalls.length > 0 && (
          <div className="space-y-1">
            {message.toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

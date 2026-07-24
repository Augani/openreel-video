import type { JSX } from "react";
import { useState, useCallback, type KeyboardEvent } from "react";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { Send, Square } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";

export function ChatComposer(): JSX.Element {
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const [text, setText] = useState("");
  const busy = status === "running" || status === "awaiting_confirm";

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    void send(value);
  }, [text, busy, send]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="border-t border-border p-2">
      <div className="relative rounded-lg border border-border bg-bg-2 transition-colors focus-within:border-accent">
        <ToolcraftTextAreaControl
          label="AI edit request"
          isLabelHidden
          value={text}
          onChange={setText}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask the AI to edit your video…"
          inputClassName="block w-full resize-none bg-transparent px-3 py-2 pr-11 text-[13px] text-fg outline-none placeholder:text-fg-muted"
        />
        <div className="absolute bottom-1.5 right-1.5">
          {busy ? (
            <IconButton
              label="Stop"
              icon={<Square size={12} className="fill-current" aria-hidden />}
              size="sm"
              variant="destructive"
              onClick={stop}
              className="grid h-7 w-7 place-items-center rounded-md bg-status-error/15 text-status-error transition-colors hover:bg-status-error/25"
            />
          ) : (
            <IconButton
              label="Send"
              icon={<Send size={12} aria-hidden />}
              size="sm"
              variant="primary"
              onClick={submit}
              isDisabled={!text.trim()}
              className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40"
            />
          )}
        </div>
      </div>
      <div className="mt-1 px-1 text-[10px] text-fg-muted">
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
  );
}

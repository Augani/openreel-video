import type { JSX } from "react";
import { useCallback, useId, type KeyboardEvent, type Dispatch, type SetStateAction } from "react";
import { Button, Textarea } from "@openreel/ui";
import { Square } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { isConnectionReady } from "./ai-connection-labels";

export function ChatComposer({ text, onTextChange: setText }: { text: string; onTextChange: Dispatch<SetStateAction<string>> }): JSX.Element {
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const connection = useAIConnectionStore();
  const connected = isConnectionReady(connection);
  const hintId = useId();
  const busy = status === "running" || status === "awaiting_confirm";

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || busy || !connected) return;
    const before = useChatStore.getState().messages;
    setText("");
    void send(value);
    if (useChatStore.getState().messages === before) setText(current => current || value);
  }, [text, busy, connected, send, setText]);

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
    <div className="workspace-chat-composer">
      <div className="workspace-chat-suggestions">
        {["Add captions", "Make a 9:16 version", "Balance audio"].map((s) => (
          <Button
            key={s}
            variant="outline"
            className="h-auto shrink-0 font-normal leading-[1.4]"
            type="button"
            disabled={!connected}
            onClick={() => setText(s)}
          >
            {s}
          </Button>
        ))}
      </div>
      <div className="workspace-chat-input">
        <Textarea
          aria-label="AI edit request"
          aria-describedby={hintId}
          title="Enter to send · Shift+Enter for a new line"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Describe an edit… e.g. “make a 9:16 version with captions”"
          className="block w-full resize-none bg-transparent p-0 text-fg outline-none placeholder:text-fg-muted"
        />
        <div className="workspace-chat-input-footer">
          <div className="workspace-chat-context">
            <span>@Timeline 1</span>
            <span>Project context</span>
          </div>
          {busy ? (
            <Button
              type="button"
              aria-label="Stop"
              title="Stop"
              size="icon-sm"
              variant="destructive"
              onClick={stop}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-status-error/15 p-0 text-status-error transition-colors hover:bg-status-error/25 [&_svg]:size-3"
            >
              <Square size={12} className="fill-current" aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              aria-label="Send"
              size="icon-sm"
              onClick={submit}
              disabled={!text.trim() || !connected}
              title={connected ? "Send" : "Connect a model to send"}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent p-0 text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40 [&_svg]:size-[15px]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </Button>
          )}
        </div>
      </div>
      <div id={hintId} className="sr-only">
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
  );
}

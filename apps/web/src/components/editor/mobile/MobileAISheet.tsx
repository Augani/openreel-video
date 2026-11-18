import { useEffect, useId, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Button, Dialog, DialogContent, DialogTitle, ScrollArea, Textarea } from "@openreel/ui";
import { Square, ArrowUp } from "lucide-react";
import { useChatStore } from "../../../stores/chat-store";
import { useVoiceEdit } from "../../../hooks/useVoiceEdit";
import { MobileEditorIcon } from "./MobileEditorIcon";
import "./mobile-tools.css";
import "./mobile-ai.css";

export function MobileAISheet({ open, onOpenChange, provider, auxiliary, children, draft, onDraftChange, activity, error, pendingConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; provider: ReactNode; auxiliary: ReactNode; children: ReactNode;
  draft: string; onDraftChange: Dispatch<SetStateAction<string>>; activity: unknown; error: unknown; pendingConfirm: unknown;
}) {
  const contentRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const [sheetTop, setSheetTop] = useState(() => 58 + Math.round(window.innerWidth * 9 / 16));
  useEffect(() => {
    const resize = () => setSheetTop(58 + Math.round(window.innerWidth * 9 / 16));
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [open, activity, error, pendingConfirm]);
  const android = /Android/i.test(navigator.userAgent);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent ref={contentRef} hideCloseButton aria-describedby={undefined} className="mobile-editor-sheet mobile-ai-sheet"
      overlayClassName="mobile-ai-scrim" data-platform={android ? "android" : "ios"}
      style={{ "--mobile-sheet-top": `min(${sheetTop}px, calc(100dvh - 320px))` } as CSSProperties}
      onOpenAutoFocus={event => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}>
      <div className="mobile-sheet-grabber" aria-hidden><span/></div>
      <div className="mobile-sheet-heading"><DialogTitle>AI assist</DialogTitle><Button variant="ghost" aria-label="Close AI assist" onClick={() => onOpenChange(false)}>{android ? <MobileEditorIcon name="close" size={20}/> : "Done"}</Button></div>
      <ScrollArea ref={scrollRef} className="mobile-sheet-scroll"><div className="mobile-ai-content">
        {provider}{auxiliary}<div role="log" aria-label="AI conversation and edit results" aria-live="polite" className="mobile-ai-conversation">{children}</div>
        <MobileAIComposer draft={draft} onDraftChange={onDraftChange} open={open}/>
      </div></ScrollArea>
    </DialogContent>
  </Dialog>;
}

function MobileAIComposer({ draft, onDraftChange, open }: { draft: string; onDraftChange: Dispatch<SetStateAction<string>>; open: boolean }) {
  const status = useChatStore(s => s.status), send = useChatStore(s => s.send), stop = useChatStore(s => s.stop);
  const busy = status === "running" || status === "awaiting_confirm";
  const voice = useVoiceEdit(open && !busy, text => onDraftChange(current => `${current.trimEnd()} ${text}`.trimStart()));
  const voiceHint = useId();
  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const before = useChatStore.getState().messages;
    onDraftChange(""); void send(text);
    if (useChatStore.getState().messages === before) onDraftChange(current => current || text);
  };
  return <div className="mobile-ai-composer">
    <div className="mobile-ai-suggestions">{["Add music", "Make it vertical", "Fix the audio", "Add B-roll"].map(text => <Button key={text} variant="secondary" disabled={busy} onClick={() => onDraftChange(text)}>{text}</Button>)}</div>
    <div className="mobile-ai-input">
      <Textarea aria-label="Describe an edit" placeholder="Describe an edit…" value={draft} rows={1} onChange={event => onDraftChange(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/>
      <Button variant="ghost" className="mobile-ai-mic" aria-label={voice.listening ? "Stop speaking" : "Speak your edit"} aria-pressed={voice.listening}
        aria-describedby={voiceHint} disabled={busy || !voice.supported} onClick={voice.toggle}><MobileEditorIcon name="mic" size={17}/></Button>
      <Button className="mobile-ai-send" aria-label={busy ? "Stop AI edit" : "Send"} disabled={!busy && !draft.trim()} onClick={busy ? stop : submit}>{busy ? <Square size={14} className="fill-current"/> : <ArrowUp size={17} strokeWidth={2.2}/>}</Button>
    </div>
    <span id={voiceHint} className="sr-only">{voice.supported ? "Uses your browser’s speech recognition. Review the text before sending." : "Speech input is unavailable in this browser. Type your edit instead."}</span>
    {(voice.listening || voice.error) && <p role={voice.error ? "alert" : "status"} className="mobile-ai-voice-status">{voice.error || "Listening…"}</p>}
  </div>;
}

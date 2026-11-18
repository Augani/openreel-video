import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@openreel/ui";
import { useState } from "react";
import { editingToolReadOnly } from "../../../services/agent/editing-tools";
import { useChatStore, type ChatMessage } from "../../../stores/chat-store";
import { MarkdownMessage } from "../chat/MarkdownMessage";
import { ToolCallCard } from "../chat/ToolCallCard";
import { jumpToAIEdit } from "../../../services/agent/edit-navigation";
import { useAIUndoAvailability } from "../chat/useAIUndoAvailability";

const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,"0")}`;

export function MobileAIResultCard({ message, isLatest, kept, onKeep }: { message: ChatMessage; isLatest: boolean; kept: boolean; onKeep: () => void }) {
  const [details, setDetails] = useState(false);
  const undo = useChatStore(s => s.undoLastTurn);
  const canUndo = useAIUndoAvailability() && isLatest && !kept;
  const calls = message.toolCalls.filter(call => !editingToolReadOnly(call.name));
  const done = calls.filter(call => call.status === "done" && call.result?.ok !== false);
  const failed = calls.some(call => call.status === "error" || call.status === "rejected");
  const summary = message.editSummary!;
  return <Collapsible open={details} onOpenChange={setDetails} className="mobile-ai-result">
    <CollapsibleTrigger asChild><Button variant="ghost" className="mobile-ai-result-heading" aria-label="View assistant response and edit details">{summary.undone ? "Undone" : failed ? "Edits applied" : "Done"} · {duration(summary.beforeDuration)} → <span>{duration(summary.afterDuration)}</span></Button></CollapsibleTrigger>
    {done.map(call => <div className="mobile-ai-result-line" key={call.id}><span aria-hidden>✓</span><Button variant="ghost" disabled={summary.undone} onClick={() => jumpToAIEdit(call)} title="Go to this edit">{call.result?.summary || call.name.replaceAll("_"," ")}</Button></div>)}
    {failed && <Button variant="ghost" className="mobile-ai-result-warning" onClick={() => setDetails(true)}>Some edits need attention. View details.</Button>}
    {message.notice && <p className="mobile-ai-result-notice">{message.notice}</p>}
    <CollapsibleContent className="mobile-ai-result-details">{message.text && <MarkdownMessage text={message.text}/>} {message.toolCalls.map(call => <ToolCallCard key={call.id} call={call} undone={summary.undone && !editingToolReadOnly(call.name)}/>)}</CollapsibleContent>
    {isLatest && <div className="mobile-ai-result-actions"><Button variant="secondary" disabled={!canUndo || summary.undone} onClick={() => void undo()} aria-label="Undo all edits in the last AI turn">Undo all</Button><Button disabled={!canUndo || summary.undone} onClick={onKeep}>{kept ? "Kept" : "Keep"}</Button></div>}
  </Collapsible>;
}

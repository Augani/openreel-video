import { useEffect, useId, useMemo, useState } from "react";
import { Button, ScrollArea } from "@openreel/ui";
import { getTimelineItems } from "@openreel/core";
import { Check, Eye, Sparkles } from "lucide-react";
import { editingToolReadOnly } from "../../../services/agent/editing-tools";
import { resolveAIEditTarget } from "../../../services/agent/edit-target";
import { jumpToAIEdit } from "../../../services/agent/edit-navigation";
import { useChatStore, type ChatMessage } from "../../../stores/chat-store";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { formatFrameTimecode } from "../../../utils/frame-timecode";
import { getTrackBadge } from "../timeline/track-badge";
import { useAIUndoAvailability } from "./useAIUndoAvailability";
import { observeAIHistory } from "../../../services/agent/observe-ai-history";
import { ChangeAge, useChangeClock, validChangeTimestamp } from "./ChangeAge";

function RevertIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>;
}

export function ChangesPanel() {
  useEffect(observeAIHistory, []);
  const undoHintId = useId();
  const messages = useChatStore(s => s.messages);
  const committed = useChatStore(s => s.lastTurnCommitted);
  const status = useChatStore(s => s.status);
  const undo = useChatStore(s => s.undoLastTurn);
  const dryRun = useSettingsStore(s => s.agentDryRun);
  const project = useProjectStore(s => s.project);
  const exporting = useUIStore(s => s.exportState.isExporting);
  const locked = useTimelineStore(s => Boolean(s.playbackLockedReason));
  const canUndo = useAIUndoAvailability();
  // Project publication invalidates the snapshot, including engine-owned overlays.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fullProject = useMemo(() => useProjectStore.getState().getFullProject(), [project]);
  const items = useMemo(() => new Map(getTimelineItems(fullProject).map(item => [item.id, item])), [fullProject]);
  const [keptTurn, setKeptTurn] = useState<string | null>(null);
  const turns = useMemo(() => {
    let request: string | undefined;
    const groups: { message: ChatMessage; request?: string; calls: ChatMessage["toolCalls"] }[] = [];
    for (const message of messages) {
      if (message.role === "user") { request = message.text; continue; }
      const calls = message.toolCalls.filter(call => !editingToolReadOnly(call.name));
      if (calls.length) groups.push({ message, request, calls });
    }
    return groups.reverse();
  }, [messages]);
  const now = useChangeClock(turns.some(turn => validChangeTimestamp(turn.message.createdAt)));
  const count = turns.reduce((sum, turn) => sum + turn.calls.length, 0);
  const latest = turns[0]?.message.id;
  const busy = status === "running" || status === "awaiting_confirm";
  const undoAvailable = canUndo && keptTurn !== latest;
  return (
    <div className="workspace-changes flex h-full flex-col">
      <header>
        <strong>Changes <span>{count}</span></strong>
        <small>Click to jump · ⌘Z undoes one</small>
      </header>
      <ScrollArea className="flex-1 min-h-0">
        <div className="workspace-changes-list">
          {turns.length ? turns.map(({ message: turn, request, calls }) => (
            <section key={turn.id}>
              <h3 title={request}><span>{request ? `“${request}”` : "Timeline edits"}</span><ChangeAge timestamp={turn.createdAt} now={now}/></h3>
              {calls.map(call => {
                const target = resolveAIEditTarget(fullProject, call, items);
                const item = target?.id ? items.get(target.id) : undefined;
                const track = fullProject.timeline.tracks.find(track => track.id === target?.trackId);
                const badge = track ? getTrackBadge(fullProject.timeline.tracks, track.id) : "";
                const range = target ? `${badge ? `${badge} · ` : ""}${formatFrameTimecode(target.startTime, project.settings.frameRate)}${typeof target.duration === "number" && Number.isFinite(target.duration) && target.duration > 0 ? ` → ${formatFrameTimecode(target.startTime + target.duration, project.settings.frameRate)}` : ""}` : "";
                const state = turn.editSummary?.undone ? "Undone" : call.status === "done" && dryRun ? "Preview only" : call.status;
                const detail = range ? `${range}${state === "done" ? "" : ` · ${state}`}` : state;
                const summary = call.result?.summary || call.name.replaceAll("_", " ");
                const isUndone = Boolean(turn.editSummary?.undone);
                return (
                  <div key={call.id} className={`workspace-change ${call.status === "running" ? "is-running" : ""}`}>
                    <Button variant="ghost" className="workspace-change-jump" disabled={isUndone || exporting || locked || !target}
                      onClick={() => jumpToAIEdit(call)} title={target ? "Go to this edit" : "No timeline position for this edit"}>
                      <span className={`workspace-change-dot ${isUndone ? "undone" : call.status}`}
                        data-kind={target?.kind} data-media-type={item?.kind === "media" ? item.mediaItem?.type : undefined} data-track-badge={badge} />
                      <span><strong>{summary}</strong><small>{detail}</small></span>
                    </Button>
                    <Button variant="ghost" size="icon" className="workspace-change-undo"
                      disabled={turn.id !== latest || !undoAvailable || isUndone}
                      aria-label="Undo all edits from this AI turn" aria-describedby={undoHintId}
                      title="Undo every edit in this AI turn" onClick={() => void undo()}><RevertIcon /></Button>
                  </div>
                );
              })}
            </section>
          )) : (
            <div className="workspace-changes-empty"><Sparkles size={22} /><strong>Your edits, step by step</strong>
              <p>Changes made by the assistant appear here. Select an edit to jump to its clip.</p></div>
          )}
        </div>
      </ScrollArea>
      <footer>
        <strong>The assistant can</strong>
        <p><Check size={14} aria-hidden="true" />{dryRun ? "Preview timeline edits" : "Edit the timeline"}</p>
        <p><Check size={14} aria-hidden="true" />Use your imported media</p>
        <p><Eye size={14} className="is-review" aria-hidden="true" />Open export for your review</p>
        <div className="workspace-changes-actions flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={!undoAvailable || count === 0}
            aria-label="Undo all edits in the last AI turn" aria-describedby={undoHintId}
            title="Undo every edit in the last AI turn" onClick={() => void undo()}>Undo all</Button>
          <Button className="flex-1" disabled={!committed || count === 0 || busy || keptTurn === latest}
            onClick={() => setKeptTurn(latest ?? null)}>{keptTurn === latest && latest ? "Kept" : "Keep all"}</Button>
        </div>
        <span id={undoHintId} className="sr-only">Each AI turn is one undoable edit.</span>
      </footer>
    </div>
  );
}

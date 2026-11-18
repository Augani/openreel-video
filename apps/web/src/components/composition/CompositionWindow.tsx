import React, { useCallback, useEffect, useRef, useState } from "react";
import type { GraphicTemplate } from "@openreel/core";
import { GraphicTemplateEditor } from "../editor/graphics/EssentialGraphicsPanel";
import { GraphicTemplateThumb } from "../editor/graphics/GraphicTemplateThumb";
import { getLinkedCompTransport, type LinkedCompTransport } from "../../services/linked-comp-bridge";
import type { LinkedCompMessage } from "../../services/linked-comp-protocol";

type Status = "connecting" | "ready" | "gone" | "unreachable";

const RETRY_MS = 1200;
const MAX_ATTEMPTS = 6;

/**
 * The window a linked composition is edited in. It shows the master template with the
 * Essential Graphics editor and sends every change to the editor window, which applies
 * it to the project as one undoable step; the timeline there updates at once.
 */
export const CompositionWindow: React.FC<{ compositionId: string; transport?: LinkedCompTransport }> = ({
  compositionId,
  transport: injected,
}) => {
  const [status, setStatus] = useState<Status>("connecting");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<GraphicTemplate | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const transportRef = useRef<LinkedCompTransport | null>(null);
  const revisionRef = useRef(0);
  const templateRef = useRef<GraphicTemplate | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<{ label: string; template: GraphicTemplate } | null>(null);

  const send = useCallback((label: string, next: GraphicTemplate) => {
    inFlight.current = true;
    transportRef.current?.post({
      type: "edit",
      compositionId,
      baseRevision: revisionRef.current,
      label,
      template: next,
    });
  }, [compositionId]);

  useEffect(() => {
    const transport = injected ?? getLinkedCompTransport();
    transportRef.current = transport;
    let attempts = 0;
    let connected = false;
    const hello = (): void => transport.post({ type: "hello", compositionId });
    const timer = window.setInterval(() => {
      if (connected) return;
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        window.clearInterval(timer);
        setStatus("unreachable");
        return;
      }
      hello();
    }, RETRY_MS);
    const unsubscribe = transport.subscribe((message: LinkedCompMessage) => {
      if (message.type === "gone" && message.compositionId === compositionId) {
        setStatus("gone");
        return;
      }
      if (message.type !== "state" || message.compositionId !== compositionId) return;
      connected = true;
      // While an edit is in flight, a state that is not newer than the one the edit was based on is stale.
      if (inFlight.current && !message.rejected && message.revision <= revisionRef.current) return;
      revisionRef.current = message.revision;
      setRevision(message.revision);
      setName(message.name);
      setStatus("ready");
      inFlight.current = false;
      if (message.rejected) {
        // The host's copy wins: drop any queued local change and show what was refused.
        pending.current = null;
        templateRef.current = message.template;
        setTemplate(message.template);
        setNotice(message.rejected);
        return;
      }
      setNotice(null);
      const queued = pending.current;
      if (queued) {
        // Keep the local (newer) template; send the latest queued edit on top of the acknowledged revision.
        pending.current = null;
        send(queued.label, queued.template);
        return;
      }
      templateRef.current = message.template;
      setTemplate(message.template);
    });
    hello();
    const onUnload = (): void => transport.post({ type: "closed", compositionId });
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onUnload);
      onUnload();
      unsubscribe();
    };
  }, [compositionId, injected, send]);

  const onEdit = useCallback((label: string, fn: (value: GraphicTemplate) => GraphicTemplate) => {
    const base = templateRef.current;
    if (!base) return;
    const next = fn(base);
    if (next === base) return;
    templateRef.current = next;
    setTemplate(next);
    if (inFlight.current) pending.current = { label, template: next };
    else send(label, next);
  }, [send]);

  useEffect(() => {
    if (name) document.title = `${name} — Linked composition`;
  }, [name]);

  if (status === "connecting") {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-sm text-fg-muted" data-testid="composition-window" data-status={status}>
        Connecting to the editor…
      </div>
    );
  }
  if (status === "unreachable" || status === "gone" || !template) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-bg p-6 text-center" data-testid="composition-window" data-status={status}>
        <p className="text-sm font-medium text-fg">
          {status === "gone" ? "This composition no longer exists." : "The editor window could not be reached."}
        </p>
        <p className="max-w-sm text-xs text-fg-muted">
          {status === "gone"
            ? "It was removed or the project was closed. Close this window."
            : "Keep the OpenReel editor open with the same project, then open the composition again from its Clip menu."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-0 flex-col bg-bg text-fg" data-testid="composition-window" data-status={status} data-revision={revision}>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold" data-testid="composition-name">{name}</h1>
          <p className="text-[11px] text-fg-muted">Live: every change appears on the timeline immediately. Undo in the editor window also undoes it here.</p>
        </div>
        <span className="shrink-0 rounded bg-bg-2 px-2 py-0.5 text-[11px] text-fg-muted">Revision {revision}</span>
      </header>
      {notice && (
        <p role="alert" className="border-b border-border/60 bg-warning/10 px-4 py-1.5 text-xs text-fg" data-testid="composition-notice">{notice}</p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <GraphicTemplateThumb template={template} className="aspect-video w-full rounded border border-border/60" />
        <div className="min-w-0">
          <GraphicTemplateEditor template={template} title={name} onEdit={onEdit} />
        </div>
      </div>
    </div>
  );
};

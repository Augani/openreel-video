import type { JSX } from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Button as ShadcnButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  ScrollArea,
} from "@openreel/ui";
import {
  X,
  Undo2,
  Plus,
  History,
  Sparkles,
  Settings,
  Link2,
} from "@/icons/lucide-compat";
import { usePhoneEditor } from "../../../hooks/usePhoneEditor";
import { useUIStore } from "../../../stores/ui-store";
import { MobileAIResultCard } from "../mobile/MobileAIResultCard";
import { useChatStore, CONTINUE_NOTICE_PATTERN } from "../../../stores/chat-store";
import { useOnboardingDraft } from "../../onboarding/ai/draft-store";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { ChatMessage } from "./ChatMessage";
import { ChatComposer } from "./ChatComposer";
import { useAIUndoAvailability } from "./useAIUndoAvailability";
import { observeAIHistory } from "../../../services/agent/observe-ai-history";
import { InlineConfirmCard } from "./InlineConfirmCard";
import { ChatErrorCard } from "./ChatErrorCard";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { EditSharingPanel } from "./EditSharingPanel";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { aiModelLabel, aiProviderLabel, isConnectionReady } from "./ai-connection-labels";
import { ConnectionStatus } from "../AIConnectionStatus";
import { CHAT_STARTER_PROMPTS } from "../../onboarding/ai/starter-prompts";

const MobileAISheet = lazy(() => import("../mobile/MobileAISheet").then(module => ({ default: module.MobileAISheet })));

const CoachMarks = lazy(() => import("../../onboarding/ai/CoachMarks"));

/** Starter chips: every one is something the chat's tool catalog can do (see starter-prompts.ts). */
const SUGGESTIONS: ReadonlyArray<string> = CHAT_STARTER_PROMPTS.map((p) => p.text);


function EmptyState({
  hasOpenProject,
  compact = false,
}: {
  hasOpenProject: boolean;
  compact?: boolean;
}): JSX.Element {
  const send = useChatStore((s) => s.send);
  const connection = useAIConnectionStore();
  const ready = isConnectionReady(connection);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center px-2 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
        <Sparkles size={18} />
      </div>
      <div className="text-[13px] font-medium text-fg">Edit by chatting</div>
      <p
        className="mt-1 max-w-[14rem] text-[11px] leading-relaxed text-fg-muted"
      >
        {hasOpenProject
          ? "Describe an edit in plain language and the AI will perform it on your timeline."
          : "Open or create a project, then describe edits in plain language."}
      </p>
      {hasOpenProject && !ready && (
        <ShadcnButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            useEditorWorkspaceStore.getState().setAIConnectionOpen(true)
          }
          className="mt-4 h-7 rounded-[7px] border border-border bg-bg-2 px-2.5 text-[12px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg"
        >
          Connect a model
        </ShadcnButton>
      )}
      {hasOpenProject && ready && !compact && (
        <div className="mt-4 w-full space-y-1.5">
          {SUGGESTIONS.map((s) => (
            <ShadcnButton
              key={s}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void send(s)}
              className="h-7 w-full min-w-0 rounded-md border border-border bg-bg-1/60 px-2.5 py-1.5 text-left text-[11px] font-semibold text-fg-2 transition-colors hover:border-accent/50 hover:bg-hover hover:text-fg"
            >
              <span className="truncate">{s}</span>
            </ShadcnButton>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  useEffect(observeAIHistory, []);
  const phone = usePhoneEditor();
  const connectionOpen = useEditorWorkspaceStore(s => s.aiConnectionOpen);
  const open = useUIStore(s => s.panels.agentChat?.visible ?? false);
  const [draft, setDraft] = useState("");
  const onboardingDraft = useOnboardingDraft((s) => s.text);
  useEffect(() => {
    if (!onboardingDraft) return;
    setDraft((current) => current || onboardingDraft);
    useOnboardingDraft.getState().clear();
  }, [onboardingDraft]);
  const [keptTurn, setKeptTurn] = useState<string | null>(null);
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);
  const canUndoTurn = useAIUndoAvailability();
  const usage = useChatStore((s) => s.usage);
  const undoLastTurn = useChatStore((s) => s.undoLastTurn);
  const newChat = useChatStore((s) => s.newChat);
  const clearError = useChatStore((s) => s.clearError);
  const setProjectContext = useChatStore((s) => s.setProjectContext);
  const hasOpenProject = useProjectStore((s) => s.hasOpenProject);
  const projectId = useProjectStore((s) =>
    s.hasOpenProject ? s.project.id : null,
  );
  const openSettings = useSettingsStore((s) => s.openSettings);

  const lastMessage = messages[messages.length - 1];
  const keepGoing =
    status === "idle" &&
    lastMessage?.role === "assistant" &&
    typeof lastMessage.notice === "string" &&
    CONTINUE_NOTICE_PATTERN.test(lastMessage.notice);
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const tokenLabel =
    totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k`
      : `${totalTokens}`;

  const busy = status === "running" || status === "awaiting_confirm";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const connection = useAIConnectionStore();

  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLDivElement>("[data-radix-scroll-area-viewport]");
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingConfirm, error, phone]);

  useEffect(() => {
    setProjectContext(projectId);
    setDraft(""); setKeptTurn(null);
  }, [projectId, setProjectContext]);

  const actionMenu = (
            <DropdownMenuContent align="end" className="w-64">
              {phone && <DropdownMenuItem disabled={busy || !messages.length} onSelect={() => { newChat(); setDraft(""); setHistoryOpen(false); }}><Plus/>New chat</DropdownMenuItem>}
              <DropdownMenuItem
                onSelect={() =>
                  useEditorWorkspaceStore.getState().setAIConnectionOpen(true)
                }
              >
                <Settings />
                AI connection settings
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={historyOpen}
                onCheckedChange={setHistoryOpen}
                disabled={busy}
              >
                <History />
                Conversation history
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sharingOpen}
                onCheckedChange={setSharingOpen}
              >
                <Link2 />
                Edit sharing &amp; collaboration
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void undoLastTurn()}
                disabled={!canUndoTurn}
              >
                <Undo2 />
                Undo last AI turn
              </DropdownMenuItem>
              {phone && <><DropdownMenuSeparator/><DropdownMenuLabel>More edit ideas</DropdownMenuLabel>{SUGGESTIONS.map(text => <DropdownMenuItem key={text} disabled={busy || !hasOpenProject} onSelect={() => setDraft(text)}>{text}</DropdownMenuItem>)}</>}
              {totalTokens > 0 && (
                <DropdownMenuLabel className="text-[11px] font-normal text-fg-muted">
                  {tokenLabel} tokens · {usage.inputTokens} in ·{" "}
                  {usage.outputTokens} out
                </DropdownMenuLabel>
              )}
              {onClose && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onClose}>
                    <X />
                    Close assistant
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
  );
  const conversation = <>
    {messages.length === 0 ? <EmptyState hasOpenProject={hasOpenProject} compact={phone}/> : messages.map((message, index) =>
      phone && message.editSummary ? <MobileAIResultCard key={message.id} message={message}
        isLatest={index === messages.length - 1} kept={keptTurn === message.id} onKeep={() => setKeptTurn(message.id)}/>
      : <ChatMessage key={message.id} message={message} pending={busy && index === messages.length - 1 && message.role === "assistant"}/>
    )}
    {keepGoing && <ShadcnButton type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void useChatStore.getState().send("Continue where you left off.")}
      className="mt-2 h-7 rounded-[7px] border border-border bg-bg-2 px-2.5 text-[12px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg">Keep going</ShadcnButton>}
    {pendingConfirm && <InlineConfirmCard call={pendingConfirm.call}/>}
    {error && <ChatErrorCard error={error} onDismiss={clearError} onOpenSettings={openSettings} onNewChat={() => { newChat(); setDraft(""); setHistoryOpen(false); }}/>}
  </>;
  const auxiliary = <>
    <div hidden={!sharingOpen} className="max-h-[40%] shrink-0 overflow-y-auto"><EditSharingPanel disabled={busy}/></div>
    {historyOpen && <ChatHistoryPanel projectId={projectId} onClose={() => setHistoryOpen(false)}/>}
  </>;
  const configured = isConnectionReady(connection);
  const providerName = aiProviderLabel(connection.provider, connection.baseUrl);
  if (phone) return <Suspense fallback={null}><MobileAISheet open={open && !connectionOpen} onOpenChange={next => { if (!next) { if (onClose) onClose(); else useUIStore.getState().setPanelVisible("agentChat", false); } }}
    draft={draft} onDraftChange={setDraft} activity={messages} error={error} pendingConfirm={pendingConfirm}
    provider={<DropdownMenu><DropdownMenuTrigger asChild><ShadcnButton variant="ghost" className="mobile-ai-provider" aria-label="AI connection and conversation actions">
      <span className={configured ? "is-configured" : ""} aria-hidden/><span>{configured ? `${providerName} · ${aiModelLabel(connection.provider, connection.model)}` : "Connect a model"}</span>
    </ShadcnButton></DropdownMenuTrigger>{actionMenu}</DropdownMenu>}
    auxiliary={auxiliary}>{conversation}</MobileAISheet></Suspense>;
  return (
    <div className="workspace-chat relative flex h-full flex-col bg-bg-1" data-tour="ai-chat">
      <header className="workspace-chat-header">
        <span className="shrink-0 text-[13px] font-semibold text-fg">
          Assistant
        </span>
        <ShadcnButton
          aria-label={configured ? `${connection.provider} · ${connection.model}` : "No model connected"}
          title={configured ? `${providerName} · ${connection.model}` : "No model connected. Open AI connection settings"}
          variant="secondary"
          className="workspace-provider-pill"
          onClick={() =>
            useEditorWorkspaceStore.getState().setAIConnectionOpen(true)
          }
        >
          <ConnectionStatus
            ready={configured}
            label={configured ? `${providerName} · ${aiModelLabel(connection.provider, connection.model)}` : "No model connected"}
            caret={false}
          />
          <span aria-hidden="true">▾</span>
        </ShadcnButton>
        <div className="workspace-chat-actions ml-auto flex items-center">
          <ShadcnButton
            aria-label="New chat"
            title="New chat"
            variant="ghost"
            disabled={busy || messages.length === 0}
            onClick={() => {
              newChat(); setDraft(""); setKeptTurn(null);
              setHistoryOpen(false);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </ShadcnButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton
                variant="ghost"
                data-tour="ai-actions"
                aria-label="Assistant actions"
                title="Assistant actions"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4" /></svg>
              </ShadcnButton>
            </DropdownMenuTrigger>
            {actionMenu}
          </DropdownMenu>
        </div>
      </header>
      {auxiliary}

      <ScrollArea
        ref={scrollRef}
        role="log"
        aria-label="AI conversation and edit results"
        aria-live="polite"
        className="workspace-chat-log min-h-0 flex-1"
      >
        <div className="workspace-chat-log-content">{conversation}</div>
      </ScrollArea>

      <ChatComposer text={draft} onTextChange={setDraft}/>
      <Suspense fallback={null}><CoachMarks/></Suspense>
    </div>
  );
}


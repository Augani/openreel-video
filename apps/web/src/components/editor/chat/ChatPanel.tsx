import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Bot, X, Undo2, Trash2, Sparkles, ShieldCheck, FlaskConical } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { ChatMessage } from "./ChatMessage";
import { ChatComposer } from "./ChatComposer";
import { InlineConfirmCard } from "./InlineConfirmCard";
import { useTranslation } from "react-i18next";

const SUGGESTIONS: ReadonlyArray<string> = [
  "Add a title that says 'Welcome' for the first 3 seconds",
  "Trim 2 seconds off the end of the first clip",
  "Add a fade-in to the opening clip",
  "List everything currently on my timeline",
];

function EmptyState({
  hasOpenProject,
}: {
  hasOpenProject: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const send = useChatStore((s) => s.send);
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
        <Sparkles size={18} />
      </div>
      <div className="text-[13px] font-medium text-fg">{t("Edit by chatting")}</div>
      <Text type="supporting" color="secondary" className="mt-1 max-w-[14rem] text-[11px] leading-relaxed text-fg-muted">
        {hasOpenProject
          ? "Describe an edit in plain language and the AI will perform it on your timeline."
          : "Open or create a project, then describe edits in plain language."}
      </Text>
      {hasOpenProject && (
        <div className="mt-4 w-full space-y-1.5">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              label={s}
              variant="ghost"
              size="sm"
              onClick={() => void send(s)}
              className="w-full rounded-md border border-border bg-bg-1/60 px-2.5 py-1.5 text-left text-[11px] text-fg-2 transition-colors hover:border-accent/50 hover:bg-hover hover:text-fg"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  onClose,
}: {
  onClose?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);
  const lastTurnCommitted = useChatStore((s) => s.lastTurnCommitted);
  const usage = useChatStore((s) => s.usage);
  const undoLastTurn = useChatStore((s) => s.undoLastTurn);
  const reset = useChatStore((s) => s.reset);
  const clearError = useChatStore((s) => s.clearError);
  const hasOpenProject = useProjectStore((s) => s.hasOpenProject);
  const autoConfirm = useSettingsStore((s) => s.agentAutoConfirm);
  const setAutoConfirm = useSettingsStore((s) => s.setAgentAutoConfirm);
  const dryRun = useSettingsStore((s) => s.agentDryRun);
  const setDryRun = useSettingsStore((s) => s.setAgentDryRun);

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const tokenLabel =
    totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k`
      : `${totalTokens}`;

  const busy = status === "running" || status === "awaiting_confirm";
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingConfirm, error]);

  return (
    <div className="flex h-full flex-col bg-bg-1">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot size={15} className="shrink-0 text-accent" />
        <span className="shrink-0 text-[13px] font-medium text-fg">
          {t("AI Editor")}</span>
        {totalTokens > 0 && (
          <span
            title={`${usage.inputTokens} in · ${usage.outputTokens} out`}
            className="shrink-0 rounded bg-bg-2 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted"
          >
            {tokenLabel} {t(" tok")}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={dryRun ? t("Dry-run on: plans without applying edits") : t("Dry-run off")}
            icon={<FlaskConical size={14} aria-hidden />}
            size="sm"
            variant={dryRun ? "secondary" : "ghost"}
            onClick={() => setDryRun(!dryRun)}
            aria-pressed={dryRun}
            className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
              dryRun ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-hover hover:text-fg"
            }`}
          />
          <IconButton
            label={
              autoConfirm
                ? t("Auto-approve on: destructive actions run without confirmation")
                : t("Auto-approve off: destructive actions ask first")
            }
            icon={<ShieldCheck size={14} aria-hidden />}
            size="sm"
            variant={autoConfirm ? "secondary" : "ghost"}
            onClick={() => setAutoConfirm(!autoConfirm)}
            aria-pressed={autoConfirm}
            className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
              autoConfirm ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-hover hover:text-fg"
            }`}
          />
          <ProviderModelPicker disabled={busy} />
          {lastTurnCommitted && (
            <IconButton
              label={t("Undo last AI turn")}
              icon={<Undo2 size={14} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={() => void undoLastTurn()}
              className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
            />
          )}
          {messages.length > 0 && (
            <IconButton
              label={t("Clear conversation")}
              icon={<Trash2 size={14} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={reset}
              isDisabled={busy}
              className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
            />
          )}
          {onClose && (
            <IconButton
              label={t("Close")}
              icon={<X size={14} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
            />
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3"
      >
        {messages.length === 0 ? (
          <EmptyState hasOpenProject={hasOpenProject} />
        ) : (
          messages.map((m) => <ChatMessage key={m.id} message={m} />)
        )}

        {pendingConfirm && <InlineConfirmCard call={pendingConfirm.call} />}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-status-error/40 bg-status-error/10 p-2.5 text-[12px] text-status-error">
            <span className="flex-1 break-words">{error}</span>
            <IconButton
              label={t("Clear error")}
              icon={<X size={13} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={clearError}
              className="shrink-0 text-status-error/70 transition-colors hover:text-status-error"
            />
          </div>
        )}
      </div>

      <ChatComposer />
    </div>
  );
}

export default ChatPanel;

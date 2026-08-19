import type { JSX } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { CircleAlert, X } from "@/icons/lucide-compat";

export type ChatErrorAction = "general" | "api-keys" | "new-chat" | null;

export interface ChatErrorPresentation {
  readonly title: string;
  readonly message: string;
  readonly action: ChatErrorAction;
  readonly actionLabel?: string;
  readonly details?: string;
}

function messageFromPayload(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Record<string, unknown>;
  return (
    messageFromPayload(payload.message) ??
    messageFromPayload(payload.detail) ??
    messageFromPayload(payload.error)
  );
}

function extractUpstreamMessage(raw: string): string | null {
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    return messageFromPayload(JSON.parse(raw.slice(jsonStart)));
  } catch {
    return null;
  }
}

export function formatChatError(rawError: string): ChatErrorPresentation {
  const raw = rawError.trim() || "The AI request failed.";
  const upstream = extractUpstreamMessage(raw);
  const status = Number(raw.match(/\b([45]\d{2})\b/)?.[1] ?? 0);
  const searchable = `${raw} ${upstream ?? ""}`.toLowerCase();
  const details = upstream && upstream !== raw ? raw : undefined;

  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|invalid api key|authentication|incorrect api key/.test(
      searchable,
    )
  ) {
    return {
      title: "Authentication failed",
      message:
        upstream ??
        "The endpoint rejected the API key. Check the saved key and try again.",
      action: "api-keys",
      actionLabel: "Check API key",
      details,
    };
  }

  if (status === 429 || /rate limit|too many requests|quota/.test(searchable)) {
    return {
      title: "Rate limit reached",
      message:
        upstream ??
        "The endpoint is receiving too many requests. Wait a moment and try again.",
      action: null,
      details,
    };
  }

  if (
    /cors|failed to fetch|network error|could not reach|connection refused|load failed/.test(
      searchable,
    )
  ) {
    return {
      title: "Couldn’t reach the endpoint",
      message:
        "Check the host URL and confirm the endpoint is online. In a browser, the host must also allow CORS requests from OpenReel.",
      action: "general",
      actionLabel: "Check endpoint",
      details: raw,
    };
  }

  if (
    /context length|context window|maximum context|prompt is too long|token limit/.test(
      searchable,
    )
  ) {
    return {
      title: "Conversation is too long",
      message:
        upstream ??
        "This model cannot fit the full conversation. Start a new chat and continue there.",
      action: "new-chat",
      actionLabel: "Start new chat",
      details,
    };
  }

  if (status === 404 || /model.+not found|unknown model|does not exist/.test(searchable)) {
    return {
      title: "Model or route not found",
      message:
        upstream ??
        "Check that the base URL and model ID match what the endpoint exposes.",
      action: "general",
      actionLabel: "Check endpoint",
      details,
    };
  }

  if (
    /api format|model id|base url|compatible api|endpoint url|secure storage|unlock/.test(
      searchable,
    )
  ) {
    const keyIssue = /secure storage|unlock|api key/.test(searchable);
    return {
      title: "AI setup needed",
      message: upstream ?? raw,
      action: keyIssue ? "api-keys" : "general",
      actionLabel: keyIssue ? "Open API keys" : "Open AI settings",
      details,
    };
  }

  return {
    title: "AI request failed",
    message: upstream ?? raw,
    action: null,
    details,
  };
}

export function ChatErrorCard({
  error,
  onDismiss,
  onOpenSettings,
  onNewChat,
}: {
  readonly error: string;
  readonly onDismiss: () => void;
  readonly onOpenSettings: (tab: "general" | "api-keys") => void;
  readonly onNewChat: () => void;
}): JSX.Element {
  const presentation = formatChatError(error);

  return (
    <div
      role="alert"
      className="rounded-xl border border-status-error/35 bg-bg-1 p-3 shadow-sm"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-status-error/10 text-status-error">
          <CircleAlert size={15} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-fg">
            {presentation.title}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-fg-2">
            {presentation.message}
          </div>
        </div>
        <IconButton
          label="Dismiss error"
          icon={<X size={13} aria-hidden />}
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="-mr-1 -mt-1 shrink-0 text-fg-muted transition-colors hover:text-fg"
        />
      </div>

      {presentation.details && (
        <details className="group mt-2 rounded-lg bg-bg-2/70 px-2.5 py-2">
          <summary className="cursor-pointer select-none text-[10px] font-medium text-fg-muted hover:text-fg-2">
            Technical details
          </summary>
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-fg-muted">
            {presentation.details}
          </pre>
        </details>
      )}

      {presentation.action && (
        <Button
          label={presentation.actionLabel ?? "Fix issue"}
          variant="secondary"
          size="sm"
          onClick={() => {
            const action = presentation.action;
            if (action === "new-chat") onNewChat();
            else if (action) onOpenSettings(action);
          }}
          className="mt-2.5 w-full"
        />
      )}
    </div>
  );
}

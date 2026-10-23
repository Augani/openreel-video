/**
 * AI editing on Director's Eyes points. When the editor is signed in from hawsh-khalifa.com, the AI
 * Editor connection points at the site's `editor-ai` function (fixed price per model call, charged
 * from the user's points) instead of asking for an API key. The user can still switch to their own
 * key in Settings → AI Editor; we never overwrite a connection they configured themselves.
 */
import { LLMHttpError, makeClientFromSend, parseRetryAfterMs, withRetry, type LLMClient } from "@openreel/agent";
import { AI_PROVIDER_DEFAULTS, useAIConnectionStore, type AIProvider } from "../stores/ai-connection-store";
import { HAWSH_SUPABASE_URL } from "./config";
import { hawshClient, useHawshStore } from "./session";

export const HAWSH_AI_URL = `${HAWSH_SUPABASE_URL}/functions/v1/editor-ai`;
export const HAWSH_AI_MODEL = "Director's Eyes";

interface Connection { provider: AIProvider; baseUrl: string; model: string; apiKey: string }

export function isHawshAI(baseUrl: string): boolean {
  return baseUrl.trim().replace(/\/+$/, "") === HAWSH_AI_URL;
}

/**
 * The connection to use after a sign-in change, or null to leave it alone: signed in + untouched
 * default (no key typed) ⇒ Director's Eyes; signed out while on Director's Eyes ⇒ back to the default.
 */
export function nextConnection(signedIn: boolean, current: Connection): Connection | null {
  const onHawsh = isHawshAI(current.baseUrl);
  if (signedIn) {
    const untouched = current.provider === "openai" && !current.apiKey
      && current.baseUrl === AI_PROVIDER_DEFAULTS.openai.baseUrl && current.model === AI_PROVIDER_DEFAULTS.openai.model;
    return untouched ? { provider: "compatible", baseUrl: HAWSH_AI_URL, model: HAWSH_AI_MODEL, apiKey: "" } : null;
  }
  return onHawsh ? { provider: "openai", ...AI_PROVIDER_DEFAULTS.openai, apiKey: "" } : null;
}

/** Keeps the AI Editor connection in step with the Director's Eyes sign-in. Call once at startup. */
export function initHawshAI(): () => void {
  const apply = (signedIn: boolean) => {
    const store = useAIConnectionStore.getState();
    const next = nextConnection(signedIn, store);
    if (next) store.configure(next);
  };
  apply(useHawshStore.getState().status === "ready");
  return useHawshStore.subscribe((s, prev) => {
    if ((s.status === "ready") !== (prev.status === "ready")) apply(s.status === "ready");
  });
}

/** Our server's error JSON carries a user-facing message (Arabic) — safe to show, unlike third-party bodies. */
async function serverMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch { /* not JSON */ }
  return `Director's Eyes AI returned HTTP ${res.status}.`;
}

/** LLM client for the agent loop that sends each step to editor-ai with a fresh session token. */
export function makeHawshAIClient(signal?: AbortSignal): LLMClient {
  const send = withRetry(async (body: unknown) => {
    signal?.throwIfAborted();
    const c = hawshClient();
    const token = c ? (await c.auth.getSession()).data.session?.access_token : undefined;
    if (!token) throw new Error("انتهى الدخول — افتح المحرر من جديد من عيون المخرج.");
    let res: Response;
    try {
      res = await fetch(HAWSH_AI_URL, {
        method: "POST", redirect: "error", credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body), signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("تعذّر الاتصال بعيون المخرج. تحقق من الاتصال وحاول مرة أخرى.");
    }
    if (!res.ok) throw new LLMHttpError(await serverMessage(res), res.status, parseRetryAfterMs(res.headers.get("retry-after")));
    const raw: unknown = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object" || !("choices" in raw)) throw new Error("ردّ غير متوقع من عيون المخرج. حاول مرة أخرى.");
    return raw;
  }, {
    signal,
    retries: 1,
    // Only a provider failure (already refunded on the server) is worth one more try; never
    // retry the day limit (429) or missing points (402).
    isRetryable: (e) => e instanceof LLMHttpError && (e.status === 502 || e.status === 503 || e.status === 504),
  });
  return makeClientFromSend({ provider: "openai", model: HAWSH_AI_MODEL, maxTokens: 4096, send });
}

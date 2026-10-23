/**
 * AI editing on Director's Eyes points only (owner's decision 2026-10-23: no bring-your-own model).
 * The AI Editor connection is fixed to the site's `editor-ai` function (fixed price per model call,
 * charged from the user's points); Settings → AI Editor shows a notice instead of provider/key fields
 * (AIConnectionNotice.tsx) and chat-store refuses any other connection.
 */
import { LLMHttpError, makeClientFromSend, parseRetryAfterMs, withRetry, type LLMClient } from "@openreel/agent";
import { useAIConnectionStore } from "../stores/ai-connection-store";
import { HAWSH_SUPABASE_URL } from "./config";
import { hawshClient } from "./session";

export const HAWSH_AI_URL = `${HAWSH_SUPABASE_URL}/functions/v1/editor-ai`;
export const HAWSH_AI_MODEL = "Director's Eyes";
export const HAWSH_AI_ONLY_MESSAGE = "المونتاج الذكي يعمل فقط برصيد عيون المخرج — افتح المحرر من عيون المخرج.";
export const HAWSH_CONNECTION = { provider: "compatible", baseUrl: HAWSH_AI_URL, model: HAWSH_AI_MODEL, apiKey: "" } as const;

export function isHawshAI(baseUrl: string): boolean {
  return baseUrl.trim().replace(/\/+$/, "") === HAWSH_AI_URL;
}

/** Fixes the AI Editor connection to Director's Eyes points. Call once at startup. */
export function initHawshAI(): void {
  useAIConnectionStore.getState().configure({ ...HAWSH_CONNECTION });
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

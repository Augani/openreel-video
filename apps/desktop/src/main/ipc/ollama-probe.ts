import type { OllamaProbeResult } from "../../shared/onboarding";

export const OLLAMA_PROBE_TIMEOUT_MS = 500;
const DEFAULT_HOST = "http://127.0.0.1:11434";
const MAX_MODELS = 100;

/**
 * Where to look for Ollama. `OPENREEL_OLLAMA_URL` exists so tests can point the probe at a fake
 * server; it is honoured only for loopback http hosts, so it can never turn the probe into a way to
 * reach other machines.
 */
export function resolveOllamaHost(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENREEL_OLLAMA_URL;
  if (!override) return DEFAULT_HOST;
  try {
    const url = new URL(override);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol === "http:" && loopback) return url.origin;
  } catch {
    // fall through to the default
  }
  return DEFAULT_HOST;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Lists the models of a local Ollama (GET /api/tags). Runs in the main process because a renderer
 * fetch would hit CORS. Every failure (not running, slow, odd payload) is silent: it answers
 * `reachable: false` so the UI can simply not show the local option as ready.
 */
export async function probeOllama(
  options: {
    host?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<OllamaProbeResult> {
  const host = options.host ?? resolveOllamaHost();
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? OLLAMA_PROBE_TIMEOUT_MS);
  try {
    const res = await doFetch(`${host}/api/tags`, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { reachable: false, models: [], error: `HTTP ${res.status}` };
    const body = asRecord(await res.json());
    const list = Array.isArray(body?.models) ? body.models : [];
    const models: OllamaProbeResult["models"] = [];
    for (const entry of list) {
      const record = asRecord(entry);
      const name = typeof record?.name === "string" ? record.name : typeof record?.model === "string" ? record.model : "";
      if (!name) continue;
      const size = record?.size;
      models.push(
        typeof size === "number" && Number.isFinite(size) && size >= 0
          ? { name, sizeBytes: size }
          : { name },
      );
      if (models.length >= MAX_MODELS) break;
    }
    return { reachable: true, models };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { reachable: false, models: [], error: aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

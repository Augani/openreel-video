import type { OpenReelOllamaProbeResult } from "../types/global";

export const OLLAMA_DETECT_TIMEOUT_MS = 2000;

const NOT_FOUND: OpenReelOllamaProbeResult = { reachable: false, models: [] };

/**
 * Asks the desktop main process whether a local Ollama is running and which models it has. The
 * probe goes through IPC because a renderer fetch to localhost would be blocked by CORS. It never
 * throws: no bridge (web build), a slow main process or a bad payload all read as "not found".
 */
export async function detectOllama(
  timeoutMs = OLLAMA_DETECT_TIMEOUT_MS,
): Promise<OpenReelOllamaProbeResult> {
  let probe: (() => Promise<OpenReelOllamaProbeResult>) | undefined;
  try {
    probe = typeof window !== "undefined" ? window.openreel?.ollama?.probe : undefined;
  } catch {
    probe = undefined;
  }
  if (!probe) return NOT_FOUND;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      probe(),
      new Promise<OpenReelOllamaProbeResult>((resolve) => {
        timer = setTimeout(() => resolve(NOT_FOUND), timeoutMs);
      }),
    ]);
    if (!result || typeof result !== "object" || !Array.isArray(result.models)) return NOT_FOUND;
    const models = result.models.filter((m) => m && typeof m.name === "string" && m.name.length > 0);
    return { reachable: result.reachable === true, models };
  } catch {
    return NOT_FOUND;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

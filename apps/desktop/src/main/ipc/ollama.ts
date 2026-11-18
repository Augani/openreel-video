import { z } from "zod";
import { handle } from "./index";
import { CHANNELS } from "../../shared/channels";
import type { OllamaProbeResult } from "../../shared/onboarding";
import { probeOllama } from "./ollama-probe";

/** Probes http://127.0.0.1:11434/api/tags (500ms timeout, silent failure) for the AI onboarding path. */
export function registerOllamaIpc(): void {
  handle(CHANNELS.ollamaProbe, z.undefined(), (): Promise<OllamaProbeResult> => probeOllama());
}

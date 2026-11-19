import {
  buildTranslationPrompt,
  parseTranslationReply,
  type CaptionTranslator,
} from "@openreel/core";
import { useAIConnectionStore } from "../stores/ai-connection-store";
import { isConnectionReady } from "../components/editor/chat/ai-connection-labels";
import { makeDirectBYOKClient } from "./agent/direct-llm-transport";

/**
 * Translator back ends for caption translation. The AI provider the user connected
 * for the AI editor is preferred; without one the browser's on-device Translator API
 * is used when it exists. When neither is available the caller shows a clear
 * unavailable state: there is no fallback that fakes output.
 */

export type TranslatorEngineId = "ai" | "browser";

export type TranslatorAvailability =
  | { engine: TranslatorEngineId; state: "ready"; label: string }
  | { engine: "browser"; state: "downloadable"; label: string }
  | { engine: null; state: "unavailable"; reason: string };

/** The subset of the browser Translator API this feature uses (Chrome 138+). */
export interface BrowserTranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?: (m: EventTarget) => void;
  }): Promise<{ translate(text: string, options?: { signal?: AbortSignal }): Promise<string>; destroy?(): void }>;
}

export const browserTranslatorApi = (): BrowserTranslatorApi | undefined => {
  try {
    const api = (globalThis as { Translator?: BrowserTranslatorApi }).Translator;
    return api && typeof api.create === "function" && typeof api.availability === "function" ? api : undefined;
  } catch {
    return undefined;
  }
};

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const NO_TRANSLATOR_REASON =
  "No translator is available. Connect an AI model in Settings, or use a browser with on-device translation (Chrome 138 or later).";

export async function detectTranslator(
  languages: { sourceLanguage?: string; targetLanguage: string },
  deps: { api?: BrowserTranslatorApi; connection?: Parameters<typeof isConnectionReady>[0] } = {},
): Promise<TranslatorAvailability> {
  const connection = deps.connection ?? useAIConnectionStore.getState();
  if (isConnectionReady(connection)) {
    return { engine: "ai", state: "ready", label: `${connection.model}` };
  }
  const api = deps.api ?? browserTranslatorApi();
  if (!api) return { engine: null, state: "unavailable", reason: NO_TRANSLATOR_REASON };
  if (!languages.sourceLanguage) {
    return { engine: null, state: "unavailable", reason: "Enter the language of the source captions to use on-device translation." };
  }
  try {
    const state = await api.availability({ sourceLanguage: languages.sourceLanguage, targetLanguage: languages.targetLanguage });
    if (state === "available") return { engine: "browser", state: "ready", label: "On-device" };
    if (state === "downloadable" || state === "downloading") {
      return { engine: "browser", state: "downloadable", label: "On-device (language pack downloads on first use)" };
    }
  } catch {
    // fall through to unavailable
  }
  return {
    engine: null,
    state: "unavailable",
    reason: `On-device translation does not support ${languageName(languages.sourceLanguage)} to ${languageName(languages.targetLanguage)} in this browser. Connect an AI model in Settings to translate.`,
  };
}

export function createAiTranslator(
  client: { complete: ReturnType<typeof makeDirectBYOKClient>["complete"] },
): CaptionTranslator {
  return {
    async translate(texts, { sourceLanguage, targetLanguage, signal }) {
      signal?.throwIfAborted();
      const { system, user } = buildTranslationPrompt(texts, {
        sourceLanguage: sourceLanguage ? languageName(sourceLanguage) : undefined,
        targetLanguage,
        targetName: languageName(targetLanguage),
      });
      const reply = await client.complete({ system, messages: [{ role: "user", content: user }], tools: [] });
      signal?.throwIfAborted();
      return parseTranslationReply(reply.text, texts.length);
    },
  };
}

export function createBrowserTranslator(
  api: BrowserTranslatorApi,
  onDownloadProgress?: (fraction: number) => void,
): CaptionTranslator {
  return {
    async translate(texts, { sourceLanguage, targetLanguage, signal }) {
      if (!sourceLanguage) throw new Error("Enter the language of the source captions.");
      const translator = await api.create({
        sourceLanguage,
        targetLanguage,
        signal,
        monitor: (m) =>
          m.addEventListener("downloadprogress", (e) => onDownloadProgress?.((e as Event & { loaded?: number }).loaded ?? 0)),
      });
      try {
        const out: string[] = [];
        for (const text of texts) {
          signal?.throwIfAborted();
          out.push(await translator.translate(text, { signal }));
        }
        return out;
      } finally {
        translator.destroy?.();
      }
    },
  };
}

export function makeTranslator(
  engine: TranslatorEngineId,
  options: { signal?: AbortSignal; sourceLanguage?: string; onDownloadProgress?: (fraction: number) => void } = {},
): CaptionTranslator {
  if (engine === "ai") {
    const c = useAIConnectionStore.getState();
    return createAiTranslator(
      makeDirectBYOKClient({ provider: c.provider, baseUrl: c.baseUrl, model: c.model, apiKey: c.apiKey, signal: options.signal }),
    );
  }
  const api = browserTranslatorApi();
  if (!api) throw new Error(NO_TRANSLATOR_REASON);
  return createBrowserTranslator(api, options.onDownloadProgress);
}

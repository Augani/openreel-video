import { describe, expect, it, vi } from "vitest";
import {
  createAiTranslator,
  createBrowserTranslator,
  detectTranslator,
  NO_TRANSLATOR_REASON,
  type BrowserTranslatorApi,
} from "./caption-translator";

const noKey = { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "" };
const withKey = { ...noKey, apiKey: "sk-test" };

const api = (state: string): BrowserTranslatorApi => ({
  availability: vi.fn(async () => state),
  create: vi.fn(async () => ({ translate: async (t: string) => `es:${t}` })),
});

describe("detectTranslator", () => {
  it("prefers the connected AI model", async () => {
    expect(await detectTranslator({ targetLanguage: "es" }, { connection: withKey, api: api("available") })).toMatchObject({ engine: "ai", state: "ready" });
  });
  it("falls back to the on-device translator", async () => {
    expect(await detectTranslator({ sourceLanguage: "en", targetLanguage: "es" }, { connection: noKey, api: api("available") })).toMatchObject({ engine: "browser", state: "ready" });
    expect(await detectTranslator({ sourceLanguage: "en", targetLanguage: "es" }, { connection: noKey, api: api("downloadable") })).toMatchObject({ engine: "browser", state: "downloadable" });
  });
  it("reports unavailable honestly", async () => {
    expect(await detectTranslator({ targetLanguage: "es" }, { connection: noKey, api: undefined })).toEqual({ engine: null, state: "unavailable", reason: NO_TRANSLATOR_REASON });
    const unsupported = await detectTranslator({ sourceLanguage: "en", targetLanguage: "xx" }, { connection: noKey, api: api("unavailable") });
    expect(unsupported.state).toBe("unavailable");
    const needsSource = await detectTranslator({ targetLanguage: "es" }, { connection: noKey, api: api("available") });
    expect(needsSource.state).toBe("unavailable");
  });
});

describe("translators", () => {
  it("AI translator sends the cues and parses the JSON reply", async () => {
    const complete = vi.fn(async () => ({ text: '["Hola","Mundo"]', toolUses: [], stopReason: "end_turn" as const }));
    const out = await createAiTranslator({ complete } as never).translate(["Hello", "World"], { sourceLanguage: "en", targetLanguage: "es" });
    expect(out).toEqual(["Hola", "Mundo"]);
    const input = (complete.mock.calls[0] as unknown as [{ messages: Array<{ content: string }>; tools: unknown[] }])[0];
    expect(input.messages[0].content).toContain('["Hello","World"]');
    expect(input.tools).toEqual([]);
  });
  it("AI translator rejects a reply with the wrong count", async () => {
    const complete = vi.fn(async () => ({ text: '["Hola"]', toolUses: [], stopReason: "end_turn" as const }));
    await expect(createAiTranslator({ complete } as never).translate(["a", "b"], { targetLanguage: "es" })).rejects.toThrow(/1 lines for 2/);
  });
  it("AI translator honours an aborted signal", async () => {
    const c = new AbortController();
    c.abort();
    const complete = vi.fn();
    await expect(createAiTranslator({ complete } as never).translate(["a"], { targetLanguage: "es", signal: c.signal })).rejects.toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });
  it("browser translator translates each cue with the mocked API", async () => {
    const mock = api("available");
    const out = await createBrowserTranslator(mock).translate(["a", "b"], { sourceLanguage: "en", targetLanguage: "es" });
    expect(out).toEqual(["es:a", "es:b"]);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: "en", targetLanguage: "es" }));
  });
});

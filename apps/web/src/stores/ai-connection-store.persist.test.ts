import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_CONNECTION_STORAGE_KEY,
  AI_KEYCHAIN_ID,
  hydrateAIConnection,
  useAIConnectionStore,
} from "./ai-connection-store";

const SECRET = "sk-test-secret-value-123";

function installKeychain(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const keychain = {
    get: vi.fn(async (id: string) => store.get(id) ?? null),
    set: vi.fn(async (id: string, value: string) => void store.set(id, value)),
    delete: vi.fn(async (id: string) => void store.delete(id)),
  };
  (window as unknown as { openreel?: unknown }).openreel = { platform: "desktop", keychain };
  return { keychain, store };
}

function everythingInLocalStorage(): string {
  return Object.keys(localStorage)
    .map((key) => `${key}=${localStorage.getItem(key)}`)
    .join("\n");
}

beforeEach(() => {
  localStorage.clear();
  useAIConnectionStore.setState({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKey: "",
    remember: false,
  });
});
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("ai-connection-store persistence", () => {
  it("writes nothing anywhere when the user did not opt in", () => {
    const { keychain } = installKeychain();
    useAIConnectionStore.getState().configure({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: SECRET });
    expect(keychain.set).not.toHaveBeenCalled();
    expect(localStorage.getItem(AI_CONNECTION_STORAGE_KEY)).toBeNull();
    expect(everythingInLocalStorage()).not.toContain(SECRET);
  });

  it("opt-in writes the key to the keychain only and the non-secret details to local storage", () => {
    const { keychain } = installKeychain();
    useAIConnectionStore.getState().configure({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5-5",
      apiKey: SECRET,
      remember: true,
    });
    expect(keychain.set).toHaveBeenCalledWith(AI_KEYCHAIN_ID, SECRET);
    const stored = localStorage.getItem(AI_CONNECTION_STORAGE_KEY) ?? "";
    expect(JSON.parse(stored)).toEqual({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5-5",
      keyFor: { provider: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
    });
    expect(everythingInLocalStorage()).not.toContain(SECRET);
  });

  it("never persists without a keychain, even when remember is set (web build)", () => {
    useAIConnectionStore.getState().configure({ apiKey: SECRET, remember: true });
    expect(localStorage.getItem(AI_CONNECTION_STORAGE_KEY)).toBeNull();
    expect(everythingInLocalStorage()).not.toContain(SECRET);
  });

  it("turning remember off deletes the key and the stored details", () => {
    const { keychain } = installKeychain();
    useAIConnectionStore.getState().configure({ apiKey: SECRET, remember: true });
    useAIConnectionStore.getState().configure({ remember: false });
    expect(keychain.delete).toHaveBeenCalledWith(AI_KEYCHAIN_ID);
    expect(localStorage.getItem(AI_CONNECTION_STORAGE_KEY)).toBeNull();
  });

  it("forgetEverything clears memory, storage and keychain", () => {
    const { keychain } = installKeychain();
    useAIConnectionStore.getState().configure({ apiKey: SECRET, remember: true });
    useAIConnectionStore.getState().forgetEverything();
    expect(useAIConnectionStore.getState().apiKey).toBe("");
    expect(useAIConnectionStore.getState().remember).toBe(false);
    expect(keychain.delete).toHaveBeenCalled();
    expect(localStorage.getItem(AI_CONNECTION_STORAGE_KEY)).toBeNull();
  });

  it("hydrates a remembered connection from storage plus keychain", async () => {
    installKeychain({ [AI_KEYCHAIN_ID]: SECRET });
    localStorage.setItem(
      AI_CONNECTION_STORAGE_KEY,
      JSON.stringify({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-opus-5-5",
        keyFor: { provider: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
      }),
    );
    expect(await hydrateAIConnection()).toBe(true);
    expect(useAIConnectionStore.getState()).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5-5",
      apiKey: SECRET,
      remember: true,
    });
  });

  it("hydration never overrides a connection configured this session", async () => {
    installKeychain({ [AI_KEYCHAIN_ID]: SECRET });
    localStorage.setItem(
      AI_CONNECTION_STORAGE_KEY,
      JSON.stringify({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "x" }),
    );
    useAIConnectionStore.getState().configure({ apiKey: "session-key" });
    expect(await hydrateAIConnection()).toBe(false);
    expect(useAIConnectionStore.getState().apiKey).toBe("session-key");
  });

  it("deletes the keychain key when remembering a keyless connection (Ollama after Anthropic)", () => {
    const { keychain } = installKeychain();
    const store = useAIConnectionStore.getState();
    store.configure({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "m", apiKey: SECRET, remember: true });
    expect(keychain.set).toHaveBeenCalledWith(AI_KEYCHAIN_ID, SECRET);
    store.configure({ provider: "compatible", baseUrl: "http://localhost:11434/v1", model: "llama", apiKey: "", remember: true });
    expect(keychain.delete).toHaveBeenCalledWith(AI_KEYCHAIN_ID);
    expect(JSON.parse(localStorage.getItem(AI_CONNECTION_STORAGE_KEY) ?? "{}").keyFor).toBeNull();
  });

  it("deletes the keychain key when the endpoint changes without a new key", () => {
    const { keychain } = installKeychain();
    const store = useAIConnectionStore.getState();
    store.configure({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "m", apiKey: SECRET, remember: true });
    store.configure({ provider: "compatible", baseUrl: "https://evil.example/v1" });
    expect(keychain.delete).toHaveBeenCalledWith(AI_KEYCHAIN_ID);
  });

  it("never restores a remembered key onto a different provider or endpoint", async () => {
    const { keychain } = installKeychain({ [AI_KEYCHAIN_ID]: SECRET });
    localStorage.setItem(
      AI_CONNECTION_STORAGE_KEY,
      JSON.stringify({
        provider: "compatible",
        baseUrl: "https://evil.example/v1",
        model: "m",
        keyFor: { provider: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
      }),
    );
    await hydrateAIConnection();
    expect(useAIConnectionStore.getState().apiKey).toBe("");
    expect(keychain.delete).toHaveBeenCalledWith(AI_KEYCHAIN_ID);
  });

  it("switches remembering off and reports it when the keychain cannot store the key", async () => {
    const { keychain } = installKeychain();
    keychain.set.mockRejectedValueOnce(new Error("encryption unavailable"));
    useAIConnectionStore.getState().configure({ apiKey: SECRET, remember: true });
    await new Promise((r) => setTimeout(r, 0));
    const state = useAIConnectionStore.getState();
    expect(state.remember).toBe(false);
    expect(state.rememberError).toMatch(/keychain/i);
    expect(localStorage.getItem(AI_CONNECTION_STORAGE_KEY)).toBeNull();
  });

  it("ignores corrupt stored details", async () => {
    installKeychain({ [AI_KEYCHAIN_ID]: SECRET });
    localStorage.setItem(AI_CONNECTION_STORAGE_KEY, "{not json");
    expect(await hydrateAIConnection()).toBe(false);
  });
});

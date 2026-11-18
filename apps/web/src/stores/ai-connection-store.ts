import { create } from "zustand";
import {
  AI_PROVIDER_DEFAULTS as DEFAULTS,
  type AIProviderKind,
} from "../services/ai-models";

export type AIProvider = AIProviderKind;
export const AI_PROVIDER_DEFAULTS = DEFAULTS;

/** Keychain entry that holds the API key when the user opted into "Remember on this device". */
export const AI_KEYCHAIN_ID = "ai-connection-key";
/** Non-secret connection details (provider, endpoint, model), written only when remembered. */
export const AI_CONNECTION_STORAGE_KEY = "openreel-ai-connection";

interface AIConnectionFields {
  provider: AIProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface AIConnectionState extends AIConnectionFields {
  /** Opt-in: the key lives in the OS keychain, the rest in local storage. Off by default. */
  remember: boolean;
  /** Set when the keychain refused to store the key; remembering is switched off when it happens. */
  rememberError: string | null;
  configure: (options: Partial<AIConnectionFields & { remember: boolean }>) => void;
  /** Clears the key from memory and from the keychain. Connection details stay. */
  forgetKey: () => void;
  /** Turns remembering off and deletes everything that was written to disk. */
  forgetEverything: () => void;
}

interface Keychain {
  get(id: string): Promise<string | null>;
  set(id: string, value: string): Promise<void>;
  delete(id: string): Promise<void>;
}

/** The OS keychain bridge, present only in the desktop app. */
export function aiKeychain(): Keychain | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const bridge = window.openreel;
    return bridge?.platform === "desktop" ? bridge.keychain : undefined;
  } catch {
    return undefined;
  }
}

/** True when "Remember on this device" can be offered. */
export function canRememberAIKey(): boolean {
  return aiKeychain() !== undefined;
}

interface StoredConnection extends Partial<AIConnectionFields> {
  /** The provider and endpoint the keychain key was saved for. */
  keyFor?: { provider: AIProvider; baseUrl: string } | null;
}

function readStored(): StoredConnection | null {
  try {
    const raw = localStorage.getItem(AI_CONNECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const provider = parsed.provider;
    if (provider !== "openai" && provider !== "anthropic" && provider !== "compatible") return null;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.model !== "string") return null;
    const kf = parsed.keyFor as Record<string, unknown> | null | undefined;
    const keyFor =
      kf && typeof kf.provider === "string" && typeof kf.baseUrl === "string"
        ? { provider: kf.provider as AIProvider, baseUrl: kf.baseUrl }
        : null;
    return { provider, baseUrl: parsed.baseUrl, model: parsed.model, keyFor };
  } catch {
    return null;
  }
}

function writeStored(
  fields: Omit<AIConnectionFields, "apiKey">,
  keyFor: { provider: AIProvider; baseUrl: string } | null,
): void {
  try {
    // Deliberately no key here: only the keychain may hold it.
    localStorage.setItem(
      AI_CONNECTION_STORAGE_KEY,
      JSON.stringify({ provider: fields.provider, baseUrl: fields.baseUrl, model: fields.model, keyFor }),
    );
  } catch {
    // storage blocked: the connection simply is not remembered
  }
}

function clearStored(): void {
  try {
    localStorage.removeItem(AI_CONNECTION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function deleteRememberedKey(): void {
  const keychain = aiKeychain();
  if (!keychain) return;
  void keychain.delete(AI_KEYCHAIN_ID).catch(() => undefined);
}

export const useAIConnectionStore = create<AIConnectionState>((set) => ({
  provider: "openai",
  ...AI_PROVIDER_DEFAULTS.openai,
  apiKey: "",
  remember: false,
  rememberError: null,
  configure: (options) => set({ rememberError: null, ...options }),
  forgetKey: () => {
    set({ apiKey: "" });
    deleteRememberedKey();
  },
  forgetEverything: () => {
    set({ apiKey: "", remember: false });
    clearStored();
    deleteRememberedKey();
  },
}));

// Mirror to disk only while the user has opted in. Nothing is written when `remember` is false.
useAIConnectionStore.subscribe((state, prev) => {
  if (!state.remember) {
    if (prev.remember) {
      clearStored();
      deleteRememberedKey();
    }
    return;
  }
  const keychain = aiKeychain();
  if (!keychain) return;
  const endpointChanged = state.provider !== prev.provider || state.baseUrl !== prev.baseUrl;
  const changed =
    !prev.remember ||
    endpointChanged ||
    state.model !== prev.model ||
    state.apiKey !== prev.apiKey;
  if (!changed) return;
  // A remembered key must never outlive the endpoint it was typed for: no key, or the same key
  // carried over to a different provider or URL, means the old keychain entry is deleted.
  const carriedOver = prev.remember && endpointChanged && state.apiKey === prev.apiKey;
  if (!state.apiKey || carriedOver) {
    writeStored(state, null);
    void keychain.delete(AI_KEYCHAIN_ID).catch(() => undefined);
    return;
  }
  writeStored(state, { provider: state.provider, baseUrl: state.baseUrl });
  const snapshot = { provider: state.provider, baseUrl: state.baseUrl, apiKey: state.apiKey };
  void keychain.set(AI_KEYCHAIN_ID, state.apiKey).catch(() => {
    const now = useAIConnectionStore.getState();
    if (now.apiKey !== snapshot.apiKey) return;
    // Do not claim the key is remembered when it is not: switch remembering off and say so.
    useAIConnectionStore.setState({
      remember: false,
      rememberError: "Your system keychain could not store the key, so it will not be remembered.",
    });
  });
});

/**
 * Restores a remembered connection (details from local storage, key from the keychain). Never
 * overrides a connection the user already configured this session.
 */
export async function hydrateAIConnection(): Promise<boolean> {
  const keychain = aiKeychain();
  const stored = readStored();
  if (!keychain || !stored) return false;
  try {
    const key = await keychain.get(AI_KEYCHAIN_ID);
    if (useAIConnectionStore.getState().apiKey) return false;
    // Only restore a key that was saved for this very provider and endpoint.
    const bound =
      !!stored.keyFor &&
      stored.keyFor.provider === stored.provider &&
      stored.keyFor.baseUrl === stored.baseUrl;
    const { keyFor: _keyFor, ...details } = stored;
    void _keyFor;
    useAIConnectionStore.setState({ ...details, apiKey: bound ? (key ?? "") : "", remember: true });
    if (!bound && key) void keychain.delete(AI_KEYCHAIN_ID).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Resolves once the startup restore finished, so the AI sheet can wait for it before asking for a key. */
export const aiConnectionHydrated: Promise<boolean> =
  typeof window !== "undefined" ? hydrateAIConnection() : Promise.resolve(false);

export function isAIConnectionReady(
  s: Pick<AIConnectionFields, "provider" | "baseUrl" | "model" | "apiKey">,
): boolean {
  return (
    !!s.baseUrl.trim() &&
    !!s.model.trim() &&
    (!!s.apiKey || s.provider === "compatible")
  );
}

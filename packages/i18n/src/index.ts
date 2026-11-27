export type LanguagePreference = "system" | "en" | "zh-CN";
export type Locale = "en" | "zh-CN";

export const LANGUAGE_STORAGE_KEY = "openreel.language";

export interface LanguageSnapshot {
  readonly preference: LanguagePreference;
  readonly locale: Locale;
}

type LanguageStorage = Pick<Storage, "getItem" | "setItem">;

function isPreference(value: string | null | undefined): value is LanguagePreference {
  return value === "system" || value === "en" || value === "zh-CN";
}

function detectSystemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

function safeLocalStorage(): LanguageStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveLocale(
  preference: LanguagePreference,
  systemLanguages: readonly string[],
): Locale {
  if (preference !== "system") return preference;
  return systemLanguages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}

let snapshot: LanguageSnapshot = { preference: "system", locale: "en" };
let systemLanguages: readonly string[] = detectSystemLanguages();
let storage: LanguageStorage | null = safeLocalStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const languageStore = {
  getSnapshot(): LanguageSnapshot {
    return snapshot;
  },
  getPreference(): LanguagePreference {
    return snapshot.preference;
  },
  getLocale(): Locale {
    return snapshot.locale;
  },
  setPreference(preference: LanguagePreference): void {
    if (!isPreference(preference)) return;
    const locale = resolveLocale(preference, systemLanguages);
    if (snapshot.preference === preference && snapshot.locale === locale) return;
    snapshot = { preference, locale };
    try {
      storage?.setItem(LANGUAGE_STORAGE_KEY, preference);
    } catch {
      // Storage can be unavailable (private mode, quota); the in-memory choice still applies.
    }
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Re-render subscribers (e.g. after the full dictionary finishes loading). */
  refresh(): void {
    emit();
  },
};

export interface InitLanguageOptions {
  systemLanguages?: readonly string[];
  /** E2E/test default only; a saved explicit preference always wins. */
  forcedLocale?: Locale;
  storage?: LanguageStorage | null;
}

export function initLanguage(options: InitLanguageOptions = {}): void {
  systemLanguages = options.systemLanguages ?? detectSystemLanguages();
  storage = options.storage === undefined ? safeLocalStorage() : options.storage;

  // Distinguish "no saved preference" from a saved explicit "system": a saved
  // choice (including "system") outranks forcedLocale.
  let saved: LanguagePreference | null = null;
  try {
    const value = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isPreference(value)) saved = value;
  } catch {
    // Ignore unreadable storage.
  }

  const preference: LanguagePreference = saved ?? "system";
  const locale: Locale = saved !== null
    ? resolveLocale(saved, systemLanguages)
    : options.forcedLocale ?? resolveLocale(preference, systemLanguages);

  snapshot = { preference, locale };
  emit();
}

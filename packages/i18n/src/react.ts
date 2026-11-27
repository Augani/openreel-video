import { useCallback, useSyncExternalStore } from "react";
import { languageStore, type LanguagePreference, type Locale } from "./index";
import { translate } from "./translate";

export function useLanguage(): {
  preference: LanguagePreference;
  locale: Locale;
  setPreference: (preference: LanguagePreference) => void;
} {
  const snapshot = useSyncExternalStore(
    languageStore.subscribe,
    languageStore.getSnapshot,
    languageStore.getSnapshot,
  );
  return {
    preference: snapshot.preference,
    locale: snapshot.locale,
    setPreference: languageStore.setPreference,
  };
}

export function useT(): (source: string, vars?: Record<string, string | number>) => string {
  const snapshot = useSyncExternalStore(
    languageStore.subscribe,
    languageStore.getSnapshot,
    languageStore.getSnapshot,
  );
  return useCallback(
    (source: string, vars?: Record<string, string | number>) => translate(snapshot.locale, source, vars),
    [snapshot.locale],
  );
}

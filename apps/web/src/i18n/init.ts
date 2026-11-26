import { initLanguage, languageStore } from "@openreel/i18n";

/** Mirror the renderer's choice to the Electron native menu. No-op in the browser. */
export function pushLanguageToDesktop(): void {
  const bridge = typeof window !== "undefined" ? window.openreel?.language : undefined;
  if (!bridge) return;
  void bridge.set({
    preference: languageStore.getPreference(),
    locale: languageStore.getLocale(),
  }).catch(() => {
    // The renderer choice still applies; the native menu sync is best-effort.
  });
}

export function initWebI18n(): void {
  initLanguage({
    forcedLocale: import.meta.env.VITE_OPENREEL_E2E === "1" ? "en" : undefined,
  });
  if (import.meta.env.VITE_OPENREEL_E2E === "1") {
    (window as unknown as { __openreelI18n?: typeof languageStore }).__openreelI18n = languageStore;
  }
  pushLanguageToDesktop();
  languageStore.subscribe(pushLanguageToDesktop);
}

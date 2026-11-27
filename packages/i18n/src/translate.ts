import { languageStore, type Locale } from "./index";
import { zhCNCore } from "./zh-CN-core";

const PLACEHOLDER = /\{(\w+)\}/g;

// The startup dictionary is small enough for the entry chunk. The full
// dictionary is loaded on demand by loadDictionary() (web/editor, Studio,
// Image and the Electron main process) so it never enters the web entry.
let extraDictionary: Record<string, string> | null = null;

export async function loadDictionary(): Promise<void> {
  if (extraDictionary) return;
  const module = await import("./zh-CN");
  extraDictionary = module.zhCN;
  languageStore.refresh();
}

function lookup(source: string): string | undefined {
  if (
    extraDictionary &&
    Object.prototype.hasOwnProperty.call(extraDictionary, source)
  ) {
    return extraDictionary[source];
  }
  return Object.prototype.hasOwnProperty.call(zhCNCore, source)
    ? zhCNCore[source]
    : undefined;
}

export function translate(
  locale: Locale,
  source: string,
  vars?: Record<string, string | number>,
): string {
  const template = locale === "zh-CN" ? lookup(source) ?? source : source;
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match: string, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

/** Translate with the store's current locale; for services, stores and bridges. */
export function translateNow(
  source: string,
  vars?: Record<string, string | number>,
): string {
  return translate(languageStore.getLocale(), source, vars);
}

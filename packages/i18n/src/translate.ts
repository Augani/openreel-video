import { languageStore, type Locale } from "./index";
import { zhCN } from "./zh-CN";

const PLACEHOLDER = /\{(\w+)\}/g;

export function translate(
  locale: Locale,
  source: string,
  vars?: Record<string, string | number>,
): string {
  const template =
    locale === "zh-CN" && Object.prototype.hasOwnProperty.call(zhCN, source)
      ? zhCN[source]
      : source;
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

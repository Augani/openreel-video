import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveLocale, type LanguagePreference, type Locale } from "@openreel/i18n";

export interface LanguageState {
  readonly preference: LanguagePreference;
  readonly locale: Locale;
}

function isPreference(value: unknown): value is LanguagePreference {
  return value === "system" || value === "en" || value === "zh-CN";
}

export function readLanguageState(
  file: string,
  systemLanguages: readonly string[],
): LanguageState {
  let preference: LanguagePreference = "system";
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { preference?: unknown };
    if (isPreference(parsed.preference)) preference = parsed.preference;
  } catch {
    // Missing or unreadable file: follow the system.
  }
  return { preference, locale: resolveLocale(preference, systemLanguages) };
}

export function writeLanguagePreference(file: string, preference: LanguagePreference): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ preference }, null, 2), "utf8");
  renameSync(tmp, file);
}

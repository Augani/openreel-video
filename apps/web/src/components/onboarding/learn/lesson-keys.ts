import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";

/**
 * Lesson text reads the live key bindings (spec 2.5), so it is right under any preset: split is `S` in
 * OpenReel, but `Cmd+K` under the Premiere preset. Nothing in the lesson copy hardcodes a key.
 */
export interface LessonKeys {
  splitKey: string;
  deleteKey: string;
}

/** Shown when the user unbound the command; the menu path always exists. */
const FALLBACKS: LessonKeys = { splitKey: "Split in the Edit menu", deleteKey: "Delete in the Edit menu" };

export function resolveLessonKeys(): LessonKeys {
  const split = keyboardShortcuts.formatShortcut("editing.split");
  const del = keyboardShortcuts.formatShortcut("editing.delete");
  return {
    splitKey: split || FALLBACKS.splitKey,
    deleteKey: del || FALLBACKS.deleteKey,
  };
}

export type LessonTextPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "key"; readonly label: string };

const TOKEN = /\{(splitKey|deleteKey)\}/g;

/** Splits a lesson sentence into plain text and key parts so the UI can render keys as <kbd>. */
export function renderLessonText(template: string, keys: LessonKeys): LessonTextPart[] {
  const parts: LessonTextPart[] = [];
  let last = 0;
  for (const match of template.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: "text", text: template.slice(last, index) });
    parts.push({ type: "key", label: keys[match[1] as keyof LessonKeys] });
    last = index + match[0].length;
  }
  if (last < template.length) parts.push({ type: "text", text: template.slice(last) });
  return parts;
}

/** Plain-string form, for aria labels and the AI explain prompt. */
export function lessonTextToString(template: string, keys: LessonKeys): string {
  return renderLessonText(template, keys)
    .map((p) => (p.type === "text" ? p.text : p.label))
    .join("");
}

/** A short string that changes whenever either binding changes (for useSyncExternalStore). */
export function lessonKeysSignature(): string {
  const { splitKey, deleteKey } = resolveLessonKeys();
  return `${splitKey}|${deleteKey}`;
}

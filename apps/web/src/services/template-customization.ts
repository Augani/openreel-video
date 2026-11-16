import {
  parseMotionColor,
  type ExtendedPlaceholder,
  type ScriptableTemplateReplacements,
  type TemplateValidationError,
} from "@openreel/core";

export type TemplateFieldDraft = string | boolean;
export type TemplateFieldDrafts = Record<string, TemplateFieldDraft>;
const objectTypes = new Set([
  "shape",
  "effect",
  "transform",
  "keyframe",
  "style",
]);

export function templateFieldUsesJson(field: ExtendedPlaceholder): boolean {
  return (
    (field.defaultValue !== null && typeof field.defaultValue === "object") ||
    (field.defaultValue == null && objectTypes.has(field.type))
  );
}

export function displayTemplateField(
  field: ExtendedPlaceholder,
): TemplateFieldDraft {
  const value = field.defaultValue;
  if (field.type === "boolean") return Boolean(value);
  if (templateFieldUsesJson(field)) {
    try {
      return value == null ? "" : JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  return value == null ? "" : String(value);
}

/** Keep numeric and JSON drafts local until a complete, valid value can be applied. */
export function readTemplateDraft(
  field: ExtendedPlaceholder,
  draft: TemplateFieldDraft | undefined,
): { value: unknown; error?: string } {
  if (draft === undefined) return { value: field.defaultValue };
  if (field.type === "boolean")
    return typeof draft === "boolean"
      ? { value: draft }
      : { value: undefined, error: `${field.label} must be a boolean` };
  if (field.type === "number") {
    const raw = String(draft).trim();
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value)
      ? { value }
      : { value: undefined, error: `${field.label} must be a finite number` };
  }
  if (templateFieldUsesJson(field)) {
    try {
      const value: unknown = JSON.parse(String(draft));
      if (value === null || typeof value !== "object") throw new Error();
      return { value };
    } catch {
      return {
        value: undefined,
        error: `${field.label} must contain a valid JSON object or array`,
      };
    }
  }
  return { value: String(draft) };
}

export function buildTemplateReplacements(
  fields: readonly ExtendedPlaceholder[],
  drafts: TemplateFieldDrafts,
  validate: (
    field: ExtendedPlaceholder,
    value: unknown,
  ) => TemplateValidationError | null,
): {
  replacements: ScriptableTemplateReplacements;
  errors: Record<string, string>;
} {
  const replacements: Record<string, ScriptableTemplateReplacements[string]> =
      {},
    errors: Record<string, string> = {};
  for (const field of fields) {
    const decoded = readTemplateDraft(field, drafts[field.id]);
    const error = decoded.error ?? validate(field, decoded.value)?.message;
    if (error) {
      errors[field.id] = error;
      continue;
    }
    if (decoded.value === undefined) continue;
    try {
      replacements[field.id] = {
        type: field.type,
        value: structuredClone(decoded.value),
      };
    } catch {
      errors[field.id] =
        `${field.label} cannot be copied. Choose another value.`;
    }
  }
  return { replacements, errors };
}

/** The color field's stored contract is hex, including its alpha byte. */
export function templateColorHex(value: string): string | null {
  const color = parseMotionColor(value);
  if (!color) return null;
  const channel = (amount: number) =>
    Math.round(Math.max(0, Math.min(255, amount)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${color.a < 1 ? channel(color.a * 255) : ""}`;
}

export function orderedTemplateFields(
  fields: readonly ExtendedPlaceholder[],
): ExtendedPlaceholder[] {
  return fields
    .map((field, index) => ({ field, index }))
    .sort(
      (a, b) =>
        (a.field.uiHints?.order ?? 0) - (b.field.uiHints?.order ?? 0) ||
        a.index - b.index,
    )
    .map(({ field }) => field);
}

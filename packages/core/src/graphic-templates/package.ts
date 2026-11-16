import {
  GRAPHIC_TEMPLATE_SCHEMA_VERSION,
  type GraphicTemplate,
} from "./types";
import { GRAPHIC_LIMITS, validateGraphicTemplate, type GraphicValidation } from "./validate";

/** File extension and format marker of an exported template. */
export const OPENREEL_TEMPLATE_EXTENSION = ".openreel-template";
export const OPENREEL_TEMPLATE_FORMAT = "openreel-template";

export interface GraphicTemplatePackage {
  readonly format: typeof OPENREEL_TEMPLATE_FORMAT;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly template: GraphicTemplate;
}

/**
 * A `.openreel-template` is one UTF-8 JSON document: a versioned envelope around
 * the template with every image / svg embedded (data: URLs), so it is a single
 * self-contained file.
 */
export function serializeGraphicTemplate(template: GraphicTemplate): string {
  const checked = validateGraphicTemplate(template);
  if (!checked.ok) throw new Error(`Cannot export an invalid template: ${checked.errors[0]}`);
  const pack: GraphicTemplatePackage = {
    format: OPENREEL_TEMPLATE_FORMAT,
    schemaVersion: GRAPHIC_TEMPLATE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    template: checked.template,
  };
  return JSON.stringify(pack, null, 2);
}

/** Parse and validate untrusted file text. Never throws. */
export function parseGraphicTemplatePackage(text: string): GraphicValidation {
  if (typeof text !== "string") return { ok: false, errors: ["file: not text"] };
  // Length is UTF-16 units; bytes are at least that many, so this is a safe bound before parsing.
  if (text.length > GRAPHIC_LIMITS.maxFileBytes) {
    return { ok: false, errors: [`file: larger than ${Math.round(GRAPHIC_LIMITS.maxFileBytes / 1e6)} MB`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["file: not a valid OpenReel template (the JSON could not be read)"] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ["file: not an OpenReel template"] };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== OPENREEL_TEMPLATE_FORMAT) {
    return { ok: false, errors: ["file: not an OpenReel template (missing format marker)"] };
  }
  if (typeof envelope.schemaVersion !== "number" || envelope.schemaVersion > GRAPHIC_TEMPLATE_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`file: made by a newer OpenReel (template version ${String(envelope.schemaVersion)}). Update OpenReel to open it.`],
    };
  }
  return validateGraphicTemplate(envelope.template);
}

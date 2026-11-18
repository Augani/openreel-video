/**
 * OpenReel effect plugin manifest.
 *
 * A plugin is a `.orplugin` package (a zip, or the same files in a folder):
 *
 *   plugin.json   this manifest
 *   <shader>      WGSL source (manifest.shader.file), the GPU implementation
 *   <cpu>         optional JavaScript (manifest.cpu.file), the CPU fallback
 *
 * This file holds the pure parts: types, validation, parameter resolution and
 * the uniform-buffer layout used to hand parameters to a WGSL shader. It has
 * no DOM / WebGPU / Worker dependency so it also runs in the desktop main
 * process and in tests.
 */

export const PLUGIN_API_VERSION = 1;
export const PLUGIN_EFFECT_PREFIX = "plugin:";
/** Reserved effect-param key that records the plugin version an effect was authored with. */
export const PLUGIN_VERSION_PARAM = "__pluginVersion";
/** Reserved effect-param key the sampler fills with the clip-local time for time driven plugins. */
export const PLUGIN_TIME_PARAM = "__time";

export const PLUGIN_CATEGORIES = [
  "Stylize",
  "Creative",
  "Blur",
  "Color",
  "Keying",
  "Distort",
  "Generate",
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export const PLUGIN_PARAM_TYPES = [
  "float",
  "int",
  "bool",
  "choice",
  "color",
  "point",
  "angle",
] as const;
export type PluginParamType = (typeof PLUGIN_PARAM_TYPES)[number];

export interface PluginChoice {
  readonly value: string;
  readonly label: string;
}

export interface PluginParamDef {
  readonly key: string;
  readonly label: string;
  readonly type: PluginParamType;
  /** float/int/angle: number. bool: boolean. choice: choice value. color: "#rrggbb". point: {x,y} (0..1). */
  readonly default: number | boolean | string | { x: number; y: number };
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly choices?: readonly PluginChoice[];
  /** Whether the parameter can be animated with keyframes (numeric, point and color only). */
  readonly keyframable: boolean;
}

export interface PluginManifest {
  readonly apiVersion: number;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly category: PluginCategory;
  readonly description: string;
  readonly author?: string;
  readonly parameters: readonly PluginParamDef[];
  readonly shader?: { readonly file: string };
  readonly cpu?: { readonly file: string; readonly timeoutMs?: number };
  /** The look changes every frame even with constant parameters (grain, flicker). */
  readonly timeDriven: boolean;
}

export type ManifestValidation =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly errors: readonly string[] };

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}$/;
/** WGSL reserved words that cannot be used as struct member names. */
const WGSL_KEYWORDS = new Set([
  "alias", "break", "case", "const", "continue", "continuing", "default", "diagnostic", "discard",
  "else", "enable", "false", "fn", "for", "if", "let", "loop", "override", "requires", "return",
  "struct", "switch", "true", "var", "while", "array", "bool", "f32", "i32", "u32", "f16",
  "vec2", "vec3", "vec4", "mat2x2", "mat3x3", "mat4x4", "atomic", "ptr", "sampler", "texture_2d",
]);

export const MAX_PLUGIN_PARAMS = 32;

export function pluginEffectType(id: string): string {
  return `${PLUGIN_EFFECT_PREFIX}${id}`;
}

export function isPluginEffectType(type: string): boolean {
  return type.startsWith(PLUGIN_EFFECT_PREFIX) && type.length > PLUGIN_EFFECT_PREFIX.length;
}

export function pluginIdFromEffectType(type: string): string | null {
  return isPluginEffectType(type) ? type.slice(PLUGIN_EFFECT_PREFIX.length) : null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validateParam(raw: unknown, index: number, errors: string[]): PluginParamDef | null {
  const at = `parameters[${index}]`;
  if (!isObj(raw)) {
    errors.push(`${at} must be an object`);
    return null;
  }
  const before = errors.length;
  const key = raw.key;
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    errors.push(`${at}.key must match ${KEY_RE} (letters and digits, starting with a letter)`);
  } else if (WGSL_KEYWORDS.has(key) || /^or[A-Z]/.test(key)) {
    errors.push(`${at}.key "${key}" is reserved`);
  }
  const type = raw.type;
  if (typeof type !== "string" || !(PLUGIN_PARAM_TYPES as readonly string[]).includes(type)) {
    errors.push(`${at}.type must be one of ${PLUGIN_PARAM_TYPES.join(", ")}`);
    return null;
  }
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : String(key);
  const t = type as PluginParamType;
  let min: number | undefined;
  let max: number | undefined;
  let step: number | undefined;
  if (t === "float" || t === "int" || t === "angle") {
    min = isNum(raw.min) ? raw.min : t === "angle" ? -360 : 0;
    max = isNum(raw.max) ? raw.max : t === "angle" ? 360 : 1;
    if (raw.min !== undefined && !isNum(raw.min)) errors.push(`${at}.min must be a number`);
    if (raw.max !== undefined && !isNum(raw.max)) errors.push(`${at}.max must be a number`);
    if (min >= max) errors.push(`${at}: min must be lower than max`);
    step = isNum(raw.step) && raw.step > 0 ? raw.step : t === "int" ? 1 : (max - min) / 100;
    if (raw.step !== undefined && !(isNum(raw.step) && raw.step > 0)) {
      errors.push(`${at}.step must be a positive number`);
    }
  }
  let def: PluginParamDef["default"] | undefined;
  switch (t) {
    case "float":
    case "int":
    case "angle": {
      const d = raw.default;
      if (!isNum(d)) errors.push(`${at}.default must be a number`);
      else {
        if (min !== undefined && max !== undefined && (d < min || d > max)) {
          errors.push(`${at}.default ${d} is outside [${min}, ${max}]`);
        }
        if (t === "int" && !Number.isInteger(d)) errors.push(`${at}.default must be an integer`);
        def = d;
      }
      break;
    }
    case "bool":
      if (typeof raw.default !== "boolean") errors.push(`${at}.default must be a boolean`);
      else def = raw.default;
      break;
    case "choice": {
      const choices = raw.choices;
      if (!Array.isArray(choices) || choices.length < 1 || choices.length > 64) {
        errors.push(`${at}.choices must list 1 to 64 options`);
      } else {
        const seen = new Set<string>();
        for (const c of choices) {
          if (!isObj(c) || typeof c.value !== "string" || !c.value) {
            errors.push(`${at}.choices entries need a string "value"`);
          } else if (seen.has(c.value)) errors.push(`${at}.choices has duplicate value "${c.value}"`);
          else seen.add(c.value);
        }
        if (typeof raw.default !== "string" || !seen.has(raw.default)) {
          errors.push(`${at}.default must be one of the choice values`);
        } else def = raw.default;
      }
      break;
    }
    case "color":
      if (typeof raw.default !== "string" || !HEX_RE.test(raw.default)) {
        errors.push(`${at}.default must be a #rrggbb colour`);
      } else def = raw.default.toLowerCase();
      break;
    case "point": {
      const d = raw.default;
      if (!isObj(d) || !isNum(d.x) || !isNum(d.y)) errors.push(`${at}.default must be {x, y} numbers`);
      else def = { x: d.x, y: d.y };
      break;
    }
  }
  const canKey = t !== "bool" && t !== "choice";
  if (raw.keyframable === true && !canKey) {
    errors.push(`${at}: ${t} parameters cannot be keyframed`);
  }
  if (raw.keyframable !== undefined && typeof raw.keyframable !== "boolean") {
    errors.push(`${at}.keyframable must be a boolean`);
  }
  if (errors.length > before || def === undefined) return null;
  const choices =
    t === "choice"
      ? (raw.choices as Array<Record<string, unknown>>).map((c) => ({
          value: String(c.value),
          label: typeof c.label === "string" && c.label ? c.label : String(c.value),
        }))
      : undefined;
  return {
    key: key as string,
    label,
    type: t,
    default: def,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(typeof raw.unit === "string" ? { unit: raw.unit } : {}),
    ...(choices ? { choices } : {}),
    keyframable: canKey && raw.keyframable !== false,
  };
}

/** Validate untrusted manifest JSON. Never throws. */
export function validatePluginManifest(raw: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["plugin.json must contain a JSON object"] };

  if (raw.apiVersion !== PLUGIN_API_VERSION) {
    errors.push(`apiVersion must be ${PLUGIN_API_VERSION} (got ${JSON.stringify(raw.apiVersion)})`);
  }
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) {
    errors.push(`id must match ${ID_RE} (lowercase letters, digits, - and _)`);
  }
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 64) {
    errors.push("name must be a non-empty string of at most 64 characters");
  }
  if (typeof raw.version !== "string" || !VERSION_RE.test(raw.version)) {
    errors.push("version must be a semantic version such as 1.0.0");
  }
  if (
    typeof raw.category !== "string" ||
    !(PLUGIN_CATEGORIES as readonly string[]).includes(raw.category)
  ) {
    errors.push(`category must be one of ${PLUGIN_CATEGORIES.join(", ")}`);
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    errors.push("description must be a string");
  }
  if (raw.author !== undefined && typeof raw.author !== "string") errors.push("author must be a string");

  const parameters: PluginParamDef[] = [];
  if (!Array.isArray(raw.parameters)) {
    errors.push("parameters must be an array (use [] for none)");
  } else if (raw.parameters.length > MAX_PLUGIN_PARAMS) {
    errors.push(`at most ${MAX_PLUGIN_PARAMS} parameters are supported`);
  } else {
    const keys = new Set<string>();
    raw.parameters.forEach((p, i) => {
      const parsed = validateParam(p, i, errors);
      if (parsed) {
        if (keys.has(parsed.key)) errors.push(`parameters[${i}].key "${parsed.key}" is duplicated`);
        keys.add(parsed.key);
        parameters.push(parsed);
      }
    });
  }

  let shader: PluginManifest["shader"];
  if (raw.shader !== undefined) {
    if (
      !isObj(raw.shader) ||
      typeof raw.shader.file !== "string" ||
      !FILE_RE.test(raw.shader.file) ||
      raw.shader.file.includes("..")
    ) {
      errors.push("shader.file must be a plain file name (no folders) such as shader.wgsl");
    } else shader = { file: raw.shader.file };
  }
  let cpu: PluginManifest["cpu"];
  if (raw.cpu !== undefined) {
    if (
      !isObj(raw.cpu) ||
      typeof raw.cpu.file !== "string" ||
      !FILE_RE.test(raw.cpu.file) ||
      raw.cpu.file.includes("..")
    ) {
      errors.push("cpu.file must be a plain file name (no folders) such as cpu.js");
    } else if (
      raw.cpu.timeoutMs !== undefined &&
      !(isNum(raw.cpu.timeoutMs) && raw.cpu.timeoutMs >= 50 && raw.cpu.timeoutMs <= 10_000)
    ) {
      errors.push("cpu.timeoutMs must be between 50 and 10000");
    } else {
      cpu = {
        file: raw.cpu.file,
        ...(isNum(raw.cpu.timeoutMs) ? { timeoutMs: raw.cpu.timeoutMs } : {}),
      };
    }
  }
  if (!shader && !cpu) {
    errors.push("a plugin needs a shader (WGSL) and/or a cpu (JavaScript) implementation");
  }
  if (raw.timeDriven !== undefined && typeof raw.timeDriven !== "boolean") {
    errors.push("timeDriven must be a boolean");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      apiVersion: PLUGIN_API_VERSION,
      id: raw.id as string,
      name: (raw.name as string).trim(),
      version: raw.version as string,
      category: raw.category as PluginCategory,
      description: typeof raw.description === "string" ? raw.description : "",
      ...(typeof raw.author === "string" ? { author: raw.author } : {}),
      parameters,
      ...(shader ? { shader } : {}),
      ...(cpu ? { cpu } : {}),
      timeDriven: raw.timeDriven === true,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Parameter resolution                                                        */
/* -------------------------------------------------------------------------- */

export type PluginParamValue = number | boolean | string | { x: number; y: number };
export type ResolvedPluginParams = Record<string, PluginParamValue>;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function resolvePluginParam(def: PluginParamDef, raw: unknown): PluginParamValue {
  switch (def.type) {
    case "float":
    case "int":
    case "angle": {
      let v = isNum(raw) ? raw : (def.default as number);
      v = clamp(v, def.min ?? -Infinity, def.max ?? Infinity);
      return def.type === "int" ? Math.round(v) : v;
    }
    case "bool":
      return typeof raw === "boolean" ? raw : (def.default as boolean);
    case "choice":
      return typeof raw === "string" && def.choices?.some((c) => c.value === raw)
        ? raw
        : (def.default as string);
    case "color":
      return typeof raw === "string" && HEX_RE.test(raw) ? raw.toLowerCase() : (def.default as string);
    case "point": {
      const d = def.default as { x: number; y: number };
      if (isObj(raw) && isNum(raw.x) && isNum(raw.y)) return { x: raw.x, y: raw.y };
      return { ...d };
    }
  }
}

/** Every manifest parameter resolved against stored effect params: defaults for missing/invalid, clamped to range. */
export function resolvePluginParams(
  manifest: Pick<PluginManifest, "parameters">,
  raw: Readonly<Record<string, unknown>> | undefined,
): ResolvedPluginParams {
  const out: ResolvedPluginParams = {};
  for (const def of manifest.parameters) out[def.key] = resolvePluginParam(def, raw?.[def.key]);
  return out;
}

export function defaultPluginParams(manifest: Pick<PluginManifest, "parameters">): ResolvedPluginParams {
  return resolvePluginParams(manifest, undefined);
}

/**
 * Params stored on a freshly added effect: every default plus the plugin
 * version the effect was authored with.
 */
export function newPluginEffectParams(
  manifest: PluginManifest,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...resolvePluginParams(manifest, overrides),
    [PLUGIN_VERSION_PARAM]: manifest.version,
  };
}

/* -------------------------------------------------------------------------- */
/* Uniform layout (WGSL struct OrParams)                                       */
/* -------------------------------------------------------------------------- */

export interface ParamSlot {
  readonly key: string;
  readonly type: PluginParamType;
  readonly wgslType: "f32" | "i32" | "u32" | "vec2<f32>" | "vec4<f32>";
  readonly offset: number;
}

export interface ParamLayout {
  readonly slots: readonly ParamSlot[];
  /** Byte size of the uniform buffer (multiple of 16, at least 16). */
  readonly byteSize: number;
}

const WGSL_SIZE: Record<ParamSlot["wgslType"], { size: number; align: number }> = {
  f32: { size: 4, align: 4 },
  i32: { size: 4, align: 4 },
  u32: { size: 4, align: 4 },
  "vec2<f32>": { size: 8, align: 8 },
  "vec4<f32>": { size: 16, align: 16 },
};

function slotType(t: PluginParamType): ParamSlot["wgslType"] {
  switch (t) {
    case "float":
    case "angle":
      return "f32";
    case "int":
    case "choice":
      return "i32";
    case "bool":
      return "u32";
    case "point":
      return "vec2<f32>";
    case "color":
      return "vec4<f32>";
  }
}

/** Lay the manifest parameters out following WGSL uniform struct alignment rules. */
export function computeParamLayout(manifest: Pick<PluginManifest, "parameters">): ParamLayout {
  const slots: ParamSlot[] = [];
  let offset = 0;
  for (const p of manifest.parameters) {
    const wgslType = slotType(p.type);
    const { size, align } = WGSL_SIZE[wgslType];
    offset = Math.ceil(offset / align) * align;
    slots.push({ key: p.key, type: p.type, wgslType, offset });
    offset += size;
  }
  const byteSize = Math.max(16, Math.ceil(offset / 16) * 16);
  return { slots, byteSize };
}

/** WGSL declaration of `struct OrParams` for a manifest. */
export function generateParamsStruct(manifest: Pick<PluginManifest, "parameters">): string {
  const layout = computeParamLayout(manifest);
  if (layout.slots.length === 0) return "struct OrParams {\n  orUnused: f32,\n}\n";
  const members = layout.slots.map((s) => `  ${s.key}: ${s.wgslType},`).join("\n");
  return `struct OrParams {\n${members}\n}\n`;
}

/**
 * Pack resolved params into the uniform buffer. Colours become sRGB-encoded
 * vec4 (the numbers the user sees), angles radians, bools 0/1 and choices the
 * zero based index into `choices`.
 */
export function packPluginParams(
  manifest: Pick<PluginManifest, "parameters">,
  layout: ParamLayout,
  values: ResolvedPluginParams,
): ArrayBuffer {
  const buffer = new ArrayBuffer(layout.byteSize);
  const f32 = new Float32Array(buffer);
  const i32 = new Int32Array(buffer);
  const u32 = new Uint32Array(buffer);
  const defs = new Map(manifest.parameters.map((p) => [p.key, p]));
  for (const slot of layout.slots) {
    const def = defs.get(slot.key)!;
    const v = values[slot.key];
    const w = slot.offset / 4;
    switch (slot.type) {
      case "float":
        f32[w] = v as number;
        break;
      case "angle":
        f32[w] = ((v as number) * Math.PI) / 180;
        break;
      case "int":
        i32[w] = v as number;
        break;
      case "bool":
        u32[w] = v === true ? 1 : 0;
        break;
      case "choice":
        i32[w] = Math.max(0, def.choices?.findIndex((c) => c.value === v) ?? 0);
        break;
      case "point": {
        const p = v as { x: number; y: number };
        f32[w] = p.x;
        f32[w + 1] = p.y;
        break;
      }
      case "color": {
        const c = hexToRgb(v as string);
        f32[w] = c.r;
        f32[w + 1] = c.g;
        f32[w + 2] = c.b;
        f32[w + 3] = 1;
        break;
      }
    }
  }
  return buffer;
}

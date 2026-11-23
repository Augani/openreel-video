import type {
  MogrtControl,
  MogrtControlBinding,
  MogrtControlKind,
  MogrtDefinition,
  MogrtFontInfo,
} from "./types";

/**
 * definition.json reader.
 *
 * Verified against public evidence (Adobe forum posts and tools that edit .mogrt files): the file is JSON with
 * `authorApp` ("ppro" for Premiere, "aeft" for After Effects), a list of controls, per-control font information in
 * `fonteditinfo` (`capPropFontEdit`, `capPropFontSizeEdit`, `fontEditValue`, `fontSizeEditValue`, `fontFSBoldValue`,
 * `fontFSItalicValue`, `fontFSAllCapsValue`) and `textEditValue` for text. Control types are GUIDs whose meaning is
 * not published, and no real Premiere-authored file was available for verification, so this reader is deliberately
 * tolerant: a control's kind is taken from a recognisable type name when there is one, otherwise from the shape of
 * its value, and `clientControls` is accepted at the top level or under `capsule`. Anything unrecognised is kept in
 * `unreadKeys` / `rawType` and reaches the import report instead of being guessed at.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A localised string: plain, `{strDB:[{locale,str}]}`, `{str}` or a locale map. English preferred. */
export function localizedString(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value;
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    const entries = value.filter(isRecord);
    const pick = entries.find((e) => /^en([_-]|$)/i.test(String(e.locale ?? e.localeString ?? e.lang ?? ""))) ?? entries[0];
    return pick ? localizedString(pick, depth + 1) : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.str === "string") return value.str;
  if (value.strDB !== undefined) return localizedString(value.strDB, depth + 1);
  for (const key of ["en_US", "en-US", "en", "default"]) {
    if (value[key] !== undefined) return localizedString(value[key], depth + 1) ?? (isRecord(value[key]) ? localizedString((value[key] as Record<string, unknown>).name, depth + 1) : undefined);
  }
  const first = Object.values(value).find((v) => typeof v === "string" || isRecord(v));
  return first === undefined ? undefined : localizedString(first, depth + 1);
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kindFromTypeName(raw: string): MogrtControlKind | undefined {
  if (!raw || GUID.test(raw)) return undefined;
  const t = raw.toLowerCase();
  if (/media|image|footage|replace|placeholder/.test(t)) return "media";
  if (/font/.test(t)) return "font";
  if (/colou?r/.test(t)) return "color";
  if (/check|bool|toggle/.test(t)) return "checkbox";
  if (/slider|number|float|int|range|angle|percent/.test(t)) return "slider";
  if (/point|position|vector/.test(t)) return "point";
  if (/text|string|source/.test(t)) return "text";
  return undefined;
}

/** Colour in any of the shapes seen in the wild, as #rrggbb (or rgba()). */
export function parseMogrtColor(value: unknown): string | undefined {
  if (typeof value === "string") {
    const hex = value.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) return `#${hex[1].toLowerCase()}`;
    return undefined;
  }
  let channels: number[] | undefined;
  if (Array.isArray(value) && value.length >= 3 && value.every((v) => typeof v === "number")) channels = value as number[];
  else if (isRecord(value)) {
    const pick = (...keys: string[]): number | undefined => {
      for (const key of keys) {
        const n = asNumber(value[key]);
        if (n !== undefined) return n;
      }
      return undefined;
    };
    const r = pick("r", "red", "mRed", "R");
    const g = pick("g", "green", "mGreen", "G");
    const b = pick("b", "blue", "mBlue", "B");
    const a = pick("a", "alpha", "mAlpha", "A");
    if (r !== undefined && g !== undefined && b !== undefined) channels = a !== undefined ? [r, g, b, a] : [r, g, b];
    else if (value.color !== undefined) return parseMogrtColor(value.color);
    else if (value.value !== undefined) return parseMogrtColor(value.value);
  }
  if (!channels) return undefined;
  const scale = channels.slice(0, 3).some((c) => c > 1) ? 1 : 255;
  const to = (c: number) => Math.round(Math.min(255, Math.max(0, c * scale)));
  const hex = (c: number) => to(c).toString(16).padStart(2, "0");
  const base = `#${hex(channels[0])}${hex(channels[1])}${hex(channels[2])}`;
  if (channels.length > 3) {
    const alpha = channels[3] > 1 ? channels[3] / 255 : channels[3];
    if (alpha < 0.999) return `${base}${Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0")}`;
  }
  return base;
}

function readFont(control: Record<string, unknown>): MogrtFontInfo | undefined {
  const holder = [control.fonteditinfo, isRecord(control.value) ? control.value.fonteditinfo : undefined, control.fontEditInfo].find(isRecord);
  if (!holder) return undefined;
  const family = typeof holder.fontEditValue === "string" ? holder.fontEditValue : undefined;
  return {
    fontEditable: holder.capPropFontEdit === true,
    fontSizeEditable: holder.capPropFontSizeEdit === true,
    ...(family ? { fontFamily: family } : {}),
    ...(asNumber(holder.fontSizeEditValue) !== undefined ? { fontSize: asNumber(holder.fontSizeEditValue) } : {}),
    ...(typeof holder.fontFSBoldValue === "boolean" ? { bold: holder.fontFSBoldValue } : {}),
    ...(typeof holder.fontFSItalicValue === "boolean" ? { italic: holder.fontFSItalicValue } : {}),
    ...(typeof holder.fontFSAllCapsValue === "boolean" ? { allCaps: holder.fontFSAllCapsValue } : {}),
  };
}

function readText(control: Record<string, unknown>): string | undefined {
  if (typeof control.textEditValue === "string") return control.textEditValue;
  const value = control.value;
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    if (typeof value.textEditValue === "string") return value.textEditValue;
    return localizedString(value);
  }
  return undefined;
}

function readBindings(control: Record<string, unknown>): MogrtControlBinding[] {
  const raw = control.targets ?? control.bindings ?? control.binding ?? control.target;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const out: MogrtControlBinding[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      const [layer, property] = entry.includes("/") ? entry.split("/", 2) : [undefined, entry];
      out.push({ ...(layer ? { layer } : {}), property });
    } else if (isRecord(entry)) {
      const layer = [entry.layerId, entry.layer, entry.layerName].find((v) => typeof v === "string") as string | undefined;
      const property = [entry.property, entry.propertyName, entry.param].find((v) => typeof v === "string") as string | undefined;
      if (layer || property) out.push({ ...(layer ? { layer } : {}), ...(property ? { property } : {}) });
    }
  }
  return out;
}

function readControl(raw: unknown, index: number): MogrtControl | undefined {
  if (!isRecord(raw)) return undefined;
  const id = String(raw.id ?? raw.controlId ?? raw.uuid ?? `control-${index + 1}`);
  const name = localizedString(raw.uiName) ?? localizedString(raw.name) ?? localizedString(raw.displayName) ?? `Control ${index + 1}`;
  const rawType = String(raw.type ?? raw.controlType ?? "");
  const font = readFont(raw);
  const value = isRecord(raw.value) && "value" in raw.value && Object.keys(raw.value).length <= 3 ? (raw.value as Record<string, unknown>).value : raw.value;

  let kind = kindFromTypeName(rawType);
  if (!kind) {
    if (typeof raw.textEditValue === "string" || font) kind = "text";
    else if (parseMogrtColor(value) !== undefined && (typeof value !== "string" || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))) kind = "color";
    else if (typeof value === "boolean") kind = "checkbox";
    else if (typeof value === "number") kind = "slider";
    else if (isRecord(value) && asNumber(value.x) !== undefined && asNumber(value.y) !== undefined) kind = "point";
    else if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number")) kind = "point";
    else if (isRecord(value) && (value.mediaReplacement !== undefined || value.mediaPath !== undefined || value.mediaId !== undefined)) kind = "media";
    else if (typeof value === "string" || isRecord(value)) kind = typeof (readText(raw)) === "string" ? "text" : "unknown";
    else kind = "unknown";
  }

  let defaultValue: MogrtControl["defaultValue"];
  switch (kind) {
    case "text": defaultValue = readText(raw); break;
    case "font": defaultValue = typeof value === "string" ? value : font?.fontFamily; break;
    case "color": defaultValue = parseMogrtColor(value); break;
    case "checkbox": defaultValue = typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : undefined; break;
    case "slider": defaultValue = asNumber(value) ?? asNumber(raw.defaultValue); break;
    case "point":
      if (isRecord(value) && asNumber(value.x) !== undefined && asNumber(value.y) !== undefined) defaultValue = { x: value.x as number, y: value.y as number };
      else if (Array.isArray(value) && value.length === 2) defaultValue = { x: Number(value[0]), y: Number(value[1]) };
      break;
    default: break;
  }
  const pickNum = (...keys: string[]) => keys.map((k) => asNumber(raw[k])).find((v) => v !== undefined);
  const options = Array.isArray(raw.options) ? raw.options.map((o) => localizedString(o)).filter((o): o is string => typeof o === "string") : undefined;
  const group = localizedString(raw.uiGroupName) ?? localizedString(raw.group) ?? localizedString(raw.groupName);
  const min = pickNum("min", "minValue", "sliderMin", "uiMin");
  const max = pickNum("max", "maxValue", "sliderMax", "uiMax");
  const step = pickNum("step", "stepSize");
  return {
    id,
    name,
    ...(group ? { group } : {}),
    kind,
    rawType,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(options?.length ? { options } : {}),
    ...(font ? { font } : {}),
    bindings: readBindings(raw),
  };
}

const KNOWN_TOP_KEYS = new Set([
  "clientControls", "capsule", "authorApp", "authorAppVersion", "sourceInfoLocalized", "schemaVersion", "schemaversion",
  "capsuleformat", "version", "mogrtVersion", "name", "description", "duration", "thumbnail", "controlGroups", "id",
]);

/** Parse definition.json text. Throws a plain Error with a user-facing message when it is not JSON. */
export function parseMogrtDefinition(text: string): MogrtDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new Error("definition.json is not valid JSON.");
  }
  if (!isRecord(parsed)) throw new Error("definition.json is not a JSON object.");
  const capsule = isRecord(parsed.capsule) ? parsed.capsule : {};
  const rawControls = [parsed.clientControls, capsule.clientControls].find(Array.isArray) as unknown[] | undefined ?? [];
  const controls = rawControls.flatMap((raw, index) => {
    const control = readControl(raw, index);
    return control ? [control] : [];
  });
  const source = isRecord(parsed.sourceInfoLocalized) ? parsed.sourceInfoLocalized : isRecord(capsule.sourceInfoLocalized) ? capsule.sourceInfoLocalized : undefined;
  // sourceInfoLocalized: { en_US: { name, description } } (any locale; English preferred).
  const locales = source ? Object.entries(source).filter(([, v]) => isRecord(v)) : [];
  const info = (locales.find(([key]) => /^en([_-]|$)/i.test(key)) ?? locales[0])?.[1] as Record<string, unknown> | undefined;
  const name = (info && localizedString(info.name)) ?? localizedString(parsed.name) ?? localizedString(capsule.name);
  const description = (info && localizedString(info.description)) ?? localizedString(parsed.description) ?? localizedString(capsule.description);
  const authorApp = typeof parsed.authorApp === "string" ? parsed.authorApp : typeof capsule.authorApp === "string" ? capsule.authorApp : undefined;
  const authorAppVersion = typeof parsed.authorAppVersion === "string" ? parsed.authorAppVersion : undefined;
  const duration = asNumber(parsed.duration) ?? asNumber(capsule.duration);
  return {
    ...(authorApp ? { authorApp } : {}),
    ...(authorAppVersion ? { authorAppVersion } : {}),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(duration !== undefined ? { duration } : {}),
    controls,
    unreadKeys: Object.keys(parsed).filter((key) => !KNOWN_TOP_KEYS.has(key)),
  };
}

/** True when `authorApp` says After Effects ("aeft", "AfterEffects", ...). */
export const isAfterEffectsAuthor = (authorApp: string | undefined): boolean => !!authorApp && /^(aeft|after\s*effects|ae)$/i.test(authorApp.trim());
export const isPremiereAuthor = (authorApp: string | undefined): boolean => !!authorApp && /^(ppro|premiere)/i.test(authorApp.trim());

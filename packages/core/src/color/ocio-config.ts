import { FOOTAGE_COLOR_PRESETS, isFootageColorPreset, type FootageColorPreset } from "./source-color";

/**
 * OCIO configuration import, deliberately partial.
 *
 * OpenReel does not embed OpenColorIO. What it can do honestly is read an `.ocio` file's colour space list and tell the
 * user which of those spaces are the same thing as one of the built-in analytic Interpret Footage presets (sRGB,
 * Rec.709, linear Rec.709 / Rec.2020 / P3, ACEScg, ACES2065-1, ACEScct and the camera log curves), and which are not.
 * Choosing a supported OCIO colour space applies the matching preset; it does not run the config's own transforms.
 *
 * A space is supported when either
 *   - its transforms are (or contain) an OCIO `BuiltinTransform` whose style is one of the known camera / ACES styles
 *     below (matched on the style, so a renamed colour space still maps), or
 *   - its name or an alias is one of the well-known names the ACES and "cg" reference configs use for these spaces
 *     and it carries no LUT of its own (a LUT-based space of the same name may be a different curve).
 * Everything else is reported as unsupported with the reason (LUT files, parametric curves, data spaces, unknown names).
 *
 * The parser reads the subset of YAML OCIO writes: top level keys, `colorspaces:` entries introduced by
 * `!<ColorSpace>`, scalar / inline-list / block-list properties, `|` block scalars and nested transforms. It does not
 * resolve anchors, includes or search paths.
 */

export interface OcioColorSpace {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly family: string;
  readonly isData: boolean;
  /** Transform tags found in the space's to / from reference sections, e.g. "BuiltinTransform", "FileTransform". */
  readonly transformKinds: readonly string[];
  /** `style:` values of its BuiltinTransforms. */
  readonly builtinStyles: readonly string[];
  /** `src:` values of its FileTransforms (LUT files). */
  readonly files: readonly string[];
}

export interface OcioConfigSummary {
  readonly profileVersion: string | null;
  readonly name: string | null;
  readonly roles: Readonly<Record<string, string>>;
  readonly colorSpaces: readonly OcioColorSpace[];
}

export interface OcioSupportedSpace {
  readonly name: string;
  readonly preset: FootageColorPreset;
  readonly via: "builtin-transform" | "name";
}

export interface OcioUnsupportedSpace {
  readonly name: string;
  readonly reason: string;
}

export interface OcioMapping {
  readonly supported: readonly OcioSupportedSpace[];
  readonly unsupported: readonly OcioUnsupportedSpace[];
}

export class OcioConfigError extends Error {}

const MAX_CONFIG_BYTES = 8 * 1024 * 1024;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

function stripComment(line: string): string {
  // A '#' starts a comment unless it is inside quotes. OCIO configs do not use '#' inside values otherwise.
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

function parseInlineList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = null;
      else current += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ",") {
      out.push(current.trim());
      current = "";
    } else current += c;
  }
  out.push(current.trim());
  return out.filter((item) => item.length > 0);
}

interface Block {
  readonly lines: string[];
}

/** Splits the `colorspaces:` section into one block of lines per `!<ColorSpace>` entry. */
function colorSpaceBlocks(lines: readonly string[]): Block[] {
  const start = lines.findIndex((l) => /^colorspaces\s*:\s*$/.test(l));
  if (start < 0) return [];
  const blocks: Block[] = [];
  let current: string[] | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // A new top-level key ends the section.
    if (indentOf(line) === 0 && /^[A-Za-z_][\w-]*\s*:/.test(line)) break;
    if (/^\s*-\s*!<(ColorSpace)>/.test(line) || /^\s*-\s*!ColorSpace\b/.test(line)) {
      current = [line];
      blocks.push({ lines: current });
    } else if (current) current.push(line);
  }
  return blocks;
}

function parseColorSpace(block: Block): OcioColorSpace | null {
  const lines = block.lines;
  const entryIndent = indentOf(lines[0]);
  // The entry's own properties sit one level deeper than the dash (or on the dash line, for "- !<ColorSpace> {…}" which OCIO does not write).
  let name = "";
  let family = "";
  let isData = false;
  let aliases: string[] = [];
  const kinds = new Set<string>();
  const styles: string[] = [];
  const files: string[] = [];
  let propIndent = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentOf(line);
    const text = line.trim();
    if (propIndent < 0) propIndent = indent;
    if (indent === propIndent) {
      const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(text);
      if (!m) continue;
      const [, key, rawValue] = m;
      const value = rawValue.trim();
      if (key === "name") name = unquote(value);
      else if (key === "family") family = unquote(value);
      else if (key === "isdata") isData = /^(true|yes)$/i.test(value);
      else if (key === "aliases") {
        if (value.startsWith("[")) aliases = parseInlineList(value);
        else if (value === "") {
          // Block list on the following lines (YAML allows the dashes at the key's own indent).
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() === "") continue;
            const item = /^(\s*)-\s*(.+)$/.exec(lines[j]);
            if (!item || item[1].length < propIndent) break;
            aliases.push(unquote(item[2]));
          }
        } else aliases = [unquote(value)];
      }
    }
    // Transform tags and their parameters may sit anywhere under to_/from_ reference sections.
    for (const tag of text.matchAll(/!<([A-Za-z]+)>/g)) kinds.add(tag[1]);
    const style = /\bstyle\s*:\s*([^,}\s][^,}]*)/.exec(text);
    if (style) styles.push(unquote(style[1]));
    const src = /\bsrc\s*:\s*([^,}\s][^,}]*)/.exec(text);
    if (src) files.push(unquote(src[1]));
  }
  void entryIndent;
  if (!name) return null;
  return { name, aliases, family, isData, transformKinds: [...kinds].filter((k) => k !== "ColorSpace"), builtinStyles: styles, files };
}

/** Reads the colour spaces, roles and version of an OCIO config. Throws `OcioConfigError` for text that is not a config. */
export function parseOcioConfig(text: string): OcioConfigSummary {
  if (text.length > MAX_CONFIG_BYTES) throw new OcioConfigError("The file is too large to be an OCIO config.");
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(stripComment);
  const version = lines.map((l) => /^ocio_profile_version\s*:\s*(.+)$/.exec(l)?.[1]).find(Boolean);
  if (!version && !lines.some((l) => /^colorspaces\s*:/.test(l))) {
    throw new OcioConfigError("This does not look like an OCIO config (no ocio_profile_version or colorspaces).");
  }
  const roles: Record<string, string> = {};
  const rolesStart = lines.findIndex((l) => /^roles\s*:\s*$/.test(l));
  if (rolesStart >= 0) {
    for (let i = rolesStart + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      if (indentOf(line) === 0) break;
      const m = /^\s+([\w-]+)\s*:\s*(.+)$/.exec(line);
      if (m) roles[m[1]] = unquote(m[2]);
    }
  }
  const name = lines.map((l) => /^name\s*:\s*(.+)$/.exec(l)?.[1]).find(Boolean);
  const colorSpaces = colorSpaceBlocks(lines)
    .map(parseColorSpace)
    .filter((space): space is OcioColorSpace => space !== null);
  if (colorSpaces.length === 0) throw new OcioConfigError("The config has no colour spaces.");
  return { profileVersion: version ? unquote(version) : null, name: name ? unquote(name) : null, roles, colorSpaces };
}

// -- mapping to the built-in presets ----------------------------------------------------------------------------------

/**
 * OCIO BuiltinTransform styles (`ocio://` builtin list) that are exactly one of our presets. S-Gamut3 (not .Cine) is a different gamut from
 * the preset's S-Gamut3.Cine, so it is not listed.
 */
const BUILTIN_STYLE_PRESETS: Readonly<Record<string, FootageColorPreset>> = {
  "ACEScct_to_ACES2065-1": "aces-acescct",
  "ACEScg_to_ACES2065-1": "aces-acescg",
  "ARRI_ALEXA-LOGC-EI800-AWG_to_ACES2065-1": "log-logc3",
  "ARRI_LOGC4_to_ACES2065-1": "log-logc4",
  "CANON_CLOG3-CGAMUT_to_ACES2065-1": "log-clog3",
  "PANASONIC_VLOG-VGAMUT_to_ACES2065-1": "log-vlog",
  "SONY_SLOG3-SGAMUT3.CINE_to_ACES2065-1": "log-slog3",
};

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Well-known colour space names of the ACES / "cg" reference configs (and OCIO v1 ACES configs), normalised. */
const NAME_PRESETS: Readonly<Record<string, FootageColorPreset>> = {
  "srgb": "srgb",
  "srgb texture": "srgb",
  "srgb encoded p3 d65 texture": "p3",
  "srgb encoded display p3": "p3",
  "utility srgb texture": "srgb",
  "input generic srgb texture": "srgb",
  "srgb encoded rec 709 srgb": "srgb",
  "camera rec 709": "rec709",
  "rec 709 camera": "rec709",
  "input generic rec 709 camera": "rec709",
  "rec709": "rec709",
  "linear rec 709 srgb": "linear-rec709",
  "linear rec 709": "linear-rec709",
  "utility linear srgb": "linear-rec709",
  "utility linear rec 709": "linear-rec709",
  "lin rec709": "linear-rec709",
  "linear rec 2020": "linear-rec2020",
  "utility linear rec 2020": "linear-rec2020",
  "lin rec2020": "linear-rec2020",
  "linear p3 d65": "linear-p3",
  "utility linear p3 d65": "linear-p3",
  "lin p3d65": "linear-p3",
  "rec 2100 pq": "hdr10-pq",
  "st2084 p3 d65": "hdr10-pq",
  "rec 2100 hlg": "hlg",
  "acescg": "aces-acescg",
  "aces cg": "aces-acescg",
  "aces2065 1": "aces-aces2065",
  "aces": "aces-aces2065",
  "acescct": "aces-acescct",
  "aces cct": "aces-acescct",
  "arri logc3 awg3": "log-logc3",
  "input arri v3 logc ei800 wide gamut": "log-logc3",
  "arri logc4 awg4": "log-logc4",
  "input arri logc4": "log-logc4",
  "input sony s log3 s gamut3 cine": "log-slog3",
  "s log3 s gamut3 cine": "log-slog3",
  "input panasonic v log v gamut": "log-vlog",
  "v log v gamut": "log-vlog",
  "input canon canon log 3 cinema gamut": "log-clog3",
  "canon log 3 cinema gamut": "log-clog3",
};

/** Maps an OCIO config's colour spaces onto the built-in presets, and says why the rest cannot be. */
export function mapOcioColorSpaces(config: OcioConfigSummary): OcioMapping {
  const supported: OcioSupportedSpace[] = [];
  const unsupported: OcioUnsupportedSpace[] = [];
  for (const space of config.colorSpaces) {
    const byStyle = space.builtinStyles.map((style) => BUILTIN_STYLE_PRESETS[style]).find((p) => p !== undefined);
    if (byStyle && isFootageColorPreset(byStyle)) {
      supported.push({ name: space.name, preset: byStyle, via: "builtin-transform" });
      continue;
    }
    // A name is only trusted when the space does not carry its own LUT: a LUT-based space of the same name may be a different curve.
    const usesLut = space.files.length > 0 || space.transformKinds.includes("FileTransform");
    const byName = usesLut ? undefined : [space.name, ...space.aliases].map((n) => NAME_PRESETS[normalise(n)]).find((p) => p !== undefined);
    if (byName && isFootageColorPreset(byName) && FOOTAGE_COLOR_PRESETS.some((p) => p.id === byName)) {
      supported.push({ name: space.name, preset: byName, via: "name" });
      continue;
    }
    unsupported.push({ name: space.name, reason: unsupportedReason(space) });
  }
  return { supported, unsupported };
}

function unsupportedReason(space: OcioColorSpace): string {
  if (space.isData) return "data colour space (no colour interpretation)";
  if (space.files.length > 0) return `needs the LUT file ${space.files[0]}; LUT-based spaces are not evaluated`;
  if (space.transformKinds.includes("FileTransform")) return "uses a file transform (LUT); not evaluated";
  if (space.builtinStyles.length > 0) return `OCIO builtin ${space.builtinStyles[0]} has no matching Interpret Footage preset`;
  if (space.transformKinds.some((k) => /Exponent|Log|Matrix|CDL|Fixed|Grading|Range|Allocation/.test(k))) {
    return `parametric ${space.transformKinds.join(" / ")} transform with no matching built-in preset`;
  }
  if (space.transformKinds.length === 0) return "no transform and no recognised name (a reference-like or display space)";
  return "no matching built-in analytic transform";
}

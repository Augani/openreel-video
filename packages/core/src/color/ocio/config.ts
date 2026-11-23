import { parseYaml, YamlError, type YamlValue } from "./yaml";

/**
 * The structure of an OCIO config: colour spaces, roles, displays / views, view transforms, looks. Transforms stay as the
 * tagged nodes the YAML reader produced (`{ $tag: "MatrixTransform", matrix: [...] }`); `compile.ts` turns them into ops.
 */

export type TransformNode = { readonly $tag: string; readonly [key: string]: YamlValue };

export type ReferenceSpaceType = "scene" | "display";

export interface OcioSpaceDef {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly family: string;
  readonly description: string;
  readonly isData: boolean;
  /** `encoding:` of the config (scene-linear, log, sdr-video, ...), empty when absent. */
  readonly encoding: string;
  readonly referenceSpaceType: ReferenceSpaceType;
  readonly categories: readonly string[];
  /** To / from the scene reference (v1 `to_reference` / `from_reference` and v2 `to_scene_reference` / `from_scene_reference`). */
  readonly toScene: TransformNode | null;
  readonly fromScene: TransformNode | null;
  readonly toDisplay: TransformNode | null;
  readonly fromDisplay: TransformNode | null;
}

export interface OcioViewDef {
  readonly name: string;
  readonly viewTransform: string | null;
  /** A colour space name, or `<USE_DISPLAY_NAME>`. */
  readonly colorSpace: string | null;
  readonly looks: string | null;
  readonly description: string;
}

export interface OcioViewTransformDef {
  readonly name: string;
  readonly referenceSpaceType: ReferenceSpaceType;
  readonly toScene: TransformNode | null;
  readonly fromScene: TransformNode | null;
  readonly toDisplay: TransformNode | null;
  readonly fromDisplay: TransformNode | null;
}

export interface OcioLookDef {
  readonly name: string;
  readonly processSpace: string;
  readonly transform: TransformNode | null;
  readonly inverseTransform: TransformNode | null;
  readonly description: string;
}

export interface OcioNamedTransformDef {
  readonly name: string;
  readonly forward: TransformNode | null;
  readonly inverse: TransformNode | null;
}

export interface OcioDisplayDef {
  readonly name: string;
  readonly views: readonly OcioViewDef[];
}

export interface OcioConfig {
  readonly version: { readonly major: number; readonly minor: number; readonly text: string };
  readonly name: string;
  readonly description: string;
  readonly searchPath: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly roles: Readonly<Record<string, string>>;
  readonly spaces: readonly OcioSpaceDef[];
  readonly displays: readonly OcioDisplayDef[];
  readonly activeDisplays: readonly string[];
  readonly activeViews: readonly string[];
  readonly viewTransforms: readonly OcioViewTransformDef[];
  readonly looks: readonly OcioLookDef[];
  readonly namedTransforms: readonly OcioNamedTransformDef[];
  readonly inactiveColorSpaces: readonly string[];
  readonly defaultViewTransform: string | null;
}

export class OcioParseError extends Error {}

const MAX_CONFIG_BYTES = 8 * 1024 * 1024;

type Obj = { readonly [key: string]: YamlValue };

function isObj(v: YamlValue | undefined): v is Obj {
  return v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v);
}

function str(v: YamlValue | undefined, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return typeof v === "string" ? v : String(v);
}

function strList(v: YamlValue | undefined): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => str(x)).filter((x) => x !== "");
  const s = str(v);
  return s === "" ? [] : s.split(",").map((x) => x.trim()).filter(Boolean);
}

function node(v: YamlValue | undefined): TransformNode | null {
  return isObj(v) && typeof v.$tag === "string" ? (v as unknown as TransformNode) : null;
}

function tagOf(v: YamlValue): string | null {
  return isObj(v) && typeof v.$tag === "string" ? v.$tag : null;
}

function parseSpace(entry: Obj, forced: ReferenceSpaceType | null): OcioSpaceDef | null {
  const name = str(entry.name);
  if (!name) return null;
  const refType = str(entry.reference_space_type, "scene");
  return {
    name,
    aliases: strList(entry.aliases),
    family: str(entry.family),
    description: str(entry.description).trim(),
    isData: entry.isdata === true,
    encoding: str(entry.encoding),
    referenceSpaceType: forced ?? (refType === "display" ? "display" : "scene"),
    categories: strList(entry.categories),
    toScene: node(entry.to_scene_reference) ?? node(entry.to_reference),
    fromScene: node(entry.from_scene_reference) ?? node(entry.from_reference),
    toDisplay: node(entry.to_display_reference),
    fromDisplay: node(entry.from_display_reference),
  };
}

function parseView(entry: Obj): OcioViewDef | null {
  const name = str(entry.name);
  if (!name) return null;
  return {
    name,
    viewTransform: entry.view_transform === undefined || entry.view_transform === null ? null : str(entry.view_transform),
    colorSpace: entry.colorspace === undefined || entry.colorspace === null ? (entry.display_colorspace === undefined ? null : str(entry.display_colorspace)) : str(entry.colorspace),
    looks: entry.looks === undefined || entry.looks === null ? null : str(entry.looks),
    description: str(entry.description).trim(),
  };
}

/** Reads an OCIO config. Throws `OcioParseError` for text that is not one. */
export function parseOcioFull(text: string): OcioConfig {
  if (text.length > MAX_CONFIG_BYTES) throw new OcioParseError("The file is too large to be an OCIO config.");
  let root: YamlValue;
  try {
    root = parseYaml(text);
  } catch (error) {
    throw new OcioParseError(error instanceof YamlError ? `Could not read the config: ${error.message}` : "Could not read the config.");
  }
  if (!isObj(root) || (root.ocio_profile_version === undefined && root.colorspaces === undefined)) {
    throw new OcioParseError("This does not look like an OCIO config (no ocio_profile_version or colorspaces).");
  }
  const versionText = str(root.ocio_profile_version, "1");
  const [majorText, minorText] = versionText.split(".");
  const major = Number.parseInt(majorText, 10) || 1;
  const minor = Number.parseInt(minorText ?? "0", 10) || 0;

  const environment: Record<string, string> = {};
  if (isObj(root.environment)) for (const [k, v] of Object.entries(root.environment)) environment[k] = str(v);

  const roles: Record<string, string> = {};
  if (isObj(root.roles)) for (const [k, v] of Object.entries(root.roles)) roles[k] = str(v);

  const spaces: OcioSpaceDef[] = [];
  for (const [key, forced] of [["colorspaces", null], ["display_colorspaces", "display"]] as const) {
    const list = root[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (isObj(entry) && tagOf(entry) === "ColorSpace") {
        const space = parseSpace(entry, forced);
        if (space) spaces.push(space);
      }
    }
  }
  if (spaces.length === 0) throw new OcioParseError("The config has no colour spaces.");

  // Shared views are named, then referenced from displays.
  const shared = new Map<string, OcioViewDef>();
  if (Array.isArray(root.shared_views)) {
    for (const entry of root.shared_views) {
      if (isObj(entry)) {
        const v = parseView(entry);
        if (v) shared.set(v.name, v);
      }
    }
  }
  const displays: OcioDisplayDef[] = [];
  if (isObj(root.displays)) {
    for (const [displayName, list] of Object.entries(root.displays)) {
      const views: OcioViewDef[] = [];
      const items = Array.isArray(list) ? list : [];
      for (const item of items) {
        if (!isObj(item)) continue;
        const tag = tagOf(item);
        if (tag === "Views") {
          for (const viewName of strList((item as Obj).$value)) {
            const sharedView = shared.get(viewName);
            if (sharedView) views.push(sharedView);
            else views.push({ name: viewName, viewTransform: null, colorSpace: null, looks: null, description: "" });
          }
        } else if (tag === "View" || tag === null) {
          const v = parseView(item);
          if (v) views.push(v);
        }
      }
      displays.push({ name: displayName, views });
    }
  } else if (Array.isArray(root.displays)) {
    // not valid OCIO
  }

  const viewTransforms: OcioViewTransformDef[] = [];
  if (Array.isArray(root.view_transforms)) {
    for (const entry of root.view_transforms) {
      if (!isObj(entry)) continue;
      const name = str(entry.name);
      if (!name) continue;
      viewTransforms.push({
        name,
        referenceSpaceType: str(entry.reference_space_type, "scene") === "display" ? "display" : "scene",
        toScene: node(entry.to_scene_reference),
        fromScene: node(entry.from_scene_reference),
        toDisplay: node(entry.to_display_reference),
        fromDisplay: node(entry.from_display_reference),
      });
    }
  }

  const looks: OcioLookDef[] = [];
  if (Array.isArray(root.looks)) {
    for (const entry of root.looks) {
      if (!isObj(entry)) continue;
      const name = str(entry.name);
      if (!name) continue;
      looks.push({
        name,
        processSpace: str(entry.process_space),
        transform: node(entry.transform),
        inverseTransform: node(entry.inverse_transform),
        description: str(entry.description).trim(),
      });
    }
  }

  const namedTransforms: OcioNamedTransformDef[] = [];
  if (Array.isArray(root.named_transforms)) {
    for (const entry of root.named_transforms) {
      if (!isObj(entry)) continue;
      const name = str(entry.name);
      if (name) namedTransforms.push({ name, forward: node(entry.transform), inverse: node(entry.inverse_transform) });
    }
  }

  const searchRaw = root.search_path;
  const searchPath = Array.isArray(searchRaw) ? searchRaw.map((s) => str(s)) : str(searchRaw).split(/[:;]/).map((s) => s.trim()).filter(Boolean);

  return {
    version: { major, minor, text: versionText },
    name: str(root.name),
    description: str(root.description).trim(),
    searchPath,
    environment,
    roles,
    spaces,
    displays,
    activeDisplays: strList(root.active_displays),
    activeViews: strList(root.active_views),
    viewTransforms,
    looks,
    namedTransforms,
    inactiveColorSpaces: strList(root.inactive_colorspaces),
    defaultViewTransform: root.default_view_transform === undefined ? null : str(root.default_view_transform),
  };
}

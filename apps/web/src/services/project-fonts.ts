import { collectClipFonts, type Project } from "@openreel/core";
import { GOOGLE_FONT_SPECS } from "./font-catalog";

const initialFamilies = new Set(["Geist", "Geist Mono", "Inter"]);
const pendingStylesheets = new Map<string, Promise<void>>();
interface ProjectFont { family: string; weight: string; sample: string }

/** Google Fonts stylesheet URL for a catalog family, or null when it is not a catalog font. */
export function googleFontStylesheetUrl(family: string): string | null {
  const spec = GOOGLE_FONT_SPECS[family];
  if (!spec) return null;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(spec).replace(/%20/g, "+")}&display=swap`;
}

export function isBundledFontFamily(family: string): boolean {
  return initialFamilies.has(family);
}

function loadStylesheet(family: string): Promise<void> {
  const spec = GOOGLE_FONT_SPECS[family];
  if (!spec || initialFamilies.has(family) || window.openreel?.platform === "desktop") return Promise.resolve();
  const pending = pendingStylesheets.get(family);
  if (pending) return pending;
  // Bundled and uploaded faces already participate in CSS font matching.
  // Do not turn local rendering/export into a redundant network dependency.
  if (Array.from(document.fonts).some(face =>
    face.family.trim().replace(/^['"]|['"]$/g, "").toLowerCase() === family.toLowerCase(),
  )) return Promise.resolve();
  const promise = new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.openreelFont = family;
    link.href = googleFontStylesheetUrl(family) ?? "";
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      link.onload = null; link.onerror = null;
      if (error) { link.remove(); pendingStylesheets.delete(family); reject(error); }
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error(`Could not load ${family}. Check your connection or choose a system font.`)), 10_000);
    link.onload = () => finish();
    link.onerror = () => finish(new Error(`Could not load ${family}. Check your connection or choose a system font.`));
    document.head.appendChild(link);
  });
  pendingStylesheets.set(family, promise);
  return promise;
}

export async function ensureFontFamily(family: string, weight: string | number = 400, sample = "OpenReel"): Promise<void> {
  if (typeof document === "undefined" || !document.fonts || !family) return;
  await loadStylesheet(family);
  const fontWeight = typeof weight === "number" || /^\d+$/.test(weight) ? String(weight) : weight === "bold" ? "700" : "400";
  await document.fonts.load(`${fontWeight} 48px ${JSON.stringify(family)}`, sample || "OpenReel");
}

export function collectProjectFonts(project: Pick<Project, "textClips" | "timeline" | "motionCompositions">): ProjectFont[] {
  const fonts = new Map<string, { family: string; weight: string; characters: Set<string> }>();
  const add = (family: string | undefined, weight: string | number | undefined, text: string) => {
    if (!family) return;
    const normalizedWeight = String(weight ?? 400);
    const key = `${family}:${normalizedWeight}`;
    const entry = fonts.get(key) ?? { family, weight: normalizedWeight, characters: new Set<string>() };
    for (const character of text) entry.characters.add(character);
    fonts.set(key, entry);
  };
  for (const clip of project.textClips ?? []) {
    // Styled runs may use other families or weights than the clip style.
    if (clip.style && clip.runs?.length) for (const font of collectClipFonts(clip)) add(font.family, font.weight, font.sample);
    else add(clip.style?.fontFamily, clip.style?.fontWeight, clip.text);
  }
  for (const subtitle of project.timeline.subtitles ?? []) add(subtitle.style?.fontFamily, 700, subtitle.text);
  for (const composition of project.motionCompositions ?? []) {
    for (const layer of composition.layers) if (layer.type === "text") add(layer.style?.fontFamily, layer.style?.fontWeight, layer.text);
  }
  return [...fonts.values()].map(({ family, weight, characters }) => ({ family, weight, sample: [...characters].join("") }));
}

export async function ensureProjectFonts(project: Pick<Project, "textClips" | "timeline" | "motionCompositions">): Promise<void> {
  await Promise.all(collectProjectFonts(project).map((font) => ensureFontFamily(font.family, font.weight, font.sample)));
}

// ---------------------------------------------------------------------------
// Missing-font detection (project / template open)
// ---------------------------------------------------------------------------

type FontScanProject = Pick<Project, "textClips" | "timeline" | "motionCompositions">;

export interface MissingFont {
  readonly family: string;
  /** Human-readable places the font is used, e.g. `Text clip "Hello"`. */
  readonly usages: readonly string[];
  /** Font the renderer will substitute. */
  readonly fallback: string;
}

export interface FontAvailability {
  /** Bundled, on-demand catalog, or generic CSS family. */
  isBuiltIn(family: string): boolean;
  /** Registered with document.fonts (FontFace / @font-face / uploaded). */
  isLoaded(family: string): boolean;
  /** Installed on the system. */
  isInstalled(family: string): boolean;
}

export const FALLBACK_FONT_LABEL = "system default sans-serif";
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif",
  "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);

/** First family of a CSS font stack, unquoted. */
export function primaryFontFamily(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^['"]|['"]$/g, "").trim();
}

function trimLabel(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean;
}

/** Every font family the project references, with where it is used. */
export function collectFontUsages(project: FontScanProject): Map<string, string[]> {
  const usages = new Map<string, string[]>();
  const add = (stack: string | undefined, location: string) => {
    if (!stack) return;
    const family = primaryFontFamily(stack);
    if (!family) return;
    const list = usages.get(family) ?? [];
    if (!list.includes(location)) list.push(location);
    usages.set(family, list);
  };
  for (const clip of project.textClips ?? []) add(clip.style?.fontFamily, `Text clip "${trimLabel(clip.text)}"`);
  for (const subtitle of project.timeline.subtitles ?? []) add(subtitle.style?.fontFamily, `Caption "${trimLabel(subtitle.text)}"`);
  for (const composition of project.motionCompositions ?? []) {
    for (const layer of composition.layers) {
      if (layer.type === "text") add(layer.style?.fontFamily, `Motion layer "${layer.name}" in "${composition.name}"`);
    }
  }
  return usages;
}

/**
 * Pure detection: fonts used by the project that are neither built-in, loaded,
 * nor installed. Sorted by family name for stable display.
 */
export function findMissingProjectFonts(project: FontScanProject, availability: FontAvailability): MissingFont[] {
  const missing: MissingFont[] = [];
  for (const [family, usages] of collectFontUsages(project)) {
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;
    if (availability.isBuiltIn(family) || availability.isLoaded(family) || availability.isInstalled(family)) continue;
    missing.push({ family, usages, fallback: FALLBACK_FONT_LABEL });
  }
  return missing.sort((a, b) => a.family.localeCompare(b.family));
}

function normalizeFamily(family: string): string {
  return family.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
}

export interface WidthProbeContext {
  font: string;
  measureText(text: string): { readonly width: number };
}

export interface BrowserFontEnvironment {
  /** Desktop builds never fetch catalog stylesheets. */
  readonly isDesktop?: boolean;
  /** False when offline: catalog fonts cannot be fetched on demand. */
  readonly online?: boolean;
  /** Canvas context used for width probing (injectable for tests). */
  readonly measureContext?: WidthProbeContext | null;
  readonly fontFaces?: () => Array<{ family: string }>;
}

/**
 * Availability backed by the live browser/desktop environment. Catalog
 * (Google) fonts count as built-in only when they can actually be fetched on
 * demand (web and online); on desktop or offline they must be bundled
 * (initial families), registered with document.fonts, or installed.
 */
export function createBrowserFontAvailability(env: BrowserFontEnvironment = {}): FontAvailability {
  const isDesktop = env.isDesktop ?? (typeof window !== "undefined" && window.openreel?.platform === "desktop");
  const online = env.online ?? (typeof navigator === "undefined" || navigator.onLine !== false);
  const bundled = new Set([...initialFamilies].map(normalizeFamily));
  const catalog = new Set(Object.keys(GOOGLE_FONT_SPECS).map(normalizeFamily));
  const catalogFetchable = !isDesktop && online;
  let measure: WidthProbeContext | null | undefined = env.measureContext;
  const installedCache = new Map<string, boolean>();
  const widthOf = (font: string): number => {
    if (measure === undefined) measure = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (!measure) return Number.NaN;
    measure.font = font;
    return measure.measureText("mmmmmmmmmmlliWWW0123 OpenReel").width;
  };
  const faces = (): Array<{ family: string }> => {
    if (env.fontFaces) return env.fontFaces();
    if (typeof document === "undefined" || !document.fonts) return [];
    return Array.from(document.fonts);
  };
  return {
    isBuiltIn: (family) => {
      const key = normalizeFamily(family);
      return bundled.has(key) || (catalogFetchable && catalog.has(key));
    },
    isLoaded: (family) => {
      const wanted = normalizeFamily(family);
      return faces().some((face) => normalizeFamily(face.family) === wanted);
    },
    // document.fonts.check() reports true for unknown system families, so a
    // glyph-width probe against two different generic fallbacks is used: an
    // installed font renders the same width regardless of the fallback.
    isInstalled: (family) => {
      const key = normalizeFamily(family);
      const cached = installedCache.get(key);
      if (cached !== undefined) return cached;
      const quoted = JSON.stringify(family);
      const a = widthOf(`72px ${quoted}, monospace`);
      const b = widthOf(`72px ${quoted}, serif`);
      // Cannot tell: do not raise false alarms.
      const result = Number.isNaN(a) || Number.isNaN(b) ? true : a === b;
      installedCache.set(key, result);
      return result;
    },
  };
}

/** Message lines for a missing-font report, one per font. */
export function describeMissingFonts(missing: readonly MissingFont[]): string[] {
  return missing.map((font) => {
    const shown = font.usages.slice(0, 3).join(", ");
    const extra = font.usages.length > 3 ? ` and ${font.usages.length - 3} more` : "";
    return `${font.family}: used in ${shown}${extra}. Falls back to ${font.fallback}.`;
  });
}

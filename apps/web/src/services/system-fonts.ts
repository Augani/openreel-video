import { useEffect, useState } from "react";
import { registerEmbeddedFont } from "../components/editor/inspector/font-options";

/**
 * Installed (OS) font discovery through the Local Font Access API, plus an
 * on-demand Google Fonts downloader that stores any family as a custom font.
 */

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

const SYSTEM_FONTS_EVENT = "openreel:system-fonts-updated";
const ENABLED_KEY = "openreel-system-fonts-enabled";

let systemFonts: string[] = [];
let pending: Promise<string[]> | null = null;

function queryLocalFonts(): QueryLocalFonts | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  return typeof fn === "function" ? fn.bind(window) : null;
}

export function isSystemFontAccessSupported(): boolean {
  return queryLocalFonts() !== null;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Unique family names, sorted, from the raw font list (one entry per face). */
export function uniqueFamilies(fonts: readonly Pick<LocalFontData, "family">[]): string[] {
  return [...new Set(fonts.map((font) => font.family.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/**
 * List installed font families. The first call must come from a user gesture
 * on the web (permission prompt); later sessions reuse the granted permission.
 */
export function loadSystemFonts(): Promise<string[]> {
  const query = queryLocalFonts();
  if (!query) return Promise.reject(new Error("Your browser cannot list installed fonts. Use Chrome, Edge or the desktop app."));
  if (pending) return pending;
  pending = query()
    .then((fonts) => {
      systemFonts = uniqueFamilies(fonts);
      try {
        localStorage.setItem(ENABLED_KEY, "1");
      } catch {
        // listing still works for this session
      }
      window.dispatchEvent(new CustomEvent(SYSTEM_FONTS_EVENT));
      return systemFonts;
    })
    .catch((error: unknown) => {
      pending = null;
      throw error instanceof Error && error.name === "SecurityError"
        ? new Error("Permission to read installed fonts was denied.")
        : error;
    });
  return pending;
}

export function hideSystemFonts(): void {
  systemFonts = [];
  pending = null;
  try {
    localStorage.removeItem(ENABLED_KEY);
  } catch {
    // nothing persisted
  }
  window.dispatchEvent(new CustomEvent(SYSTEM_FONTS_EVENT));
}

export function useSystemFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>(systemFonts);
  useEffect(() => {
    const sync = () => setFonts(systemFonts);
    window.addEventListener(SYSTEM_FONTS_EVENT, sync);
    if (readEnabled() && !systemFonts.length) {
      // Permission already granted in an earlier session: list silently.
      void loadSystemFonts().catch(() => {});
    }
    return () => window.removeEventListener(SYSTEM_FONTS_EVENT, sync);
  }, []);
  return fonts;
}

// ---------------------------------------------------------------------------
// Google Fonts downloader
// ---------------------------------------------------------------------------

/** Title-case a typed family ("bebas neue" -> "Bebas Neue"), as Google Fonts expects. */
export function normalizeGoogleFamily(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Pick the latin (or last listed) font file URL out of a css2 stylesheet. */
export function pickFontUrl(css: string): string | null {
  const faces = [...css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)];
  if (!faces.length) return null;
  const target = faces.find((face) => face[1] === "latin") ?? faces[faces.length - 1];
  return /url\((['"]?)(https:\/\/[^)'"]+)\1\)/.exec(target[2])?.[2] ?? null;
}

/**
 * Download a Google Fonts family (regular weight) and register it as a custom
 * font, so it persists offline, renders on desktop and embeds in packages.
 */
export async function downloadGoogleFont(input: string, signal?: AbortSignal): Promise<string> {
  const family = normalizeGoogleFamily(input);
  if (!family) throw new Error("Type a Google Fonts family name.");
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
  const cssResponse = await fetch(cssUrl, { signal });
  if (cssResponse.status === 400) throw new Error(`"${family}" is not a Google Fonts family.`);
  if (!cssResponse.ok) throw new Error(`Google Fonts returned ${cssResponse.status}.`);
  const url = pickFontUrl(await cssResponse.text());
  if (!url) throw new Error(`No downloadable file found for "${family}".`);
  const fontResponse = await fetch(url, { signal });
  if (!fontResponse.ok) throw new Error(`Download failed (${fontResponse.status}).`);
  await registerEmbeddedFont(family, await fontResponse.arrayBuffer());
  return family;
}

import { useEffect, useState } from "react";
import i18n from "../../../i18n";

const CUSTOM_FONT_EVENT = "openreel:custom-fonts-updated";

const DB_NAME = "openreel-custom-fonts";
const DB_VERSION = 1;
const STORE_FONTS = "fonts";

interface StoredFontRecord {
  family: string;
  data: ArrayBuffer;
  uploadedAt: number;
}

const customFonts: string[] = [];

export const FONT_CATEGORIES: Record<string, readonly string[]> = {
  [i18n.t("fontCategory.popular")]: [
    "Inter",
    "Poppins",
    "Montserrat",
    "Roboto",
    "Open Sans",
    "Lato",
    "Outfit",
    "DM Sans",
  ],
  [i18n.t("fontCategory.displayHeadlines")]: [
    "Bebas Neue",
    "Anton",
    "Oswald",
    "Teko",
    "Staatliches",
    "Alfa Slab One",
    "Archivo Black",
    "Black Ops One",
    "Titan One",
    "Righteous",
    "Concert One",
    "Fredoka One",
    "Bungee",
  ],
  [i18n.t("fontCategory.elegantSerif")]: [
    "Playfair Display",
    "Cinzel",
    "Lora",
    "Merriweather",
    "DM Serif Display",
    "Abril Fatface",
    "Roboto Slab",
    "Zilla Slab",
  ],
  [i18n.t("fontCategory.modernClean")]: [
    "Lexend",
    "Quicksand",
    "Nunito",
    "Rubik",
    "Work Sans",
    "Raleway",
    "Ubuntu",
    "Space Grotesk",
    "Comfortaa",
  ],
  [i18n.t("fontCategory.handwrittenScript")]: [
    "Pacifico",
    "Lobster",
    "Dancing Script",
    "Great Vibes",
    "Caveat",
    "Sacramento",
    "Satisfy",
    "Yellowtail",
    "Rock Salt",
    "Permanent Marker",
  ],
  [i18n.t("fontCategory.funCreative")]: ["Bangers", "Creepster", "Press Start 2P"],
  [i18n.t("fontCategory.monospace")]: ["Roboto Mono", "Space Mono"],
  [i18n.t("fontCategory.system")]: ["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana"],
} as const;

const FONT_EXTENSIONS = /\.(ttf|otf|woff2?)$/i;
export const FONT_FILE_ACCEPT = ".ttf,.otf,.woff,.woff2";

function notifyCustomFontChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CUSTOM_FONT_EVENT));
  }
}

function toUniqueFontFamily(baseFamily: string) {
  const family = baseFamily.trim() || "Custom Font";
  let candidate = family;
  let suffix = 2;

  while (customFonts.includes(candidate)) {
    candidate = `${family} ${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function openFontsDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_FONTS)) {
        db.createObjectStore(STORE_FONTS, { keyPath: "family" });
      }
    };
  });
}

async function persistFont(family: string, data: ArrayBuffer): Promise<void> {
  const db = await openFontsDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_FONTS, "readwrite");
    const store = tx.objectStore(STORE_FONTS);
    const record: StoredFontRecord = { family, data, uploadedAt: Date.now() };
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

async function loadStoredFonts(): Promise<StoredFontRecord[]> {
  const db = await openFontsDB();
  if (!db) return [];
  const records = await new Promise<StoredFontRecord[]>((resolve) => {
    const tx = db.transaction(STORE_FONTS, "readonly");
    const store = tx.objectStore(STORE_FONTS);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as StoredFontRecord[]) ?? []);
    request.onerror = () => resolve([]);
  });
  db.close();
  return records;
}

export async function removeCustomFont(family: string): Promise<void> {
  const idx = customFonts.indexOf(family);
  if (idx >= 0) {
    customFonts.splice(idx, 1);
    notifyCustomFontChange();
  }
  const db = await openFontsDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_FONTS, "readwrite");
    tx.objectStore(STORE_FONTS).delete(family);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

let initPromise: Promise<void> | null = null;

export function initCustomFonts(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined") return;
    const stored = await loadStoredFonts();
    let changed = false;
    for (const { family, data } of stored) {
      if (customFonts.includes(family)) continue;
      try {
        const face = new FontFace(family, data);
        await face.load();
        document.fonts.add(face);
        customFonts.push(family);
        changed = true;
      } catch {
        // skip corrupt entries
      }
    }
    if (changed) notifyCustomFontChange();
  })();
  return initPromise;
}

export function getCustomFonts() {
  return [...customFonts];
}

export function useCustomFonts() {
  const [fonts, setFonts] = useState<string[]>(() => getCustomFonts());

  useEffect(() => {
    const sync = () => setFonts(getCustomFonts());
    window.addEventListener(CUSTOM_FONT_EVENT, sync);
    void initCustomFonts().then(sync);
    return () => window.removeEventListener(CUSTOM_FONT_EVENT, sync);
  }, []);

  return fonts;
}

export async function registerCustomFont(
  file: File,
): Promise<{ success: true; fontFamily: string } | { success: false; error: string }> {
  if (!FONT_EXTENSIONS.test(file.name)) {
    return { success: false, error: i18n.t("fontCategory.invalidFileType") };
  }

  if (typeof FontFace === "undefined" || typeof document === "undefined") {
    return { success: false, error: i18n.t("fontCategory.uploadNotSupported") };
  }

  try {
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const fontFamily = toUniqueFontFamily(baseName);
    const fontSource = await file.arrayBuffer();
    const fontFace = new FontFace(fontFamily, fontSource);
    await fontFace.load();
    document.fonts.add(fontFace);

    if (!customFonts.includes(fontFamily)) {
      customFonts.push(fontFamily);
      notifyCustomFontChange();
    }

    await persistFont(fontFamily, fontSource).catch(() => {
      // best-effort persistence; font is still usable this session
    });

    return { success: true, fontFamily };
  } catch {
    return { success: false, error: i18n.t("fontCategory.couldNotLoadFont") };
  }
}

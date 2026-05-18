import { useEffect, useState } from "react";

const CUSTOM_FONT_EVENT = "openreel:custom-fonts-updated";

const customFonts: string[] = [];

export const FONT_CATEGORIES = {
  Popular: [
    "Inter",
    "Poppins",
    "Montserrat",
    "Roboto",
    "Open Sans",
    "Lato",
    "Outfit",
    "DM Sans",
  ],
  "Display & Headlines": [
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
  "Elegant & Serif": [
    "Playfair Display",
    "Cinzel",
    "Lora",
    "Merriweather",
    "DM Serif Display",
    "Abril Fatface",
    "Roboto Slab",
    "Zilla Slab",
  ],
  "Modern & Clean": [
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
  "Handwritten & Script": [
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
  "Fun & Creative": ["Bangers", "Creepster", "Press Start 2P"],
  Monospace: ["Roboto Mono", "Space Mono"],
  System: ["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana"],
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

export function getCustomFonts() {
  return [...customFonts];
}

export function useCustomFonts() {
  const [fonts, setFonts] = useState<string[]>(() => getCustomFonts());

  useEffect(() => {
    const sync = () => setFonts(getCustomFonts());
    window.addEventListener(CUSTOM_FONT_EVENT, sync);
    return () => window.removeEventListener(CUSTOM_FONT_EVENT, sync);
  }, []);

  return fonts;
}

export async function registerCustomFont(file: File) {
  if (!FONT_EXTENSIONS.test(file.name)) {
    return { success: false, error: "Please upload a .ttf, .otf, .woff, or .woff2 font file." };
  }

  if (typeof FontFace === "undefined" || typeof document === "undefined") {
    return { success: false, error: "Custom font upload is not supported in this environment." };
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

    return { success: true, fontFamily };
  } catch {
    return { success: false, error: "Could not load this font file." };
  }
}

import { stickerLibrary, type StickerItem } from "@openreel/core";

/** Vector points for an n-point star, centred in a 128 box. */
function star(points: number, outer: number, inner: number): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    out.push(`${(64 + radius * Math.cos(angle)).toFixed(1)},${(64 + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return out.join(" ");
}

const WHITE = "#ffffff";
const YELLOW = "#f5d547";
const GREEN = "#34d399";
const RED = "#f43f5e";
const INK = "#111318";

interface BuiltInSticker {
  readonly id: string;
  readonly name: string;
  readonly category: "arrows" | "badges" | "banners" | "callouts";
  readonly tags: string[];
  readonly body: string;
}

const stroke = (color: string, width: number) =>
  `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;

/** Original vector stickers drawn for OpenReel: no text, so they render identically everywhere and export crisply at any size. */
export const BUILT_IN_STICKERS: readonly BuiltInSticker[] = [
  { id: "builtin-arrow-right", name: "Arrow", category: "arrows", tags: ["pointer", "next"], body: `<path d="M12 50h66V26l38 38-38 38V78H12z" fill="${WHITE}"/>` },
  { id: "builtin-arrow-curved", name: "Swoosh", category: "arrows", tags: ["pointer", "swoosh"], body: `<path d="M18 104C18 56 48 34 92 36" ${stroke(YELLOW, 14)}/><path d="M82 12l34 26-36 22z" fill="${YELLOW}"/>` },
  { id: "builtin-chevrons", name: "Chevrons", category: "arrows", tags: ["next", "skip"], body: `<path d="M22 24l40 40-40 40M66 24l40 40-40 40" ${stroke(GREEN, 16)}/>` },
  { id: "builtin-arrow-point", name: "Pointer", category: "arrows", tags: ["look here", "diagonal"], body: `<path d="M104 24L34 94M34 56v38h38" ${stroke(WHITE, 14)}/>` },
  { id: "builtin-starburst", name: "Starburst", category: "badges", tags: ["sale", "burst"], body: `<polygon points="${star(14, 58, 44)}" fill="${YELLOW}"/>` },
  { id: "builtin-check", name: "Check", category: "badges", tags: ["done", "verified"], body: `<circle cx="64" cy="64" r="54" fill="${GREEN}"/><path d="M38 66l18 18 34-38" ${stroke(INK, 14)}/>` },
  { id: "builtin-star", name: "Star", category: "badges", tags: ["favorite", "rating"], body: `<polygon points="${star(5, 58, 24)}" fill="${YELLOW}"/>` },
  { id: "builtin-heart", name: "Heart", category: "badges", tags: ["love", "like"], body: `<path d="M64 112C16 78 10 46 30 30c14-11 30-5 34 9 4-14 20-20 34-9 20 16 14 48-34 82z" fill="${RED}"/>` },
  { id: "builtin-spark", name: "Sparkle", category: "badges", tags: ["shine", "magic"], body: `<path d="M64 6C68 44 84 60 122 64 84 68 68 84 64 122 60 84 44 68 6 64 44 60 60 44 64 6z" fill="${WHITE}"/>` },
  { id: "builtin-ribbon", name: "Ribbon", category: "banners", tags: ["banner", "label"], body: `<path d="M4 34h120l-16 30 16 30H4l16-30z" fill="${RED}"/>` },
  { id: "builtin-tag", name: "Tag", category: "banners", tags: ["price", "label"], body: `<path d="M14 18h48l52 52-44 44L18 62z" fill="${YELLOW}"/><circle cx="40" cy="42" r="8" fill="${INK}"/>` },
  { id: "builtin-bubble", name: "Speech bubble", category: "callouts", tags: ["talk", "comment"], body: `<path d="M26 14h76a14 14 0 0 1 14 14v50a14 14 0 0 1-14 14H62l-28 22V92h-8a14 14 0 0 1-14-14V28a14 14 0 0 1 14-14z" fill="${WHITE}"/>` },
  { id: "builtin-thought", name: "Thought bubble", category: "callouts", tags: ["think", "idea"], body: `<ellipse cx="68" cy="46" rx="52" ry="34" fill="${WHITE}"/><circle cx="30" cy="94" r="10" fill="${WHITE}"/><circle cx="12" cy="114" r="6" fill="${WHITE}"/>` },
  { id: "builtin-exclaim", name: "Exclamation", category: "callouts", tags: ["alert", "attention"], body: `<circle cx="64" cy="64" r="54" fill="${YELLOW}"/><rect x="57" y="28" width="14" height="44" rx="7" fill="${INK}"/><circle cx="64" cy="92" r="8" fill="${INK}"/>` },
  { id: "builtin-question", name: "Question", category: "callouts", tags: ["help", "ask"], body: `<circle cx="64" cy="64" r="54" fill="${GREEN}"/><path d="M46 52c0-12 8-20 20-20s20 8 20 18c0 18-22 18-22 34" ${stroke(INK, 12)}/><circle cx="64" cy="98" r="8" fill="${INK}"/>` },
];

function toStickerItem(sticker: BuiltInSticker): StickerItem {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128">${sticker.body}</svg>`;
  return {
    id: sticker.id,
    name: sticker.name,
    category: sticker.category,
    tags: sticker.tags,
    imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
}

/** Idempotent: the pack is registered once per page and survives clearCustomStickers. */
export function registerBuiltInStickers(): void {
  for (const sticker of BUILT_IN_STICKERS) {
    if (!stickerLibrary.getSticker(sticker.id)) stickerLibrary.addSticker(toStickerItem(sticker));
  }
}

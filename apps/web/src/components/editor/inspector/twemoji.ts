/**
 * Bundled Twemoji artwork (CC-BY 4.0, see public/emoji/LICENSE.txt). The picker draws these SVGs and
 * placed emoji are rasterised from the same files, so the picker, the preview and the export match on
 * every operating system instead of following whichever emoji font the machine has.
 */

export function emojiCodepoints(emoji: string): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0) ?? 0)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join("-");
}

export function twemojiUrl(emoji: string): string {
  return `${import.meta.env.BASE_URL}emoji/${emojiCodepoints(emoji)}.svg`;
}

/** Rasterise the bundled artwork to a PNG data URL; resolves null when it cannot be drawn. */
export async function rasterizeTwemoji(emoji: string, size = 256): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = twemojiUrl(emoji);
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

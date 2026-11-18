/**
 * Stable digest of a template definition (FNV-1a over its canonical JSON). The committed thumbnails under
 * public/template-thumbs are rendered from the definitions; manifest.json records the digest each was rendered
 * from, and a unit test fails when a built-in template changes without its thumbnail being regenerated.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // Built-ins stamp createdAt / modifiedAt with Date.now() at load; they say nothing about the picture.
        .filter(([key]) => key !== "createdAt" && key !== "modifiedAt")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
};

export function templateDigest(template: unknown): string {
  const text = JSON.stringify(canonical(template));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

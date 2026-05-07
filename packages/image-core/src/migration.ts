
/** The current document format version. Increment when the schema changes. */
export const CURRENT_VERSION = 1;

/**
 * Apply all pending migrations to bring `raw` up to the current version.
 * Unknown versions are returned as-is so callers can fail validation instead.
 */
export function migrateProject(raw: Record<string, unknown>): Record<string, unknown> {
  let doc = { ...raw };
  const version = typeof doc.version === 'number' ? doc.version : 0;

  // Version 0 → 1: add explicit `version` field and `activeArtboardId` if missing.
  if (version < 1) {
    doc = migrateV0ToV1(doc);
  }

  // Future migrations go here, e.g.:
  // if (doc.version < 2) { doc = migrateV1ToV2(doc); }

  return doc;
}

function migrateV0ToV1(doc: Record<string, unknown>): Record<string, unknown> {
  const updated: Record<string, unknown> = { ...doc };

  updated.version = 1;

  // Ensure activeArtboardId exists.
  if (updated.activeArtboardId === undefined) {
    const artboards = Array.isArray(updated.artboards) ? updated.artboards : [];
    updated.activeArtboardId =
      artboards.length > 0 && typeof artboards[0] === 'object' && artboards[0] !== null
        ? (artboards[0] as Record<string, unknown>).id ?? null
        : null;
  }

  return updated;
}


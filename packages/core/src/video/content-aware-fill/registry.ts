import type { RemovalAnalysis } from "./types";

/**
 * Where the render path finds a clip's Remove Object analysis. Analyses are big, so the project file keeps only
 * their key; this registry holds the few in use in memory and asks the app's loader (IndexedDB) for the rest.
 */
const MEMORY_LIMIT = 4;
const memory = new Map<string, RemovalAnalysis>();
type Loader = (clipId: string, key: string) => Promise<RemovalAnalysis | null>;
let loader: Loader | null = null;

const idOf = (clipId: string, key: string): string => `${clipId}:${key}`;

export function registerRemovalAnalysis(clipId: string, analysis: RemovalAnalysis): void {
  const id = idOf(clipId, analysis.key);
  memory.delete(id);
  memory.set(id, analysis);
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
}

export function peekRemovalAnalysis(clipId: string, key: string): RemovalAnalysis | null {
  const own = memory.get(idOf(clipId, key));
  if (own) return own;
  // A duplicated or pasted clip keeps the settings (and so the key) of the clip it was copied from; the analysis is
  // of the footage, not of the clip id, so the original's is the copy's.
  for (const [id, analysis] of memory) if (analysis.key === key && id.endsWith(`:${key}`)) return analysis;
  return null;
}

export function setRemovalAnalysisLoader(next: Loader | null): void {
  loader = next;
}

/** Memory first, then the loader (which is remembered, so a frame sequence loads once). */
export async function getRemovalAnalysis(clipId: string, key: string): Promise<RemovalAnalysis | null> {
  const cached = peekRemovalAnalysis(clipId, key);
  if (cached) return cached;
  if (!loader) return null;
  const loaded = await loader(clipId, key).catch(() => null);
  if (loaded) registerRemovalAnalysis(clipId, loaded);
  return loaded;
}

export function clearRemovalAnalyses(): void {
  memory.clear();
}

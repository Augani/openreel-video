import type { SampleClip } from "./preview/VideoSource";

let cache: SampleClip[] | null = null;

export async function loadSampleClips(): Promise<SampleClip[]> {
  if (cache) return cache;
  const res = await fetch("/samples/index.json");
  if (!res.ok) throw new Error("Failed to load /samples/index.json");
  const json = (await res.json()) as { clips: SampleClip[] };
  cache = json.clips;
  return cache;
}

export function findSampleClip(clips: SampleClip[], id: string): SampleClip | undefined {
  return clips.find((c) => c.id === id);
}

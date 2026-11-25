/** The hidden worker windows of a parallel export are addressed by their URL hash (kept tiny: the entry chunk imports it). */
export type SegmentWorkerRole = "video" | "audio";

export const segmentWorkerHash = (sessionId: string, role: SegmentWorkerRole): string =>
  `#/export-segment-worker/${encodeURIComponent(sessionId)}/${role}`;

export function segmentWorkerFromHash(hash: string): { sessionId: string; role: SegmentWorkerRole } | null {
  const match = /^#\/export-segment-worker\/([^/]+)\/(video|audio)$/.exec(hash);
  return match ? { sessionId: decodeURIComponent(match[1]), role: match[2] as SegmentWorkerRole } : null;
}

import type { OrmaArtifact } from "./orma";
import type { MulticamReactionCue } from "./reaction-analysis";

interface MulticamSocialClipCandidate {
  startMs: number;
  endMs: number;
  score: number;
  reason: string;
  title?: string;
}

export function extractMulticamSocialClips(
  artifact: OrmaArtifact,
  options: {
    reactions?: readonly MulticamReactionCue[];
    count?: number;
    durationMs?: number;
    stepMs?: number;
  } = {},
): MulticamSocialClipCandidate[] {
  const durationMs = Math.max(10_000, options.durationMs ?? 45_000);
  const stepMs = Math.max(1_000, options.stepMs ?? 5_000);
  const projectDuration = artifact.durationMs;
  const candidates: MulticamSocialClipCandidate[] = [];
  for (let startMs = 0; startMs < projectDuration; startMs += stepMs) {
    const endMs = Math.min(projectDuration, startMs + durationMs);
    if (endMs - startMs < Math.min(10_000, projectDuration)) continue;
    const points = artifact.activity.points.filter(
      (point) => point.endTime * 1_000 > startMs && point.startTime * 1_000 < endMs,
    );
    const speaking = points.filter((point) => point.activeAngleIds.length > 0).length;
    const overlaps = points.filter((point) => point.activeAngleIds.length > 1).length;
    let switches = 0;
    let previous = "";
    for (const point of points) {
      const next = point.activeAngleIds.join("+");
      if (previous && next && next !== previous) switches++;
      if (next) previous = next;
    }
    const reactions = (options.reactions ?? artifact.reactions ?? []).filter(
      (cue) => cue.endMs > startMs && cue.startMs < endMs,
    );
    const transcriptSegments = Object.values(artifact.transcripts ?? {}).flat().filter(
      (segment) => segment.endMs > startMs && segment.startMs < endMs,
    );
    const words = transcriptSegments.reduce(
      (count, segment) => count + segment.text.trim().split(/\s+/).filter(Boolean).length,
      0,
    );
    const activityRatio = points.length ? speaking / points.length : 0;
    const score =
      activityRatio * 0.45 +
      Math.min(1, switches / 8) * 0.2 +
      Math.min(1, overlaps / Math.max(1, points.length) * 5) * 0.1 +
      Math.min(1, reactions.length / 3) * 0.2 +
      Math.min(1, words / 120) * 0.05;
    const title = transcriptSegments[0]?.text.trim().slice(0, 80);
    candidates.push({
      startMs,
      endMs,
      score: Math.round(score * 1_000) / 1_000,
      reason: `${switches} turns · ${reactions.length} reactions · ${words} words`,
      title: title || undefined,
    });
  }
  const selected: MulticamSocialClipCandidate[] = [];
  for (const candidate of candidates.sort(
    (left, right) => right.score - left.score || left.startMs - right.startMs,
  )) {
    if (selected.some((entry) =>
      candidate.startMs < entry.endMs && candidate.endMs > entry.startMs,
    )) continue;
    selected.push(candidate);
    if (selected.length >= (options.count ?? 3)) break;
  }
  return selected.sort((left, right) => left.startMs - right.startMs);
}

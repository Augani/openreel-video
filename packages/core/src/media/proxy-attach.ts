import {
  RELINK_FRAME_RATE_TOLERANCE,
  relinkNameKey,
  type RelinkCandidate,
  type RelinkMatch,
  type RelinkTarget,
} from "./desktop-ingest";

/**
 * Attach existing proxies (made by a camera, a DIT cart or another editor) by file name. A pattern says how a proxy's
 * name is built from its clip's name: `{name}_proxy`, `{name}-prx`, `proxy_{name}`, or `{name}` when proxies keep the
 * original name in another folder. Without a pattern the usual `_proxy` / `-prx` / `_lowres` suffixes (and this app's
 * own proxy names) are recognised. A candidate is only attached when its name AND duration AND frame rate fit; one
 * that has the right name but the wrong duration or frame rate is reported as a mismatch, never attached.
 * Pure: the main process finds the files and probes them.
 */

export interface CompiledProxyPattern {
  readonly template: string;
  /** Lower-case clip name a proxy file name stands for, or null when the file does not follow the pattern. */
  keyOf(fileName: string): string | null;
}

const stemOf = (fileName: string): string => {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim();
};

export const DEFAULT_PROXY_PATTERN_HINT = "{name}_proxy";

/** Compile a `{name}` template. Throws for a template with no `{name}` or more than one. */
export function compileProxyPattern(template: string): CompiledProxyPattern {
  const trimmed = template.trim();
  const parts = trimmed.split("{name}");
  if (parts.length !== 2) throw new Error("A proxy name pattern needs exactly one {name}, for example {name}_proxy.");
  const [prefix, suffix] = parts.map((part) => part.toLowerCase());
  if (/[\\/]/.test(trimmed)) throw new Error("A proxy name pattern is a file name, not a path.");
  return {
    template: trimmed,
    keyOf(fileName: string): string | null {
      const stem = stemOf(fileName).toLowerCase().replace(/\.preview$/, "");
      if (stem.length <= prefix.length + suffix.length) return null;
      if (!stem.startsWith(prefix) || !stem.endsWith(suffix)) return null;
      return stem.slice(prefix.length, stem.length - suffix.length).trim();
    },
  };
}

/** Name key of the original clip (its stem, lower case). */
export const clipNameKey = (name: string): string => stemOf(name).toLowerCase();

export interface ProxyMismatch {
  readonly mediaId: string;
  readonly candidate: RelinkCandidate;
  /** Why the file was not attached (duration, frame rate, unreadable). */
  readonly reasons: string[];
}

export interface ProxyAttachResult {
  readonly matches: RelinkMatch[];
  /** Right name, wrong duration / frame rate / unreadable: reported, never attached. */
  readonly mismatches: ProxyMismatch[];
  /** Two or more files fit one clip equally well, or one file fits two clips. */
  readonly ambiguous: Array<{ mediaId: string; candidates: RelinkCandidate[] }>;
  readonly unmatchedMediaIds: string[];
  readonly unusedCandidates: RelinkCandidate[];
}

/** Reasons a candidate with the right name does not fit the clip; empty = it fits. */
export function explainProxyMismatch(target: RelinkTarget, candidate: RelinkCandidate): string[] {
  const reasons: string[] = [];
  if (target.type === "image") return reasons;
  if (candidate.duration === undefined || !Number.isFinite(candidate.duration)) return ["The file could not be read, so its duration could not be checked."];
  const limit = Math.max(0.25, target.duration * 0.01);
  if (target.duration > 0 && Math.abs(candidate.duration - target.duration) > limit)
    reasons.push(`Duration ${candidate.duration.toFixed(2)}s does not match the original ${target.duration.toFixed(2)}s.`);
  if (target.type === "video" && target.frameRate > 0 && candidate.frameRate !== undefined && candidate.frameRate > 0 && Math.abs(candidate.frameRate - target.frameRate) > RELINK_FRAME_RATE_TOLERANCE)
    reasons.push(`Frame rate ${candidate.frameRate.toFixed(3)} fps does not match the original ${target.frameRate.toFixed(3)} fps.`);
  return reasons;
}

/** Pair proxy files with clips by name (and pattern), duration and frame rate, reporting every mismatch. */
export function matchProxiesByPattern(
  targets: readonly RelinkTarget[],
  candidates: readonly RelinkCandidate[],
  pattern?: CompiledProxyPattern | null,
): ProxyAttachResult {
  const keyOfCandidate = (name: string): string | null => (pattern ? pattern.keyOf(name) : relinkNameKey(name, true));
  const keyOfTarget = (name: string): string => (pattern ? clipNameKey(name) : relinkNameKey(name, true));
  const matches: RelinkMatch[] = [];
  const mismatches: ProxyMismatch[] = [];
  const ambiguous: ProxyAttachResult["ambiguous"] = [];
  const unmatchedMediaIds: string[] = [];
  const claimed = new Set<string>();
  const touched = new Set<string>();
  for (const target of targets) {
    const key = keyOfTarget(target.name);
    const named = candidates.filter((candidate) => keyOfCandidate(candidate.name) === key);
    if (!named.length) {
      unmatchedMediaIds.push(target.id);
      continue;
    }
    for (const candidate of named) touched.add(candidate.path);
    const verdicts = named.map((candidate) => ({ candidate, reasons: explainProxyMismatch(target, candidate) }));
    const fitting = verdicts.filter((entry) => entry.reasons.length === 0);
    if (!fitting.length) {
      for (const entry of verdicts) mismatches.push({ mediaId: target.id, candidate: entry.candidate, reasons: entry.reasons });
      continue;
    }
    const scored = fitting
      .map((entry) => ({ candidate: entry.candidate, score: target.type === "image" ? 0 : Math.abs((entry.candidate.duration ?? 0) - target.duration) }))
      .sort((a, b) => a.score - b.score);
    const tied = scored.filter((entry) => Math.abs(entry.score - scored[0].score) < 1e-6);
    if (tied.length > 1) {
      ambiguous.push({ mediaId: target.id, candidates: tied.map((entry) => entry.candidate) });
      continue;
    }
    const best = scored[0];
    if (claimed.has(best.candidate.path)) {
      ambiguous.push({ mediaId: target.id, candidates: [best.candidate] });
      continue;
    }
    claimed.add(best.candidate.path);
    matches.push({ mediaId: target.id, candidate: best.candidate, score: best.score });
  }
  return { matches, mismatches, ambiguous, unmatchedMediaIds, unusedCandidates: candidates.filter((candidate) => !claimed.has(candidate.path) && !touched.has(candidate.path)) };
}

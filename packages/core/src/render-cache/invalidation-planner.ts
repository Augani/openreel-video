import type { Project } from "../types/project";
import { buildPixelModel, type PixelModel } from "./pixel-entities";
import { normalizeRanges, rangesEqual, type TimeRange } from "./time-ranges";

export interface InvalidationPlan {
  /** True when every cached frame is suspect (canvas size, frame rate, global fill, project swap). */
  readonly all: boolean;
  /** Time ranges whose pixels may differ between the two projects. Empty when `all`. */
  readonly ranges: readonly TimeRange[];
}

export const NO_INVALIDATION: InvalidationPlan = { all: false, ranges: [] };
export const INVALIDATE_ALL: InvalidationPlan = { all: true, ranges: [] };

/**
 * Plan exactly which time ranges of a rendered cache stop being valid when the
 * project changes from `prev` to `next`. Pure and conservative: an entity
 * (clip, transition, text/graphic item, adjustment layer, ...) whose pixel
 * fingerprint or span changed contributes the union of its old and new span.
 * Audio-only edits, markers, names and unrelated clips contribute nothing.
 */
export function planInvalidation(prev: Project, next: Project): InvalidationPlan {
  if (prev === next) return NO_INVALIDATION;
  return diffPixelModels(buildPixelModel(prev), buildPixelModel(next));
}

/**
 * Diff two snapshots taken at the time of each change. Use this (not
 * planInvalidation) when the project is edited in place.
 */
export function diffPixelModels(before: PixelModel, after: PixelModel): InvalidationPlan {
  if (before.projectId !== after.projectId) return INVALIDATE_ALL;
  if (before.globalFingerprint !== after.globalFingerprint) return INVALIDATE_ALL;

  const dirty: TimeRange[] = [];
  const keys = new Set<string>([...before.entities.keys(), ...after.entities.keys()]);
  for (const key of keys) {
    const a = before.entities.get(key);
    const b = after.entities.get(key);
    if (a && b && a.fingerprint === b.fingerprint && rangesEqual(a.spans, b.spans)) continue;
    if (a) dirty.push(...a.spans);
    if (b) dirty.push(...b.spans);
  }
  return { all: false, ranges: normalizeRanges(dirty) };
}

export function isEmptyPlan(plan: InvalidationPlan): boolean {
  return !plan.all && plan.ranges.length === 0;
}

import type {
  MulticamEditDecision,
  MulticamEditDecisionList,
} from "./automatic-edit";

type MulticamCutReviewStatus = "pending" | "accepted";

interface MulticamReviewedDecision extends MulticamEditDecision {
  reviewId: string;
  status: MulticamCutReviewStatus;
}

interface MulticamCutReview {
  duration: number;
  segments: MulticamReviewedDecision[];
}

function normalize(segments: readonly MulticamReviewedDecision[]): MulticamReviewedDecision[] {
  const output: MulticamReviewedDecision[] = [];
  for (const segment of segments) {
    const previous = output[output.length - 1];
    if (previous && previous.angleId === segment.angleId) {
      previous.endTime = segment.endTime;
      previous.confidence = Math.max(previous.confidence, segment.confidence);
    } else {
      output.push({ ...segment });
    }
  }
  return output;
}

export function createMulticamCutReview(
  edit: MulticamEditDecisionList,
): MulticamCutReview {
  return {
    duration: edit.duration,
    segments: edit.segments.map((segment, index) => ({
      ...segment,
      reviewId: `cut-${Math.round(segment.startTime * 1_000)}-${index}`,
      status: index === 0 ? "accepted" : "pending",
    })),
  };
}

export function acceptMulticamCut(
  review: MulticamCutReview,
  reviewId: string,
): MulticamCutReview {
  return {
    ...review,
    segments: review.segments.map((segment) =>
      segment.reviewId === reviewId ? { ...segment, status: "accepted" } : segment,
    ),
  };
}

/** Rejecting a cut holds the previous angle through the rejected segment. */
export function rejectMulticamCut(
  review: MulticamCutReview,
  reviewId: string,
): MulticamCutReview {
  const index = review.segments.findIndex((segment) => segment.reviewId === reviewId);
  if (index <= 0) return review;
  const segments = review.segments.map((segment) => ({ ...segment }));
  const previous = segments[index - 1]!;
  const rejected = segments[index]!;
  previous.endTime = rejected.endTime;
  segments.splice(index, 1);
  return { ...review, segments: normalize(segments) };
}

/** Nudges a cut while preserving a minimum handle on both adjacent shots. */
export function nudgeMulticamCut(
  review: MulticamCutReview,
  reviewId: string,
  deltaMs: number,
  minimumShotMs = 100,
): MulticamCutReview {
  const index = review.segments.findIndex((segment) => segment.reviewId === reviewId);
  if (index <= 0 || !Number.isFinite(deltaMs)) return review;
  const segments = review.segments.map((segment) => ({ ...segment }));
  const previous = segments[index - 1]!;
  const current = segments[index]!;
  const minimum = Math.max(0, minimumShotMs) / 1_000;
  const boundary = Math.min(
    current.endTime - minimum,
    Math.max(previous.startTime + minimum, current.startTime + deltaMs / 1_000),
  );
  previous.endTime = boundary;
  current.startTime = boundary;
  current.status = "pending";
  return { ...review, segments };
}

export function reviewedMulticamEdit(
  review: MulticamCutReview,
): MulticamEditDecisionList {
  return {
    duration: review.duration,
    segments: review.segments.map(({ reviewId: _reviewId, status: _status, ...segment }) => segment),
  };
}

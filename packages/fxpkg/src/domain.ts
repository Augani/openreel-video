/**
 * Marketplace domain types + submission state machine (STUDIO_PLAN §33, §37).
 * Shared by the marketplace API (apps/cloud) and the studio app.
 */
import type { AbiVersion, AssetKind } from "./types";
import type { Manifest } from "./manifest";

/** Asset version review lifecycle (STUDIO_PLAN §37.1). */
export type ReviewState =
  | "submitted"
  | "validating"
  | "human_review"
  | "changes_requested"
  | "rejected"
  | "approved"
  | "published"
  | "deprecated"
  | "banned";

/** Submission state machine states (STUDIO_PLAN §37.1). */
export type SubmissionState =
  | "draft_editing"
  | "client_packaging"
  | "server_validating"
  | "creator_feedback"
  | "human_review"
  | "changes_requested"
  | "rejected"
  | "approved"
  | "published"
  | "deprecated"
  | "banned";

const SUBMISSION_TRANSITIONS: Record<SubmissionState, SubmissionState[]> = {
  draft_editing: ["client_packaging"],
  client_packaging: ["server_validating", "creator_feedback"],
  server_validating: ["human_review", "creator_feedback"],
  creator_feedback: ["draft_editing"],
  human_review: ["approved", "rejected", "changes_requested"],
  changes_requested: ["draft_editing"],
  rejected: ["draft_editing"],
  approved: ["published"],
  published: ["deprecated", "banned"],
  deprecated: ["published"],
  banned: [],
};

export function canTransition(from: SubmissionState, to: SubmissionState): boolean {
  return SUBMISSION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStates(from: SubmissionState): SubmissionState[] {
  return SUBMISSION_TRANSITIONS[from] ?? [];
}

export type Rail = "stripe" | "paystack" | "flutterwave" | "wise";

export interface Creator {
  userId: string;
  handle: string;
  bio?: string;
  avatarUri?: string;
  kycLevel: number;
  bannedAt?: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  creatorId: string;
  slug: string;
  kind: AssetKind;
  category?: string;
  currentVersion?: number;
  createdAt: string;
}

export interface AssetVersion {
  id: string;
  assetId: string;
  version: number;
  abi: AbiVersion;
  manifest: Manifest;
  fxpkgUri: string;
  reviewState: ReviewState;
  attestation?: unknown;
  submittedAt: string;
  approvedAt?: string;
}

export interface Draft {
  id: string;
  creatorId: string;
  assetId?: string;
  kind: AssetKind;
  title?: string;
  graph: unknown;
  manifestDraft: unknown;
  updatedAt: string;
  createdAt: string;
}

export interface Submission {
  id: string;
  draftId: string;
  assetVersionId?: string;
  creatorId: string;
  state: SubmissionState;
  fxpkgUri: string;
  validatorLog?: unknown;
  reviewerNotes?: string;
  reviewerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attribution {
  exportId: string;
  assetVersionId: string;
  share: number;
  isPrimary: boolean;
}

export interface EarningsEntry {
  id: string;
  creatorId: string;
  exportId: string;
  assetVersionId: string;
  grossCents: number;
  creatorCents: number;
  state: "pending" | "payable" | "paid" | "reversed";
  earnedAt: string;
  payableAt?: string;
  paidAt?: string;
  payoutId?: string;
}

export interface CreatorBalance {
  creatorId: string;
  pendingCents: number;
  payableCents: number;
  paidCents: number;
  currency: string;
}

export interface Payout {
  id: string;
  creatorId: string;
  amountCents: number;
  currency: string;
  rail: Rail;
  externalRef?: string;
  status: "pending" | "sent" | "failed";
  periodStart: string;
  periodEnd: string;
}

/** Marketplace event taxonomy (STUDIO_PLAN §41.1). Only EXPORT_COMPLETED pays. */
export type EventType = "ASSET_INSTALLED" | "ASSET_APPLIED" | "EXPORT_COMPLETED";

export const PAYABLE_EVENTS: EventType[] = ["EXPORT_COMPLETED"];

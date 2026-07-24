/**
 * Money: attribution, payable value, KYC tiers, anti-fraud, payout rails, and
 * event sealing (STUDIO_PLAN §41–§43). Pure logic + adapter interfaces; live
 * rail integrations (Stripe/Paystack/Wise) plug in behind PayoutRail.
 */
import type { AssetKind } from "./types";
import type { Attribution, EarningsEntry, EventType, Rail } from "./domain";
import { hmacSha256Hex, sha256Hex } from "./sha256";

export const PLATFORM_CUT = 0.3; // §41.4
export const MIN_EXPORT_MS = 5000; // §43.1
export const HOLDBACK_DAYS = 30; // §42.2
export const MIN_PAYOUT_CENTS = 2000; // $20 (§42.2)

export interface PayableSplit {
  grossCents: number;
  platformCents: number;
  creatorPoolCents: number;
}

/** Split gross export value into platform cut + creator pool (§41.4). */
export function payableValue(grossCents: number, platformCut = PLATFORM_CUT): PayableSplit {
  const platformCents = Math.round(grossCents * platformCut);
  return { grossCents, platformCents, creatorPoolCents: grossCents - platformCents };
}

export function creatorPayableCents(creatorPoolCents: number, share: number): number {
  return Math.round(creatorPoolCents * share);
}

export interface AppliedAsset {
  assetVersionId: string;
  kind: AssetKind;
  clipCount: number;
  totalDurationMs: number;
}

/**
 * Primary attribution (STUDIO_PLAN §41.3): exactly one asset gets 100% of the
 * payable share — template first, else heaviest effect, else heaviest filter.
 */
export function computeAttribution(exportId: string, applied: AppliedAsset[]): Attribution[] {
  if (applied.length === 0) return [];
  const weight = (a: AppliedAsset) => a.clipCount * a.totalDurationMs;

  const template = applied.find((a) => a.kind === "template");
  const heaviest = (kind: AssetKind) =>
    applied.filter((a) => a.kind === kind).sort((x, y) => weight(y) - weight(x))[0];

  const primary = template ?? heaviest("effect") ?? heaviest("filter") ?? applied[0];
  return [{ exportId, assetVersionId: primary.assetVersionId, share: 1, isPrimary: true }];
}

// ── KYC tiers (§42.3) ─────────────────────────────────────────────────────
export type KycLevel = 0 | 1 | 2;

/** Required KYC level for a creator's lifetime earnings (gates payout, not signup). */
export function requiredKycLevel(lifetimeCents: number): KycLevel {
  if (lifetimeCents > 100_000) return 2; // > $1000
  if (lifetimeCents >= 10_000) return 1; // $100–$1000
  return 0; // < $100, email verified only
}

export function payoutAllowed(lifetimeCents: number, kycLevel: number): boolean {
  return kycLevel >= requiredKycLevel(lifetimeCents);
}

// ── Anti-fraud (§43) ────────────────────────────────────────────────────────
export interface ExportEventInput {
  userId: string;
  assetId: string;
  day: string; // YYYY-MM-DD
  durationMs: number;
  containsUserMedia: boolean;
  contentHash: string;
}

export interface PayableCheck {
  payable: boolean;
  reasons: string[];
}

export function checkExportPayable(e: ExportEventInput): PayableCheck {
  const reasons: string[] = [];
  if (e.durationMs < MIN_EXPORT_MS) reasons.push(`export shorter than ${MIN_EXPORT_MS}ms`);
  if (!e.containsUserMedia) reasons.push("export contains no user media");
  return { payable: reasons.length === 0, reasons };
}

/** Dedup key: same export submitted N times shouldn't pay N times (§43.1). */
export function exportDedupeKey(e: ExportEventInput): string {
  return sha256Hex(`${e.userId}|${e.assetId}|${e.day}|${e.contentHash}`);
}

// ── Event sealing (§41.5) ──────────────────────────────────────────────────
export function sealEvent(payloadJson: string, nonce: string, secret: string): string {
  return hmacSha256Hex(secret, `${payloadJson}.${nonce}`);
}

export function verifyEvent(payloadJson: string, nonce: string, secret: string, signature: string): boolean {
  const expected = sealEvent(payloadJson, nonce, secret);
  if (expected.length !== signature.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ── Holdback + payout batch (§42.2) ─────────────────────────────────────────
export function payableAfter(earnedAtIso: string, holdbackDays = HOLDBACK_DAYS): string {
  const d = new Date(earnedAtIso);
  d.setUTCDate(d.getUTCDate() + holdbackDays);
  return d.toISOString();
}

export interface PayoutDraft {
  creatorId: string;
  amountCents: number;
  entryIds: string[];
}

/**
 * Monthly batch: sum payable ledger entries per creator past holdback, applying
 * the minimum threshold; below-threshold balances roll over (§42.2).
 */
export function computePayoutBatch(entries: EarningsEntry[], asOfIso: string): PayoutDraft[] {
  const asOf = new Date(asOfIso).getTime();
  const byCreator = new Map<string, { amount: number; ids: string[] }>();
  for (const entry of entries) {
    if (entry.state !== "payable") continue;
    if (entry.payableAt && new Date(entry.payableAt).getTime() > asOf) continue;
    const acc = byCreator.get(entry.creatorId) ?? { amount: 0, ids: [] };
    acc.amount += entry.creatorCents;
    acc.ids.push(entry.id);
    byCreator.set(entry.creatorId, acc);
  }
  const drafts: PayoutDraft[] = [];
  for (const [creatorId, acc] of byCreator) {
    if (acc.amount >= MIN_PAYOUT_CENTS) {
      drafts.push({ creatorId, amountCents: acc.amount, entryIds: acc.ids });
    }
  }
  return drafts;
}

// ── Payout rails (§42.1) ────────────────────────────────────────────────────
const STRIPE_COUNTRIES = new Set(["US", "GB", "CA", "AU", "IE", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK", "FI"]);
const PAYSTACK_COUNTRIES = new Set(["NG", "GH", "KE", "ZA"]);

export function selectRail(countryCode: string): Rail {
  const cc = countryCode.toUpperCase();
  if (STRIPE_COUNTRIES.has(cc)) return "stripe";
  if (PAYSTACK_COUNTRIES.has(cc)) return "paystack";
  return "wise";
}

export interface PayoutRequest {
  creatorId: string;
  amountCents: number;
  currency: string;
  externalAccountId: string;
}

export interface PayoutResult {
  ok: boolean;
  externalRef?: string;
  error?: string;
}

export interface PayoutRailAdapter {
  id: Rail;
  send(req: PayoutRequest): Promise<PayoutResult>;
}

/** No-op rail for local/dev and tests; live adapters implement the same interface. */
export function createSandboxRail(id: Rail): PayoutRailAdapter {
  return {
    id,
    async send(req) {
      if (req.amountCents < MIN_PAYOUT_CENTS) return { ok: false, error: "below_threshold" };
      return { ok: true, externalRef: `sandbox_${id}_${sha256Hex(`${req.creatorId}:${req.amountCents}`).slice(0, 12)}` };
    },
  };
}

export const PAYABLE_EVENT_SET: ReadonlySet<EventType> = new Set<EventType>(["EXPORT_COMPLETED"]);

import { describe, it, expect } from "vitest";
import {
  payableValue,
  creatorPayableCents,
  computeAttribution,
  requiredKycLevel,
  payoutAllowed,
  checkExportPayable,
  exportDedupeKey,
  sealEvent,
  verifyEvent,
  payableAfter,
  computePayoutBatch,
  selectRail,
  createSandboxRail,
  canTransition,
  nextStates,
  type AppliedAsset,
  type EarningsEntry,
} from "./index";

describe("payable value", () => {
  it("splits 30/70 conserving cents", () => {
    const s = payableValue(1000);
    expect(s.platformCents).toBe(300);
    expect(s.creatorPoolCents).toBe(700);
    expect(s.platformCents + s.creatorPoolCents).toBe(1000);
  });
  it("creator payable applies share", () => {
    expect(creatorPayableCents(700, 1)).toBe(700);
    expect(creatorPayableCents(700, 0.5)).toBe(350);
  });
});

describe("attribution (§41.3)", () => {
  const filter: AppliedAsset = { assetVersionId: "f", kind: "filter", clipCount: 3, totalDurationMs: 9000 };
  const effect: AppliedAsset = { assetVersionId: "e", kind: "effect", clipCount: 1, totalDurationMs: 2000 };
  const template: AppliedAsset = { assetVersionId: "t", kind: "template", clipCount: 1, totalDurationMs: 15000 };

  it("template wins when present", () => {
    const r = computeAttribution("x", [filter, effect, template]);
    expect(r).toEqual([{ exportId: "x", assetVersionId: "t", share: 1, isPrimary: true }]);
  });
  it("heaviest effect beats filter", () => {
    const r = computeAttribution("x", [filter, effect]);
    expect(r[0].assetVersionId).toBe("e");
  });
  it("filter when only filters", () => {
    const r = computeAttribution("x", [filter]);
    expect(r[0].assetVersionId).toBe("f");
  });
});

describe("KYC tiers (§42.3)", () => {
  it("levels by lifetime earnings", () => {
    expect(requiredKycLevel(5_000)).toBe(0);
    expect(requiredKycLevel(50_000)).toBe(1);
    expect(requiredKycLevel(200_000)).toBe(2);
  });
  it("gates payout by level", () => {
    expect(payoutAllowed(200_000, 1)).toBe(false);
    expect(payoutAllowed(200_000, 2)).toBe(true);
  });
});

describe("anti-fraud (§43)", () => {
  const base = { userId: "u", assetId: "a", day: "2026-05-01", durationMs: 8000, containsUserMedia: true, contentHash: "abc" };
  it("rejects short exports and missing media", () => {
    expect(checkExportPayable(base).payable).toBe(true);
    expect(checkExportPayable({ ...base, durationMs: 2000 }).payable).toBe(false);
    expect(checkExportPayable({ ...base, containsUserMedia: false }).payable).toBe(false);
  });
  it("dedupe key is stable + content-sensitive", () => {
    expect(exportDedupeKey(base)).toBe(exportDedupeKey(base));
    expect(exportDedupeKey(base)).not.toBe(exportDedupeKey({ ...base, contentHash: "different" }));
  });
});

describe("event sealing (§41.5)", () => {
  it("verifies a sealed event and rejects tampering", () => {
    const sig = sealEvent('{"e":"EXPORT_COMPLETED"}', "nonce1", "secret");
    expect(verifyEvent('{"e":"EXPORT_COMPLETED"}', "nonce1", "secret", sig)).toBe(true);
    expect(verifyEvent('{"e":"EXPORT_COMPLETED"}', "nonce2", "secret", sig)).toBe(false);
    expect(verifyEvent('{"e":"tampered"}', "nonce1", "secret", sig)).toBe(false);
  });
});

describe("holdback + payout batch (§42.2)", () => {
  it("payable date is +30d", () => {
    expect(payableAfter("2026-05-01T00:00:00.000Z")).toBe("2026-05-31T00:00:00.000Z");
  });
  it("batches past-holdback payable entries above threshold", () => {
    const entries: EarningsEntry[] = [
      { id: "1", creatorId: "c1", exportId: "e1", assetVersionId: "v1", grossCents: 5000, creatorCents: 2500, state: "payable", earnedAt: "2026-04-01", payableAt: "2026-05-01" },
      { id: "2", creatorId: "c1", exportId: "e2", assetVersionId: "v1", grossCents: 1000, creatorCents: 700, state: "payable", earnedAt: "2026-04-02", payableAt: "2026-05-02" },
      { id: "3", creatorId: "c2", exportId: "e3", assetVersionId: "v2", grossCents: 1000, creatorCents: 500, state: "payable", earnedAt: "2026-04-03", payableAt: "2026-05-03" },
      { id: "4", creatorId: "c3", exportId: "e4", assetVersionId: "v3", grossCents: 100, creatorCents: 50, state: "pending", earnedAt: "2026-04-04", payableAt: "2026-05-04" },
    ];
    const drafts = computePayoutBatch(entries, "2026-06-01T00:00:00.000Z");
    const c1 = drafts.find((d) => d.creatorId === "c1");
    expect(c1?.amountCents).toBe(3200);
    expect(drafts.find((d) => d.creatorId === "c2")).toBeUndefined(); // below $20
    expect(drafts.find((d) => d.creatorId === "c3")).toBeUndefined(); // pending
  });
});

describe("rails (§42.1)", () => {
  it("routes by country", () => {
    expect(selectRail("US")).toBe("stripe");
    expect(selectRail("NG")).toBe("paystack");
    expect(selectRail("BR")).toBe("wise");
  });
  it("sandbox rail pays above threshold", async () => {
    const rail = createSandboxRail("stripe");
    const ok = await rail.send({ creatorId: "c", amountCents: 5000, currency: "USD", externalAccountId: "acct" });
    expect(ok.ok).toBe(true);
    const low = await rail.send({ creatorId: "c", amountCents: 100, currency: "USD", externalAccountId: "acct" });
    expect(low.ok).toBe(false);
  });
});

describe("submission state machine (§37.1)", () => {
  it("allows valid transitions only", () => {
    expect(canTransition("human_review", "approved")).toBe(true);
    expect(canTransition("approved", "published")).toBe(true);
    expect(canTransition("draft_editing", "published")).toBe(false);
    expect(nextStates("human_review")).toContain("changes_requested");
  });
});

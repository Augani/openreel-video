import { describe, expect, it, vi } from "vitest";
import { MemoryGovernor, estimateDecoderBytes } from "@openreel/core";
import { DECODER_LIMIT_MESSAGE, DecoderRefusals, admitDecoder, decoderLimitActive, decoderLimitMessage, noticeAfterFailedProxy, precheckDecoder, requestProxyFallback, syncProxyOutcomes, type ProxyRequestLedger } from "./decoder-refusals";

const GB = 1024 ** 3;

describe("decoder refusals", () => {
  const each = estimateDecoderBytes(3840, 2160);

  it("refuses a second 4K original on 8 GB, skips re-probing, and retries after a decoder is released", () => {
    const gov = new MemoryGovernor({ systemMemoryBytes: 8 * GB, heapBytes: () => 200 * 1024 * 1024, measure: async () => null });
    const refusals = new DecoderRefusals();
    const release = gov.registerDecoder("playback:a", each);

    expect(precheckDecoder(refusals, gov, "orig")).toBe(true);
    expect(admitDecoder(refusals, gov, "orig", each)).toBe("refused");
    for (let i = 0; i < 5; i++) expect(precheckDecoder(refusals, gov, "orig")).toBe(false);
    expect(refusals.active(gov.epoch)).toEqual(["orig"]);

    release();
    expect(precheckDecoder(refusals, gov, "orig")).toBe(true);
    expect(refusals.active(gov.epoch)).toEqual([]);
    expect(admitDecoder(refusals, gov, "orig", each)).toBe("admit");
  });

  it("retries when the governor limit changes", () => {
    const gov = new MemoryGovernor({ systemMemoryBytes: 8 * GB, heapBytes: () => 0, measure: async () => null });
    const refusals = new DecoderRefusals();
    gov.registerDecoder("playback:a", each);
    admitDecoder(refusals, gov, "m", each);
    expect(precheckDecoder(refusals, gov, "m")).toBe(false);
    gov.setLimitBytes(16 * GB);
    expect(precheckDecoder(refusals, gov, "m")).toBe(true);
    expect(admitDecoder(refusals, gov, "m", each)).toBe("admit");
  });
});

describe("requestProxyFallback", () => {
  it("queues one proxy per refused original, never again, and reports it in the notice", () => {
    const requested: ProxyRequestLedger = new Map();
    const queue = vi.fn((ids: readonly string[]) => ({ queued: [...ids] }));
    const deps = { proxiesOn: () => true, queue };
    expect(requestProxyFallback(requested, "uhd", deps)).toBe("queued");
    for (let i = 0; i < 5; i++) expect(requestProxyFallback(requested, "uhd", deps)).toBe("already-requested");
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledWith(["uhd"]);
    expect(decoderLimitMessage("queued")).toMatch(/proxy is being built/);
  });

  it("does not queue with proxies off and tells the user to turn them on; unqueueable media keeps the plain notice", () => {
    const queue = vi.fn(() => ({ queued: [] as string[] }));
    const requested: ProxyRequestLedger = new Map();
    expect(requestProxyFallback(requested, "m", { proxiesOn: () => false, queue })).toBe("proxies-off");
    expect(queue).not.toHaveBeenCalled();
    expect(decoderLimitMessage("proxies-off")).toMatch(/Turn on proxies/);
    expect(requestProxyFallback(requested, "m", { proxiesOn: () => true, queue })).toBe("unavailable");
    expect(decoderLimitMessage("unavailable")).toBe(DECODER_LIMIT_MESSAGE);
  });
});

describe("decoderLimitActive", () => {
  it("is true while a refusal is current and clears once the governor epoch moves", () => {
    const refusals = new DecoderRefusals();
    const governor = { epoch: 3, canOpenDecoder: () => false };
    expect(admitDecoder(refusals, governor, "uhd-2", 1)).toBe("refused");
    expect(decoderLimitActive(refusals, governor)).toBe(true);
    governor.epoch = 4; // a decoder was released
    expect(decoderLimitActive(refusals, governor)).toBe(false);
  });

  it("says the layer is hidden, not that a previous frame is shown", () => {
    expect(DECODER_LIMIT_MESSAGE).toMatch(/hidden/);
    expect(DECODER_LIMIT_MESSAGE).not.toMatch(/previous frame/);
  });
});

describe("proxy outcomes", () => {
  it("a refusal never outlives a ready proxy, even when the governor epoch has not moved", () => {
    const refusals = new DecoderRefusals();
    const governor = { epoch: 7, canOpenDecoder: () => false };
    const ledger: ProxyRequestLedger = new Map();
    admitDecoder(refusals, governor, "uhd", 1);
    admitDecoder(refusals, governor, "other", 1);
    expect(precheckDecoder(refusals, governor, "uhd")).toBe(false);

    const out = syncProxyOutcomes(refusals, ledger, { uhd: { status: "ready", blob: {} }, other: { status: "encoding" } });
    expect(out.ready).toEqual(["uhd"]);
    expect(precheckDecoder(refusals, governor, "uhd")).toBe(true);
    expect(precheckDecoder(refusals, governor, "other")).toBe(false);
    expect(refusals.active(governor.epoch)).toEqual(["other"]);
  });

  it("records unavailable results so queue is not re-run on every retry", () => {
    const queue = vi.fn(() => ({ queued: [] as string[] }));
    const ledger: ProxyRequestLedger = new Map();
    const deps = { proxiesOn: () => true, queue };
    for (let i = 0; i < 5; i++) expect(requestProxyFallback(ledger, "offline", deps)).toBe("unavailable");
    expect(queue).toHaveBeenCalledTimes(1);
    // A later revision (relink, setting change) allows one more attempt.
    syncProxyOutcomes(new DecoderRefusals(), ledger, {}, { retryUnavailable: true });
    requestProxyFallback(ledger, "offline", deps);
    expect(queue).toHaveBeenCalledTimes(2);
  });

  it("a failed proxy job drops the queued notice and is not re-queued", () => {
    const queue = vi.fn((ids: readonly string[]) => ({ queued: [...ids] }));
    const ledger: ProxyRequestLedger = new Map();
    const refusals = new DecoderRefusals();
    const deps = { proxiesOn: () => true, queue };
    expect(requestProxyFallback(ledger, "m", deps)).toBe("queued");
    const out = syncProxyOutcomes(refusals, ledger, { m: { status: "error" } }, { retryUnavailable: true });
    expect(out.failed).toEqual(["m"]);
    const result = requestProxyFallback(ledger, "m", deps);
    expect(result).toBe("unavailable");
    expect(decoderLimitMessage(result)).toBe(DECODER_LIMIT_MESSAGE);
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it("refused -> queued -> ready -> refused again queues exactly once", () => {
    const queue = vi.fn((ids: readonly string[]) => ({ queued: [...ids] }));
    const ledger: ProxyRequestLedger = new Map();
    const refusals = new DecoderRefusals();
    const governor = { epoch: 1, canOpenDecoder: () => false };
    const deps = { proxiesOn: () => true, queue };
    admitDecoder(refusals, governor, "m", 1);
    expect(requestProxyFallback(ledger, "m", deps)).toBe("queued");
    const ready = { status: "ready" as const, enabled: true, blob: {} };
    expect(syncProxyOutcomes(refusals, ledger, { m: ready }).ready).toEqual(["m"]);
    expect(precheckDecoder(refusals, governor, "m")).toBe(true);
    // The proxy decode is refused too; failProxyPlayback turns the entry into a disabled error.
    admitDecoder(refusals, governor, "m", 1);
    syncProxyOutcomes(refusals, ledger, { m: { status: "error", enabled: false, blob: {} } });
    expect(requestProxyFallback(ledger, "m", deps)).toBe("unavailable");
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it("does not clear the refusal for a disabled proxy, with proxies off, or on later notifications", () => {
    const refusals = new DecoderRefusals();
    const governor = { epoch: 3, canOpenDecoder: () => false };
    const ledger: ProxyRequestLedger = new Map();
    admitDecoder(refusals, governor, "m", 1);
    const ready = { status: "ready" as const, enabled: true, blob: {} };
    syncProxyOutcomes(refusals, ledger, { m: { ...ready, enabled: false } });
    syncProxyOutcomes(refusals, ledger, { m: ready }, { proxiesOn: false });
    expect(precheckDecoder(refusals, governor, "m")).toBe(false);
    syncProxyOutcomes(refusals, ledger, { m: ready });
    expect(precheckDecoder(refusals, governor, "m")).toBe(true);
    admitDecoder(refusals, governor, "m", 1);
    syncProxyOutcomes(refusals, ledger, { m: ready }); // e.g. another job's progress tick
    expect(precheckDecoder(refusals, governor, "m")).toBe(false);
  });

  it("downgrades the queued notice when the proxy job fails", () => {
    expect(noticeAfterFailedProxy("queued")).toBe("unavailable");
    expect(noticeAfterFailedProxy("already-requested")).toBe("unavailable");
    expect(noticeAfterFailedProxy("proxies-off")).toBe("proxies-off");
    expect(noticeAfterFailedProxy(null)).toBeNull();
  });
});

/**
 * Remembers which media the memory governor refused a decoder for, so the render loop does not re-probe the
 * file (new Input, container parse, canDecode) on every frame. A refusal is retried only when the governor's
 * epoch has moved, i.e. a decoder was released or the limit changed.
 */
export class DecoderRefusals {
  private readonly refused = new Map<string, number>();

  /** True while this media was refused at the current epoch. */
  isRefused(mediaId: string, epoch: number): boolean {
    const at = this.refused.get(mediaId);
    if (at === undefined) return false;
    if (at === epoch) return true;
    this.refused.delete(mediaId);
    return false;
  }

  refuse(mediaId: string, epoch: number): void {
    this.refused.set(mediaId, epoch);
  }

  clear(mediaId?: string): void {
    if (mediaId === undefined) this.refused.clear();
    else this.refused.delete(mediaId);
  }

  /** Media ids still refused at this epoch. */
  active(epoch: number): string[] {
    return [...this.refused].filter(([, at]) => at === epoch).map(([id]) => id);
  }
}

export interface DecoderAdmission {
  canOpenDecoder(bytes: number): boolean;
  readonly epoch: number;
}

export type AdmissionResult = "admit" | "refused";

/** Pre-probe gate: false when the media was already refused at this epoch (no probing needed). */
export function precheckDecoder(refusals: DecoderRefusals, governor: DecoderAdmission, mediaId: string): boolean {
  return !refusals.isRefused(mediaId, governor.epoch);
}

/** After probing: records a refusal, or clears a stale one on admission. */
export function admitDecoder(
  refusals: DecoderRefusals,
  governor: DecoderAdmission,
  mediaId: string,
  decoderBytes: number,
): AdmissionResult {
  if (governor.canOpenDecoder(decoderBytes)) {
    refusals.clear(mediaId);
    return "admit";
  }
  refusals.refuse(mediaId, governor.epoch);
  return "refused";
}

export const DECODER_LIMIT_MESSAGE =
  "Decoder limit reached: a large source layer is hidden to stay within memory. Enable proxies or turn off another layer to show it.";

export const DECODER_PROXY_QUEUED_MESSAGE =
  "Decoder limit reached: a large source layer is hidden to stay within memory. A proxy is being built so it can show; or turn off another layer.";

export const DECODER_PROXIES_OFF_MESSAGE =
  "Decoder limit reached: a large source layer is hidden to stay within memory. Turn on proxies to show it, or turn off another layer.";

export type ProxyFallbackResult = "queued" | "proxies-off" | "unavailable" | "already-requested";

export interface ProxyFallbackDeps {
  proxiesOn(): boolean;
  queue(mediaIds: readonly string[]): { queued: readonly string[] };
}

/** What is already known about a media's proxy request; outlives governor epochs. */
export type ProxyRequestState = "queued" | "unavailable" | "failed" | "built";
export type ProxyRequestLedger = Map<string, ProxyRequestState>;

/**
 * An original that the memory governor refused has no cheaper source until a proxy exists: ask for one,
 * once per media (the ledger outlives epochs so a refused-then-retried layer does not re-queue every time,
 * and an unqueueable or failed one does not re-run queueProxies/writeJobs on every retry).
 * With proxies switched off a built proxy would never be used, so nothing is queued and the caller says so.
 */
export function requestProxyFallback(ledger: ProxyRequestLedger, mediaId: string, deps: ProxyFallbackDeps): ProxyFallbackResult {
  const known = ledger.get(mediaId);
  if (known === "queued") return "already-requested";
  // "built": a proxy already came up once; if it is refused too, re-encoding it would loop forever.
  if (known === "unavailable" || known === "failed" || known === "built") return "unavailable";
  if (!deps.proxiesOn()) return "proxies-off";
  const result = deps.queue([mediaId]);
  if (!result.queued.includes(mediaId)) {
    ledger.set(mediaId, "unavailable");
    return "unavailable";
  }
  ledger.set(mediaId, "queued");
  return "queued";
}

export interface ProxyOutcomeEntry {
  status: "queued" | "encoding" | "ready" | "error";
  enabled?: boolean;
  blob?: unknown;
}

export interface ProxyOutcomeSync {
  /** A queued proxy job ended in error: the "proxy is being built" notice must go. */
  failed: string[];
  /** A proxy became ready: its refusal was cleared explicitly. */
  ready: string[];
}

/**
 * Reconciles refusals and the request ledger with proxy job outcomes. A ready proxy clears the media's
 * refusal at once (never waiting for the governor epoch to move); a failed job is remembered as "failed" so
 * it is not re-queued and the notice stops promising a proxy. With retryUnavailable, "unavailable" records
 * are dropped so a relink or a changed setting can be retried once.
 */
export function syncProxyOutcomes(
  refusals: DecoderRefusals,
  ledger: ProxyRequestLedger,
  entries: Readonly<Record<string, ProxyOutcomeEntry | undefined>>,
  options: { retryUnavailable?: boolean; proxiesOn?: boolean } = {},
): ProxyOutcomeSync {
  const out: ProxyOutcomeSync = { failed: [], ready: [] };
  const proxiesOn = options.proxiesOn ?? true;
  for (const [id, entry] of Object.entries(entries)) {
    if (!entry) continue;
    const usable = entry.status === "ready" && entry.enabled !== false && entry.blob !== undefined && entry.blob !== null && proxiesOn;
    if (usable) {
      // Only the transition to a usable proxy clears the refusal; "built" is kept so a proxy that is
      // itself refused is never re-encoded.
      if (ledger.get(id) !== "built") {
        refusals.clear(id);
        ledger.set(id, "built");
        out.ready.push(id);
      }
    } else if (ledger.get(id) === "built" && entry.status !== "error") {
      // Re-encoding, disabled or proxies off: the next usable transition clears the refusal again.
      ledger.delete(id);
    } else if (entry.status === "error" && ledger.get(id) === "queued") {
      ledger.set(id, "failed");
      out.failed.push(id);
    }
  }
  if (options.retryUnavailable) {
    for (const [id, state] of [...ledger]) if (state === "unavailable") ledger.delete(id);
  }
  // The proxy entry is gone (removed / source changed): forget that it was built.
  for (const [id, state] of [...ledger]) if (state === "built" && !entries[id]) ledger.delete(id);
  return out;
}

/** Notice state after a proxy job failed: it no longer promises a proxy. */
export function noticeAfterFailedProxy(current: ProxyFallbackResult | null): ProxyFallbackResult | null {
  return current === "queued" || current === "already-requested" ? "unavailable" : current;
}

export function decoderLimitMessage(result: ProxyFallbackResult | null): string {
  if (result === "queued" || result === "already-requested") return DECODER_PROXY_QUEUED_MESSAGE;
  if (result === "proxies-off") return DECODER_PROXIES_OFF_MESSAGE;
  return DECODER_LIMIT_MESSAGE;
}

/** Whether any refusal is still current: once a decoder is released or the limit moves, the notice clears. */
export function decoderLimitActive(refusals: DecoderRefusals, governor: Pick<DecoderAdmission, "epoch">): boolean {
  return refusals.active(governor.epoch).length > 0;
}

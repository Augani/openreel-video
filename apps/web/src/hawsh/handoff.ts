/** One-time sign-in handoff from the Hawsh site: `#hk=<token_hash>&pk=<publishable key>`. */
export interface HawshHandoff {
  tokenHash: string;
  publishableKey: string;
}

/** Reads the handoff from a location hash. Anything else (editor routes like `#/editor`) ⇒ null. */
export function parseHandoff(hash: string): HawshHandoff | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.startsWith("/")) return null;
  const q = new URLSearchParams(raw);
  const tokenHash = q.get("hk")?.trim() ?? "";
  const publishableKey = q.get("pk")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(tokenHash) || !/^[A-Za-z0-9._-]{20,512}$/.test(publishableKey)) return null;
  return { tokenHash, publishableKey };
}

/**
 * Takes the handoff out of the address bar before the app renders, so the one-time code never stays in
 * history, bookmarks or a shared link. Returns it for the session bootstrap.
 */
export function takeHandoff(): HawshHandoff | null {
  if (typeof window === "undefined") return null;
  const handoff = parseHandoff(window.location.hash);
  if (handoff) {
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      window.location.hash = "";
    }
  }
  return handoff;
}

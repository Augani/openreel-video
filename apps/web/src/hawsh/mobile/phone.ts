/**
 * Phone editor (Hawsh Khalifa build, plan mds/plans/2026-10-23-editor-mobile-ui.md): phones only
 * (owner: tablets keep the current layout). While the stages are being built it is opt-in:
 * open the editor with `?m=1` once (remembered in this browser), `?m=0` turns it off.
 */
import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 600px)";
const FLAG_KEY = "hawsh-mobile-ui";

/** Reads `?m=1` / `?m=0` from the address and remembers it. */
export function mobileUiEnabled(search: string = typeof location !== "undefined" ? location.search : ""): boolean {
  try {
    const m = new URLSearchParams(search).get("m");
    if (m === "1") localStorage.setItem(FLAG_KEY, "1");
    if (m === "0") localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True on a phone-width screen with the phone editor turned on. */
export function usePhoneEditor(): boolean {
  const phone = useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  return phone && mobileUiEnabled();
}

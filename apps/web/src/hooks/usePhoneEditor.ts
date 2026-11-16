import { useSyncExternalStore } from "react";

const PHONE_QUERY = "(max-width: 600px) and (hover: none) and (pointer: coarse)";
const subscribe = (change: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

export function usePhoneEditor(): boolean {
  return useSyncExternalStore(subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false);
}

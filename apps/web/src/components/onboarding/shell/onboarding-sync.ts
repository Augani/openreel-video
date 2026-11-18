import { useOnboardingStore, toOnboardingMirror, type OnboardingState } from "../../../stores/onboarding-store";

type Snapshot = Pick<OnboardingState, "status" | "skippedBy" | "persona" | "path" | "completedAt">;

function snapshotKey(s: Snapshot): string {
  return [s.status, s.skippedBy, s.persona, s.path, s.completedAt].join("|");
}

function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const h = window.requestIdleCallback(cb, { timeout: 2000 });
    return () => window.cancelIdleCallback(h);
  }
  const h = window.setTimeout(cb, 300);
  return () => window.clearTimeout(h);
}

/**
 * Keeps the main-process mirror (userData/onboarding.json) in step with the store, so a cleared
 * renderer profile does not re-onboard a returning user. The mirror is read once at idle after first
 * paint (not layout-critical). Automation skips are never written (main refuses them too).
 */
export function installOnboardingSync(): () => void {
  const bridge = typeof window !== "undefined" ? window.openreel?.onboarding : undefined;
  if (!bridge) return () => undefined;

  let last = snapshotKey(useOnboardingStore.getState());
  const cancelIdle = whenIdle(() => {
    bridge
      .get()
      .then((mirror) => {
        const store = useOnboardingStore.getState();
        store.applyMirror(mirror);
        // A status derived from legacy flags never changes afterwards, so the subscription below would
        // never write it. Seed the mirror once when there is none (a cleared profile must not re-onboard).
        const after = useOnboardingStore.getState();
        if (!mirror && after.status !== "unseen" && after.skippedBy !== "automation") {
          last = snapshotKey(after);
          return bridge.set(toOnboardingMirror(after));
        }
        return undefined;
      })
      .catch(() => undefined);
  });

  const unsubscribe = useOnboardingStore.subscribe((state) => {
    const key = snapshotKey(state);
    if (key === last) return;
    last = key;
    if (state.skippedBy === "automation") return;
    void bridge.set(toOnboardingMirror(state)).catch(() => undefined);
  });
  return () => {
    cancelIdle();
    unsubscribe();
  };
}

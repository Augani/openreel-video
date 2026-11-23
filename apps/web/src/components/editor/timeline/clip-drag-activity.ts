/**
 * Whether a timeline clip drag is in progress, for panels that can wait for the gesture to finish.
 *
 * Selecting the dragged clip mounts the inspector for it (a ~25 ms commit plus a forced style recalc at 400 clips), which
 * used to land in the frame right after the drag started. The inspector reads this and keeps showing the previous
 * selection until the drop has settled. It is a plain module value, not store state, so starting a drag renders nobody.
 */
const SETTLE_MS = 160;

let active = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

/** A clip drag started: the panels that defer to it hold their current content. */
export function beginClipDragActivity(): void {
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (active) return;
  active = true;
  emit();
}

/** A clip drag ended (dropped or cancelled); the panels catch up once the drop's own frames have passed. */
export function endClipDragActivity(): void {
  if (!active || settleTimer !== null) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    active = false;
    emit();
  }, SETTLE_MS);
}

export const isClipDragActive = (): boolean => active;

export function subscribeClipDragActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

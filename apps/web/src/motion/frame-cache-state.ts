import type { CachedRange } from "./frame-cache";

export interface FrameCacheState {
  readonly ranges: ReadonlyArray<CachedRange>;
  readonly filling: boolean;
  readonly enabled: boolean;
}

const DEFAULT_STATE: FrameCacheState = {
  ranges: [],
  filling: false,
  enabled: true,
};

type Listener = () => void;

let currentState: FrameCacheState = DEFAULT_STATE;
const listeners = new Set<Listener>();

export function getFrameCacheState(): FrameCacheState {
  return currentState;
}

export function setFrameCacheState(patch: Partial<FrameCacheState>): void {
  const next: FrameCacheState = {
    ranges: patch.ranges ?? currentState.ranges,
    filling: patch.filling ?? currentState.filling,
    enabled: patch.enabled ?? currentState.enabled,
  };
  if (
    next.ranges === currentState.ranges &&
    next.filling === currentState.filling &&
    next.enabled === currentState.enabled
  ) {
    return;
  }
  currentState = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeFrameCacheState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetFrameCacheState(): void {
  currentState = DEFAULT_STATE;
  for (const listener of listeners) {
    listener();
  }
}

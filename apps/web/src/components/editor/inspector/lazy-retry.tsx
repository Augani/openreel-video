import React from "react";

/**
 * `React.lazy` with a retry. A rejected dynamic import is cached forever by `React.lazy` (and by a memoised
 * loader promise), so one failed chunk fetch (offline blip, a deploy replacing the hashed file) used to leave the
 * panel broken until the editor was reloaded. Here a failed load clears the cached promise and swaps in a fresh
 * lazy component, so the next mount of the panel (the next time the user opens it) fetches the chunk again, and an
 * error boundary turns the failure into an inline Retry instead of an unmounted inspector.
 */
export interface RetryableLazy<P extends object> {
  /** The panel: an error boundary around the current lazy component. Wrap it in a `Suspense` where it is used. */
  Component: React.FC<P>;
  /** Fetch the chunk (shared across callers); a failure clears the cache so the next call tries again. */
  load: () => Promise<React.ComponentType<P>>;
  /** The component once its chunk has loaded, else null. */
  loaded: () => React.ComponentType<P> | null;
}

interface BoundaryProps {
  label: string;
  onRetry: () => void;
  /** The failure has been shown (the boundary committed its error UI): later mounts may fetch the chunk again. */
  onFailed: () => void;
  children: React.ReactNode;
}
interface BoundaryState {
  failed: boolean;
}

class LoadBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onFailed();
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex items-center gap-2 p-3 text-[12px] text-text-secondary">
        <span>{this.props.label} could not load.</span>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 text-text-primary hover:bg-background-tertiary"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry();
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}

export function retryableLazy<P extends object>(
  importer: () => Promise<{ default: React.ComponentType<P> }>,
  label = "This panel",
): RetryableLazy<P> {
  let promise: Promise<React.ComponentType<P>> | null = null;
  let loaded: React.ComponentType<P> | null = null;
  const makeLazy = () =>
    React.lazy(() => load().then((component) => ({ default: component })));
  let Lazy = makeLazy();
  let failed = false;
  /** Swap in a fresh lazy component after a failure has been surfaced, so the next mount (or Retry) fetches again. */
  const refresh = (): void => {
    if (!failed) return;
    failed = false;
    Lazy = makeLazy();
  };

  function load(): Promise<React.ComponentType<P>> {
    promise ??= importer().then(
      (module) => {
        loaded = module.default;
        return module.default;
      },
      (error: unknown) => {
        // Forget the failed attempt. React.lazy caches the rejection in the current `Lazy`, which must stay in place
        // until a boundary has shown the error (see `refresh`): swapping it earlier would silently refetch in a loop.
        promise = null;
        failed = true;
        throw error;
      },
    );
    return promise;
  }

  const Component: React.FC<P> = (props) => {
    // One lazy instance per mount (and per Retry): re-reading the module-level `Lazy` on every render would retry
    // a persistently failing chunk in a loop as soon as React re-renders the suspended tree.
    const [attempt, setAttempt] = React.useState(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const Current = React.useMemo(() => Lazy as React.ComponentType<P>, [attempt]);
    return (
      <LoadBoundary label={label} onRetry={() => setAttempt((n) => n + 1)} onFailed={refresh}>
        {React.createElement(Current, props)}
      </LoadBoundary>
    );
  };
  return { Component, load, loaded: () => loaded };
}

/** Drop-in for `React.lazy(() => import(...))` whose chunk is fetched again after a failure. Keep the caller's Suspense. */
export function lazyWithRetry<T extends React.ComponentType<never>>(
  importer: () => Promise<{ default: T }>,
  label?: string,
): T {
  return retryableLazy(importer as unknown as () => Promise<{ default: React.ComponentType<object> }>, label).Component as unknown as T;
}

import { LiveEditorHost } from "./live-host";

let hostSingleton: LiveEditorHost | null = null;

/**
 * One shared LiveEditorHost for every in-renderer agent entry point (the BYOK
 * chat panel and the desktop MCP bridge) so their edits land in a single,
 * consistent undo history rather than fighting over transaction bookkeeping.
 */
export function getLiveEditorHost(): LiveEditorHost {
  return (hostSingleton ??= new LiveEditorHost());
}

let hostLock: Promise<unknown> = Promise.resolve();

/**
 * Serializes access to the shared host so a chat turn and an external MCP tool
 * call never interleave their undo transactions on the same project-store.
 */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = hostLock.then(fn, fn);
  hostLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

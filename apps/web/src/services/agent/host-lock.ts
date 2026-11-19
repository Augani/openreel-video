let hostLock: Promise<unknown> = Promise.resolve();

/**
 * Serializes access to the shared host so a chat turn and an external MCP tool
 * call never interleave their undo transactions on the same project-store.
 *
 * Lives apart from host-singleton so importing the lock does not import LiveEditorHost
 * (and with it the whole agent tool registry).
 */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = hostLock.then(fn, fn);
  hostLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

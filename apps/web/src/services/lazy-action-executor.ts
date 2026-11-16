import type { ActionExecutor, ActionHistory } from "@openreel/core";
import type { ActionResult } from "@openreel/core";
import { getLoadedEngineModules } from "./lazy-engines";
import { readOnlyReason } from "./project-lock";

/** Every edit, undo and redo goes through the executor, so this one check keeps a read-only project untouched. */
function readOnlyResult(): ActionResult | null {
  const reason = readOnlyReason();
  return reason ? { success: false, error: { code: "READ_ONLY", message: reason, suggestion: "Close the project in the other window, or use Save As to work on a copy." } } : null;
}

/** The slice of ActionExecutor the web stores use. */
export type ActionExecutorLike = Pick<
  ActionExecutor,
  "execute" | "executeMany" | "undo" | "redo" | "getHistory"
>;

/**
 * ActionExecutor facade that keeps the action handlers (and the engines they
 * reference) out of the startup chunk. The history is created eagerly and
 * shared, so `getHistory()` stays synchronous. The real executor is created
 * synchronously once the engine modules are resolved (the steady state: the
 * editor loads them), so `execute` still reads the open undo group in the
 * caller's tick. Before that (a cold start) the first call awaits the
 * memoised import.
 */
export class LazyActionExecutor implements ActionExecutorLike {
  private ready: ActionExecutor | null = null;
  private pending: Promise<ActionExecutor> | null = null;

  constructor(private readonly history: ActionHistory) {}

  private syncExecutor(): ActionExecutor | null {
    if (this.ready) return this.ready;
    const engines = getLoadedEngineModules();
    if (!engines) return null;
    this.ready = new engines.ActionExecutor(this.history);
    return this.ready;
  }

  private load(): Promise<ActionExecutor> {
    if (!this.pending) {
      const pending = import("./engine-modules").then(({ ActionExecutor: Executor }) => {
        this.ready ??= new Executor(this.history);
        return this.ready;
      });
      pending.catch(() => {
        if (this.pending === pending) this.pending = null;
      });
      this.pending = pending;
    }
    return this.pending;
  }

  execute: ActionExecutor["execute"] = (action, project) => {
    const blocked = readOnlyResult();
    if (blocked) return Promise.resolve(blocked);
    const executor = this.syncExecutor();
    return executor ? executor.execute(action, project) : this.load().then((e) => e.execute(action, project));
  };

  executeMany: ActionExecutor["executeMany"] = (actions, project) => {
    const blocked = readOnlyResult();
    if (blocked) return Promise.resolve([blocked]);
    const executor = this.syncExecutor();
    return executor ? executor.executeMany(actions, project) : this.load().then((e) => e.executeMany(actions, project));
  };

  undo: ActionExecutor["undo"] = (project) => {
    const blocked = readOnlyResult();
    if (blocked) return Promise.resolve(blocked);
    const executor = this.syncExecutor();
    return executor ? executor.undo(project) : this.load().then((e) => e.undo(project));
  };

  redo: ActionExecutor["redo"] = (project) => {
    const blocked = readOnlyResult();
    if (blocked) return Promise.resolve(blocked);
    const executor = this.syncExecutor();
    return executor ? executor.redo(project) : this.load().then((e) => e.redo(project));
  };

  getHistory(): ActionHistory {
    return this.history;
  }
}

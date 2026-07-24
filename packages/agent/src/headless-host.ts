import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { CAPABILITY_MANIFEST } from "@openreel/core/capabilities/manifest";
import type { CapabilityManifest } from "@openreel/core/capabilities/manifest";
import type { Action, ActionResult } from "@openreel/core/types/actions";
import type { Project } from "@openreel/core/types/project";
import type { EditingHost, JobKind, JobResult, JobRunner, TxnHandle } from "./host";

export interface HeadlessHostOptions {
  readonly history?: ActionHistory;
  readonly jobRunner?: JobRunner;
}

/**
 * A pure-Node EditingHost. Wraps the core ActionExecutor over an in-memory
 * project so an agent can edit headlessly (cloud / CLI / tests). Rendering and
 * GPU/export jobs are delegated to an injected JobRunner.
 */
export class HeadlessHost implements EditingHost {
  private project: Project | null;
  private readonly executor: ActionExecutor;
  private readonly history: ActionHistory;
  private readonly jobRunner?: JobRunner;
  private txnCounter = 0;
  private readonly txnSnapshots = new Map<string, Project>();

  constructor(project: Project | null, options: HeadlessHostOptions = {}) {
    this.project = project;
    this.history = options.history ?? new ActionHistory();
    this.executor = new ActionExecutor(this.history);
    this.jobRunner = options.jobRunner;
  }

  getProject(): Project {
    this.requireOpenProject();
    return this.project as Project;
  }

  async applyAction(action: Action): Promise<ActionResult> {
    this.requireOpenProject();
    return this.executor.execute(action, this.project as Project);
  }

  beginTransaction(label?: string): TxnHandle {
    const id = `txn-${++this.txnCounter}`;
    // Snapshot the pre-turn project; rollback restores it wholesale, which is
    // robust to inverse handlers throwing and to history trimming (maxHistorySize)
    // discarding entries mid-turn — both of which can defeat inverse-replay.
    if (this.project) this.txnSnapshots.set(id, structuredClone(this.project));
    this.history.beginGroup(label ?? id);
    return { id };
  }

  commitTransaction(handle: TxnHandle, _label: string): void {
    this.history.endGroup();
    this.txnSnapshots.delete(handle.id);
  }

  async rollbackTransaction(handle: TxnHandle): Promise<void> {
    this.history.endGroup();
    const snapshot = this.txnSnapshots.get(handle.id);
    this.txnSnapshots.delete(handle.id);
    if (snapshot) {
      // Restore the authoritative pre-turn state and drop the turn's history
      // entries so the (errored) turn leaves no partial state and nothing stale
      // to redo.
      this.project = snapshot;
      this.history.clear();
    }
  }

  async runJob(
    kind: JobKind,
    params: Record<string, unknown>,
  ): Promise<JobResult> {
    if (!this.jobRunner) {
      return {
        ok: false,
        error: `Job '${kind}' is not available in this host (no job runner configured)`,
      };
    }
    return this.jobRunner(kind, params);
  }

  capabilities(): CapabilityManifest {
    return CAPABILITY_MANIFEST;
  }

  requireOpenProject(): void {
    if (!this.project) {
      throw new Error("No project is open");
    }
  }

  /** Test/host helper: replace the open project (e.g. after load). */
  setProject(project: Project | null): void {
    this.project = project;
    this.history.clear();
  }
}

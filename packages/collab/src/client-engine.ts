import {
  type ClientMessage,
  type CollabRole,
  type CollabUser,
  type LockInfo,
  type PeerInfo,
  type PresenceState,
  type RejectReason,
  type SequencedOp,
  type ServerMessage,
  type WireAction,
} from "./protocol";
import { computeTouches, toWireAction, type TouchProject } from "./touches";

/**
 * What the engine needs from the application. The web app implements it over
 * the project store + `ActionExecutor.applyRemote`; tests implement it over a
 * real executor or a toy document.
 */
export interface CollabHost<P extends TouchProject> {
  /** The project the user is looking at (mutated in place by executor calls). */
  getProject(): P;
  /** Independent deep copy (media runtime data may be shared by reference). */
  clone(project: P): P;
  /** Publish a rebuilt project to the UI/engines. `previous` is the project it replaces. */
  replaceProject(next: P, previous: P): void;
  /** Re-render after an in-place remote apply. */
  projectChanged(): void;
  /** Apply a sequenced action to `project` without touching the local undo history. True on success. */
  applyAction(action: WireAction, project: P): Promise<boolean>;
  /** JSON-safe project for the wire (no blobs / handles). */
  serialize(project: P): unknown;
  /** Inverse of serialize (media become placeholders to relink). */
  deserialize(raw: unknown): P;
  /** Remove rolled-back local actions from the undo history. */
  discardHistory?(actionIds: readonly string[]): void;
}

export interface PendingOp {
  readonly opId: string;
  readonly baseSeq: number;
  readonly actions: readonly WireAction[];
  readonly touches: readonly string[];
  readonly locks: readonly string[];
  sent: boolean;
  /** The replay already told the user this op stopped applying. */
  reported?: boolean;
}

export type CollabStatus = "idle" | "connecting" | "syncing" | "live" | "offline";

export type CollabNotice =
  | { kind: "rejected"; reason: RejectReason; detail: string; actions: readonly WireAction[] }
  | { kind: "inapplicable"; detail: string; actions: readonly WireAction[] }
  | { kind: "unsynced"; detail: string }
  | { kind: "lock-denied"; resource: string; heldBy: CollabUser }
  | { kind: "error"; code: string; message: string };

export interface CollabSnapshot {
  readonly status: CollabStatus;
  readonly role: CollabRole | null;
  readonly clientId: string;
  readonly confirmedSeq: number;
  readonly pending: number;
  readonly peers: readonly PeerInfo[];
  readonly locks: readonly LockInfo[];
}

export interface EngineOptions {
  clientId: string;
  name: string;
  color?: string;
  /** Room capability key (editor or viewer invite). */
  key: string;
  send: (msg: ClientMessage) => void;
  /**
   * May the open project seed an empty room? True for the person who started the session.
   * A joiner must never upload what they have open because a server (possibly one named by a
   * crafted invite link) says the room is empty.
   */
  allowInit?: boolean;
  newOpId?: () => string;
}

export type AppliedEvent = { kind: "edit" | "undo" | "redo"; actions: readonly { type: string; id: string; timestamp: number; params: Record<string, unknown> }[] };

/**
 * Client side of the collaboration protocol.
 *
 * It keeps two copies of the project: `base` (exactly the server-confirmed
 * state at `confirmedSeq`) and the live project (base plus this client's
 * unconfirmed "pending" ops). Remote ops are applied to base; when local ops
 * are pending the live project is rebuilt as base + pending replay. Because
 * every client applies the same sequence to the same state with a
 * deterministic executor, all clients converge; the server's touch-key check
 * only decides which concurrent edits are allowed to enter the sequence
 * (reject-on-conflict) and the replay reports edits that stopped applying.
 */
export class CollabEngine<P extends TouchProject> {
  private base: P | null = null;
  private confirmedSeq = 0;
  private hasSynced = false;
  private pending: PendingOp[] = [];
  private status: CollabStatus = "idle";
  private role: CollabRole | null = null;
  private peers: readonly PeerInfo[] = [];
  private locks: readonly LockInfo[] = [];
  private awaitingInitWelcome = false;
  private applying = Promise.resolve();
  private listeners = new Set<() => void>();
  private noticeListeners = new Set<(notice: CollabNotice) => void>();
  private opCounter = 0;

  constructor(
    private readonly host: CollabHost<P>,
    private readonly options: EngineOptions,
  ) {}

  // -------------------------------------------------------------- subscriptions

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onNotice(listener: (notice: CollabNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  getSnapshot(): CollabSnapshot {
    return {
      status: this.status,
      role: this.role,
      clientId: this.options.clientId,
      confirmedSeq: this.confirmedSeq,
      pending: this.pending.length,
      peers: this.peers,
      locks: this.locks,
    };
  }

  /** Resolves once every queued message has been applied (tests, shutdown). */
  idle(): Promise<void> {
    return this.applying;
  }

  getPending(): readonly PendingOp[] {
    return this.pending;
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  private notice(notice: CollabNotice): void {
    this.noticeListeners.forEach((l) => l(notice));
  }

  // ------------------------------------------------------------------ transport

  /** The socket opened (or reopened): introduce ourselves and ask for what we missed. */
  handleOpen(): void {
    this.status = this.hasSynced ? "syncing" : "connecting";
    this.options.send({ type: "hello", clientId: this.options.clientId, name: this.options.name, color: this.options.color, key: this.options.key, lastSeq: this.hasSynced ? this.confirmedSeq : null });
    this.emit();
  }

  handleClose(): void {
    if (this.status === "idle") return;
    this.status = "offline";
    this.peers = [];
    this.pending.forEach((p) => (p.sent = false));
    this.emit();
  }

  /** Stop collaborating: the live project stays as the user's own copy. */
  stop(): void {
    this.status = "idle";
    this.peers = [];
    this.locks = [];
    this.emit();
  }

  handleMessage(msg: ServerMessage): Promise<void> {
    this.applying = this.applying.then(() => this.process(msg)).catch((error) => {
      this.notice({ kind: "error", code: "engine", message: error instanceof Error ? error.message : String(error) });
    });
    return this.applying;
  }

  private async process(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case "welcome":
        return this.onWelcome(msg);
      case "op":
        return this.onOp(msg.op);
      case "reject":
        return this.onReject(msg);
      case "peers":
        this.peers = msg.peers;
        this.emit();
        return;
      case "locks":
        this.locks = msg.locks;
        this.emit();
        return;
      case "lock-denied":
        this.notice({ kind: "lock-denied", resource: msg.resource, heldBy: msg.heldBy });
        return;
      case "snapshot-request":
        if (this.base && this.confirmedSeq >= msg.seq) {
          this.options.send({ type: "snapshot", seq: this.confirmedSeq, project: this.host.serialize(this.base) });
        }
        return;
      case "error":
        this.notice({ kind: "error", code: msg.code, message: msg.message });
        return;
      case "pong":
        return;
    }
  }

  // -------------------------------------------------------------------- welcome

  private async onWelcome(msg: Extract<ServerMessage, { type: "welcome" }>): Promise<void> {
    this.role = msg.role;
    this.peers = msg.peers;
    this.locks = msg.locks;
    if (msg.needsInit && this.options.allowInit === false) {
      this.status = "syncing";
      this.emit();
      return;
    }
    if (msg.needsInit) {
      // First one in: the open project becomes the room's project.
      const live = this.host.getProject();
      this.base = this.host.clone(live);
      this.confirmedSeq = 0;
      this.hasSynced = true;
      this.awaitingInitWelcome = true;
      this.options.send({ type: "init", project: this.host.serialize(live) });
      this.status = "live";
      this.emit();
      return;
    }
    if (!msg.snapshot && !this.base) {
      // Viewer joined an empty room: wait for the owner to initialize it.
      this.status = "syncing";
      this.emit();
      return;
    }
    let rebuild = false;
    if (msg.snapshot) {
      if (this.awaitingInitWelcome && msg.snapshot.seq === 0 && this.base) {
        this.awaitingInitWelcome = false;
      } else {
        this.base = this.host.deserialize(msg.snapshot.project);
        this.confirmedSeq = msg.snapshot.seq;
        rebuild = true;
      }
    }
    this.hasSynced = true;
    for (const op of msg.ops) {
      if (op.seq <= this.confirmedSeq) continue;
      if (op.seq !== this.confirmedSeq + 1) {
        this.options.send({ type: "hello", clientId: this.options.clientId, name: this.options.name, color: this.options.color, key: this.options.key, lastSeq: this.confirmedSeq });
        return;
      }
      rebuild = (await this.sequence(op)) || rebuild;
    }
    // Ops the server already sequenced (ack lost with the old socket) are applied above; drop them from pending.
    if (rebuild || this.pending.length > 0) await this.rebuild();
    this.status = "live";
    this.flush();
    this.emit();
  }

  // ------------------------------------------------------------------ sequenced

  private async onOp(op: SequencedOp): Promise<void> {
    if (!this.base) return;
    if (op.seq <= this.confirmedSeq) return;
    if (op.seq !== this.confirmedSeq + 1) {
      // A gap: resync from what we have.
      this.options.send({ type: "hello", clientId: this.options.clientId, name: this.options.name, color: this.options.color, key: this.options.key, lastSeq: this.confirmedSeq });
      return;
    }
    const needsRebuild = await this.sequence(op);
    if (needsRebuild) await this.rebuild();
    this.emit();
  }

  /**
   * Apply a sequenced op to base. Returns true when the live project must be
   * rebuilt (a remote op landed while local ops are pending).
   */
  private async sequence(op: SequencedOp): Promise<boolean> {
    const base = this.base!;
    const own = op.clientId === this.options.clientId;
    const pendingIndex = own ? this.pending.findIndex((p) => p.opId === op.opId) : -1;
    for (const action of op.actions) await this.host.applyAction(action, base);
    this.confirmedSeq = op.seq;
    if (pendingIndex >= 0) {
      // Our own op came back in order: live already reflects it.
      this.pending.splice(pendingIndex, 1);
      return false;
    }
    if (own) {
      // Acked an op we no longer track (e.g. a replay after reconnect already merged it into a snapshot).
      return this.pending.length > 0;
    }
    if (this.pending.length > 0) return true;
    // Nothing pending: live == base, apply the remote op in place.
    const live = this.host.getProject();
    for (const action of op.actions) await this.host.applyAction(action, live);
    this.host.projectChanged();
    return false;
  }

  /** live := base + replay of pending ops. Ops that no longer apply are reported and dropped from the live view. */
  private async rebuild(): Promise<void> {
    if (!this.base) return;
    const previous = this.host.getProject();
    const next = this.host.clone(this.base);
    for (const op of this.pending) {
      const failed: WireAction[] = [];
      for (const action of op.actions) if (!(await this.host.applyAction(action, next))) failed.push(action);
      if (failed.length > 0 && !op.reported) {
        op.reported = true;
        this.notice({ kind: "inapplicable", detail: "A collaborator's change made one of your edits impossible, so it was not applied.", actions: failed });
      }
    }
    this.host.replaceProject(next, previous);
  }

  private async onReject(msg: Extract<ServerMessage, { type: "reject" }>): Promise<void> {
    const index = this.pending.findIndex((p) => p.opId === msg.opId);
    if (index < 0) return;
    const [op] = this.pending.splice(index, 1);
    this.host.discardHistory?.(op.actions.map((a) => a.id));
    this.notice({ kind: "rejected", reason: msg.reason, detail: msg.detail, actions: op.actions });
    await this.rebuild();
    this.emit();
  }

  // ---------------------------------------------------------------- local edits

  /** A local edit/undo/redo was applied to the live project: queue it for the room. */
  localApplied(event: AppliedEvent): void {
    if (this.status === "idle" || !this.base) return;
    if (this.role === "viewer") return;
    const actions: WireAction[] = [];
    let dropped = 0;
    for (const action of event.actions) {
      const wire = toWireAction(action);
      if (wire) actions.push(wire);
      else dropped++;
    }
    if (dropped > 0) this.notice({ kind: "unsynced", detail: `${dropped} local change${dropped === 1 ? "" : "s"} (such as importing a media file) stay on this machine.` });
    if (actions.length === 0) return;
    const { touches, locks } = computeTouches(actions, this.base);
    const op: PendingOp = {
      opId: this.options.newOpId ? this.options.newOpId() : `${this.options.clientId}:${++this.opCounter}:${Date.now().toString(36)}`,
      baseSeq: this.confirmedSeq,
      actions,
      touches,
      locks,
      sent: false,
    };
    this.pending.push(op);
    this.flush();
    this.emit();
  }

  /** Send every unsent pending op in order (only while live). */
  private flush(): void {
    if (this.status !== "live") return;
    for (const op of this.pending) {
      if (op.sent) continue;
      op.sent = true;
      this.options.send({ type: "op", op: { opId: op.opId, baseSeq: op.baseSeq, actions: op.actions, touches: op.touches, locks: op.locks } });
    }
  }

  setPresence(presence: PresenceState): void {
    if (this.status !== "live") return;
    this.options.send({ type: "presence", presence });
  }

  sendPing(): void {
    if (this.status === "live") this.options.send({ type: "ping" });
  }

  setLock(resource: string, acquire: boolean, steal = false): void {
    if (this.status !== "live") return;
    this.options.send({ type: "lock", resource, acquire, steal });
  }
}

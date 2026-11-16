import {
  LOCK_DISCONNECT_GRACE_MS,
  LOCK_TTL_MS,
  LOG_COMPACT_AT,
  LOG_RETAIN,
  colorForId,
  type ClientMessage,
  type CollabRole,
  type CollabUser,
  type LockInfo,
  type PeerInfo,
  type PresenceState,
  type SequencedOp,
  type ServerMessage,
  type WireOp,
} from "./protocol";
import { touchesOverlap } from "./touches";

/** A message the room wants delivered: to one client, to everyone, or to everyone except one. */
export interface Outgoing {
  readonly to: string | "*";
  readonly except?: string;
  readonly msg: ServerMessage;
}

interface ClientRecord {
  readonly clientId: string;
  readonly user: CollabUser;
  readonly role: CollabRole;
  presence: PresenceState;
  connected: boolean;
}

interface LockRecord {
  readonly resource: string;
  clientId: string;
  user: CollabUser;
  expiresAt: number;
}

export interface RoomState {
  readonly snapshot: { seq: number; project: unknown } | null;
  readonly log: readonly SequencedOp[];
  readonly head: number;
  readonly floor: number;
  readonly locks: readonly LockInfo[];
}

export interface RoomChanges {
  appended: SequencedOp[];
  /** Ops with seq <= this were dropped from the log. */
  droppedThrough: number | null;
  snapshotChanged: boolean;
}

export interface RoomOptions {
  now?: () => number;
  logRetain?: number;
  compactAt?: number;
}

const EMPTY_PRESENCE: PresenceState = { playhead: null, selection: [], sequenceId: null };
const MAX_NAME = 40;
const MAX_SELECTION = 200;
const MAX_ID_CHARS = 128;

/**
 * Pure, transport-free room logic: sequencing, conflict checks, soft locks,
 * presence and snapshot/log retention. The Durable Object and the in-process
 * test hub both drive this same class.
 *
 * Invariants:
 *  - `log` holds every op with seq > `floor` (contiguous, ascending).
 *  - `snapshot.seq >= floor`, so (snapshot + ops after it) always rebuilds head.
 */
export class RoomCore {
  private snapshot: { seq: number; project: unknown } | null = null;
  private log: SequencedOp[] = [];
  private head = 0;
  private floor = 0;
  private readonly clients = new Map<string, ClientRecord>();
  private readonly locks = new Map<string, LockRecord>();
  private readonly now: () => number;
  private readonly logRetain: number;
  private readonly compactAt: number;
  private snapshotRequestedAt = Number.NEGATIVE_INFINITY;
  private changes: RoomChanges = { appended: [], droppedThrough: null, snapshotChanged: false };

  constructor(options: RoomOptions = {}) {
    this.now = options.now ?? Date.now;
    this.logRetain = options.logRetain ?? LOG_RETAIN;
    this.compactAt = options.compactAt ?? LOG_COMPACT_AT;
  }

  static restore(state: RoomState, options: RoomOptions = {}): RoomCore {
    const room = new RoomCore(options);
    room.snapshot = state.snapshot;
    room.log = [...state.log];
    room.head = state.head;
    room.floor = state.floor;
    for (const lock of state.locks) {
      room.locks.set(lock.resource, { resource: lock.resource, clientId: lock.clientId, user: lock.user, expiresAt: lock.expiresAt });
    }
    return room;
  }

  serialize(): RoomState {
    return { snapshot: this.snapshot, log: this.log, head: this.head, floor: this.floor, locks: this.lockList() };
  }

  /** Persistence deltas since the last call. */
  drainChanges(): RoomChanges {
    const out = this.changes;
    this.changes = { appended: [], droppedThrough: null, snapshotChanged: false };
    return out;
  }

  get headSeq(): number {
    return this.head;
  }
  get floorSeq(): number {
    return this.floor;
  }
  get initialized(): boolean {
    return this.snapshot !== null;
  }
  get logLength(): number {
    return this.log.length;
  }
  get snapshotSeq(): number | null {
    return this.snapshot?.seq ?? null;
  }
  isConnected(clientId: string): boolean {
    return this.clients.get(clientId)?.connected === true;
  }
  /** Identity and role of a joined client, or null. */
  clientInfo(clientId: string): { user: CollabUser; role: CollabRole } | null {
    const record = this.clients.get(clientId);
    return record ? { user: record.user, role: record.role } : null;
  }

  /**
   * Re-register a client whose socket outlived the in-memory room (a hibernated
   * Durable Object wakes with no client table but its sockets still open).
   * No-op when the client is already known.
   */
  adopt(clientId: string, user: CollabUser, role: CollabRole): void {
    if (this.clients.has(clientId)) return;
    this.clients.set(clientId, { clientId, user, role, presence: EMPTY_PRESENCE, connected: true });
  }

  // ---------------------------------------------------------------- join / leave

  hello(msg: Extract<ClientMessage, { type: "hello" }>, role: CollabRole, userId: string): Outgoing[] {
    this.expireLocks();
    const name = (msg.name || "Guest").slice(0, MAX_NAME);
    const user: CollabUser = { id: userId, name, color: msg.color && /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : colorForId(userId) };
    const existing = this.clients.get(msg.clientId);
    this.clients.set(msg.clientId, { clientId: msg.clientId, user, role, presence: existing?.presence ?? EMPTY_PRESENCE, connected: true });
    // A returning client takes back its locks at full lifetime.
    for (const lock of this.locks.values()) {
      if (lock.clientId === msg.clientId) {
        lock.expiresAt = this.now() + LOCK_TTL_MS;
        lock.user = user;
      }
    }
    const out: Outgoing[] = [];
    let welcome: ServerMessage;
    if (!this.snapshot) {
      welcome = { type: "welcome", clientId: msg.clientId, role, seq: 0, ops: [], peers: this.peerList(), locks: this.lockList(), needsInit: role === "editor" };
    } else if (msg.lastSeq !== null && msg.lastSeq >= this.floor && msg.lastSeq <= this.head) {
      welcome = { type: "welcome", clientId: msg.clientId, role, seq: this.head, ops: this.log.filter((op) => op.seq > msg.lastSeq!), peers: this.peerList(), locks: this.lockList() };
    } else {
      welcome = {
        type: "welcome",
        clientId: msg.clientId,
        role,
        seq: this.head,
        snapshot: this.snapshot,
        ops: this.log.filter((op) => op.seq > this.snapshot!.seq),
        peers: this.peerList(),
        locks: this.lockList(),
      };
    }
    out.push({ to: msg.clientId, msg: welcome });
    out.push({ to: "*", except: msg.clientId, msg: { type: "peers", peers: this.peerList() } });
    out.push({ to: "*", msg: { type: "locks", locks: this.lockList() } });
    return out;
  }

  leave(clientId: string): Outgoing[] {
    const record = this.clients.get(clientId);
    if (!record) return [];
    record.connected = false;
    const grace = this.now() + LOCK_DISCONNECT_GRACE_MS;
    for (const lock of this.locks.values()) if (lock.clientId === clientId) lock.expiresAt = Math.min(lock.expiresAt, grace);
    this.clients.delete(clientId);
    // Keep the presence of nobody; locks live on through the grace window.
    return [{ to: "*", msg: { type: "peers", peers: this.peerList() } }];
  }

  /** Drop expired locks. Call on a timer / before decisions. */
  tick(): Outgoing[] {
    return this.expireLocks() ? [{ to: "*", msg: { type: "locks", locks: this.lockList() } }] : [];
  }

  // -------------------------------------------------------------------- messages

  handle(clientId: string, msg: ClientMessage): Outgoing[] {
    const client = this.clients.get(clientId);
    if (!client) return [{ to: clientId, msg: { type: "error", code: "not-joined", message: "Send hello first." } }];
    this.expireLocks();
    switch (msg.type) {
      case "ping":
        return [{ to: clientId, msg: { type: "pong" } }];
      case "presence":
        return this.presence(client, msg.presence);
      case "init":
        return this.init(client, msg.project);
      case "op":
        return this.submit(client, msg.op);
      case "lock":
        return this.lock(client, msg.resource, msg.acquire, msg.steal === true);
      case "snapshot":
        return this.acceptSnapshot(client, msg.seq, msg.project);
      case "hello":
        return [{ to: clientId, msg: { type: "error", code: "already-joined", message: "Already joined." } }];
    }
  }

  private init(client: ClientRecord, project: unknown): Outgoing[] {
    if (client.role !== "editor") return [{ to: client.clientId, msg: { type: "error", code: "readonly", message: "Viewers cannot initialize a room." } }];
    if (this.snapshot) return [{ to: client.clientId, msg: { type: "error", code: "already-initialized", message: "The room already has a project." } }];
    this.snapshot = { seq: 0, project };
    this.changes.snapshotChanged = true;
    this.head = 0;
    this.floor = 0;
    // Everyone waiting on an empty room is now welcomed with the project.
    return [...this.clients.values()].filter((c) => c.connected).map((c): Outgoing => ({
      to: c.clientId,
      msg: { type: "welcome", clientId: c.clientId, role: c.role, seq: 0, snapshot: this.snapshot!, ops: [], peers: this.peerList(), locks: this.lockList() },
    }));
  }

  private presence(client: ClientRecord, presence: PresenceState): Outgoing[] {
    client.presence = {
      playhead: typeof presence.playhead === "number" && Number.isFinite(presence.playhead) ? presence.playhead : null,
      selection: (Array.isArray(presence.selection) ? presence.selection : []).filter((s): s is string => typeof s === "string").slice(0, MAX_SELECTION).map((s) => s.slice(0, MAX_ID_CHARS)),
      sequenceId: typeof presence.sequenceId === "string" ? presence.sequenceId.slice(0, MAX_ID_CHARS) : null,
    };
    for (const lock of this.locks.values()) if (lock.clientId === client.clientId) lock.expiresAt = this.now() + LOCK_TTL_MS;
    return [{ to: "*", msg: { type: "peers", peers: this.peerList() } }];
  }

  private submit(client: ClientRecord, op: WireOp): Outgoing[] {
    const reject = (reason: Extract<ServerMessage, { type: "reject" }>["reason"], detail: string, extra: Partial<Extract<ServerMessage, { type: "reject" }>> = {}): Outgoing[] => [
      { to: client.clientId, msg: { type: "reject", opId: op.opId, reason, detail, ...extra } },
    ];
    if (!this.snapshot) return reject("not-ready", "The room has no project yet.");
    if (client.role !== "editor") return reject("readonly", "This invite is view-only.");
    if (!op || typeof op.opId !== "string" || !Array.isArray(op.actions) || op.actions.length === 0 || !Array.isArray(op.touches) || typeof op.baseSeq !== "number") {
      return reject("invalid", "Malformed op.");
    }
    // Idempotent resubmission after a reconnect whose ack was lost.
    const dup = this.log.find((entry) => entry.opId === op.opId && entry.clientId === client.clientId);
    if (dup) return [{ to: client.clientId, msg: { type: "op", op: dup } }];
    if (op.baseSeq > this.head) return reject("invalid", "baseSeq is ahead of the room.");
    if (op.baseSeq < this.floor) return reject("stale", "Your copy is older than the history this room keeps; reload the shared project.");
    for (const resource of op.locks ?? []) {
      const lock = this.locks.get(resource);
      if (lock && lock.clientId !== client.clientId) {
        return reject("locked", `${resource} is locked by ${lock.user.name}.`, { lockedBy: lock.user });
      }
    }
    for (const entry of this.log) {
      if (entry.seq <= op.baseSeq || entry.clientId === client.clientId) continue;
      if (touchesOverlap(entry.touches, op.touches)) {
        return reject("conflict", `${entry.userId === client.user.id ? "You" : this.nameOf(entry.clientId, entry.userId)} changed the same item since your last sync.`, { conflictSeq: entry.seq });
      }
    }
    const sequenced: SequencedOp = {
      opId: op.opId,
      baseSeq: op.baseSeq,
      actions: op.actions,
      touches: op.touches,
      locks: op.locks ?? [],
      seq: ++this.head,
      clientId: client.clientId,
      userId: client.user.id,
      at: this.now(),
    };
    this.log.push(sequenced);
    this.changes.appended.push(sequenced);
    for (const lock of this.locks.values()) if (lock.clientId === client.clientId) lock.expiresAt = this.now() + LOCK_TTL_MS;
    const out: Outgoing[] = [{ to: "*", msg: { type: "op", op: sequenced } }];
    if (this.log.length >= this.compactAt && this.head - this.snapshotRequestedAt >= Math.max(1, Math.floor(this.compactAt / 2))) {
      this.snapshotRequestedAt = this.head;
      out.push({ to: client.clientId, msg: { type: "snapshot-request", seq: this.head } });
    }
    return out;
  }

  private acceptSnapshot(client: ClientRecord, seq: number, project: unknown): Outgoing[] {
    if (client.role !== "editor" || !this.snapshot) return [];
    if (typeof seq !== "number" || seq < this.snapshot.seq || seq > this.head) return [];
    this.snapshot = { seq, project };
    this.changes.snapshotChanged = true;
    const newFloor = Math.max(this.floor, Math.min(seq, this.head - this.logRetain));
    if (newFloor > this.floor) {
      this.floor = newFloor;
      this.log = this.log.filter((op) => op.seq > newFloor);
      this.changes.droppedThrough = newFloor;
    }
    return [];
  }

  // ----------------------------------------------------------------------- locks

  private lock(client: ClientRecord, resource: string, acquire: boolean, steal: boolean): Outgoing[] {
    if (client.role !== "editor") return [{ to: client.clientId, msg: { type: "error", code: "readonly", message: "Viewers cannot lock." } }];
    if (typeof resource !== "string" || !(resource.startsWith("bin:") || resource.startsWith("sequence:"))) {
      return [{ to: client.clientId, msg: { type: "error", code: "invalid", message: "Only bins and sequences can be locked." } }];
    }
    const held = this.locks.get(resource);
    if (!acquire) {
      if (held && held.clientId === client.clientId) {
        this.locks.delete(resource);
        return [{ to: "*", msg: { type: "locks", locks: this.lockList() } }];
      }
      return [];
    }
    if (held && held.clientId !== client.clientId && !steal) {
      return [{ to: client.clientId, msg: { type: "lock-denied", resource, heldBy: held.user } }];
    }
    this.locks.set(resource, { resource, clientId: client.clientId, user: client.user, expiresAt: this.now() + LOCK_TTL_MS });
    return [{ to: "*", msg: { type: "locks", locks: this.lockList() } }];
  }

  private expireLocks(): boolean {
    let changed = false;
    const now = this.now();
    for (const [resource, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(resource);
        changed = true;
      }
    }
    return changed;
  }

  // --------------------------------------------------------------------- helpers

  private nameOf(clientId: string, fallback: string): string {
    return this.clients.get(clientId)?.user.name ?? fallback;
  }

  peerList(): PeerInfo[] {
    return [...this.clients.values()].filter((c) => c.connected).map((c) => ({ clientId: c.clientId, user: c.user, role: c.role, presence: c.presence }));
  }

  lockList(): LockInfo[] {
    return [...this.locks.values()].map((l) => ({ resource: l.resource, clientId: l.clientId, user: l.user, expiresAt: l.expiresAt }));
  }
}

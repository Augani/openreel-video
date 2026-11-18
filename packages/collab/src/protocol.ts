/**
 * Wire protocol for real-time project collaboration.
 *
 * The unit of sync is the core undoable action. A room sequences "ops" (one or
 * more actions authored together) into a single total order; every client
 * applies the same sequence through the same executor, so the project
 * converges. The server never interprets actions: it only checks the entity
 * "touch keys" the author declared against ops it sequenced since the author's
 * base sequence (conflict), and against soft locks.
 */

/** Serializable mirror of the core `Action` (kept structural so this package has no runtime dependency on core). */
export interface WireAction {
  readonly type: string;
  readonly id: string;
  readonly timestamp: number;
  readonly params: Record<string, unknown>;
}

export type CollabRole = "editor" | "viewer";

export interface CollabUser {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface WireOp {
  /** Client-unique id for this op; echoed in the ack / reject. */
  readonly opId: string;
  /** Highest server sequence the author had applied when it made the op. */
  readonly baseSeq: number;
  readonly actions: readonly WireAction[];
  /** Entity keys (`clip:ID`, `track:ID`, `media:ID`, `*` ...) this op writes; used for conflict detection. */
  readonly touches: readonly string[];
  /** Soft-lockable resources (`bin:ID`, `sequence:ID`) this op edits; rejected when someone else holds them. */
  readonly locks: readonly string[];
}

export interface SequencedOp extends WireOp {
  readonly seq: number;
  readonly clientId: string;
  readonly userId: string;
  readonly at: number;
}

export interface PresenceState {
  readonly playhead: number | null;
  readonly selection: readonly string[];
  readonly sequenceId?: string | null;
}

export interface PeerInfo {
  readonly clientId: string;
  readonly user: CollabUser;
  readonly role: CollabRole;
  readonly presence: PresenceState;
}

export interface LockInfo {
  readonly resource: string;
  readonly clientId: string;
  readonly user: CollabUser;
  readonly expiresAt: number;
}

export type RejectReason =
  /** A collaborator touched the same entity after the author's base sequence. */
  | "conflict"
  /** The resource is soft-locked by someone else. */
  | "locked"
  /** The author's base is older than the log the room still retains. */
  | "stale"
  /** The viewer role cannot edit. */
  | "readonly"
  | "invalid"
  | "not-ready";

export type ClientMessage =
  | { type: "hello"; clientId: string; name: string; color?: string; key: string; lastSeq: number | null }
  | { type: "init"; project: unknown }
  | { type: "op"; op: WireOp }
  | { type: "presence"; presence: PresenceState }
  | { type: "lock"; resource: string; acquire: boolean; steal?: boolean }
  | { type: "snapshot"; seq: number; project: unknown }
  | { type: "ping" };

export type ServerMessage =
  | {
      type: "welcome";
      clientId: string;
      role: CollabRole;
      /** Room head sequence. */
      seq: number;
      /** Present when the client must replace its state (no/too-old lastSeq). */
      snapshot?: { seq: number; project: unknown };
      /** Ops after the snapshot (or after the client's lastSeq). */
      ops: readonly SequencedOp[];
      peers: readonly PeerInfo[];
      locks: readonly LockInfo[];
      /** The room has no project yet: the client should send `init`. */
      needsInit?: boolean;
    }
  | { type: "op"; op: SequencedOp }
  | { type: "reject"; opId: string; reason: RejectReason; detail: string; conflictSeq?: number; lockedBy?: CollabUser }
  | { type: "peers"; peers: readonly PeerInfo[] }
  | { type: "locks"; locks: readonly LockInfo[] }
  | { type: "lock-denied"; resource: string; heldBy: CollabUser }
  | { type: "snapshot-request"; seq: number }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export const PROTOCOL_VERSION = 1;
/** Soft lock lifetime without a refresh. */
export const LOCK_TTL_MS = 120_000;
/** A disconnected client keeps its locks this long so a reconnect does not lose them. */
export const LOCK_DISCONNECT_GRACE_MS = 20_000;
/** Ops retained after compaction; older baseSeq values are rejected as stale. */
export const LOG_RETAIN = 500;
/** Ask for a snapshot (and compact) once the log holds this many ops. */
export const LOG_COMPACT_AT = 1000;

export const GLOBAL_TOUCH = "*";

const PALETTE = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#978365"];

export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

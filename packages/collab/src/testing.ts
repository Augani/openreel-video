import type { CollabEngine } from "./client-engine";
import type { TouchProject } from "./touches";
import { RoomCore, type Outgoing, type RoomOptions } from "./room-core";
import type { ClientMessage, CollabRole, ServerMessage } from "./protocol";

interface Link {
  engine: CollabEngine<TouchProject>;
  clientId: string;
  connected: boolean;
  /** Frozen links queue traffic both ways, simulating latency. */
  frozen: boolean;
  up: ClientMessage[];
  down: ServerMessage[];
}

/**
 * In-process transport: a RoomCore plus message queues standing in for
 * WebSockets. Tests control delivery order (freeze/thaw) to build concurrent
 * edits, and connect/disconnect to build reconnects. The Durable Object
 * drives the very same RoomCore, so this exercises the real sequencing logic.
 */
export class LoopbackHub {
  readonly room: RoomCore;
  private readonly links = new Map<string, Link>();

  constructor(
    private readonly keys: { editor: string; viewer: string } = { editor: "editor-key", viewer: "viewer-key" },
    options?: RoomOptions,
  ) {
    this.room = new RoomCore(options);
  }

  /** Register an engine and open its socket. */
  attach<P extends TouchProject>(engine: CollabEngine<P>, open = true): Link {
    const clientId = engine.getSnapshot().clientId;
    const link: Link = { engine: engine as unknown as CollabEngine<TouchProject>, clientId, connected: false, frozen: false, up: [], down: [] };
    this.links.set(clientId, link);
    if (open) this.open(clientId);
    return link;
  }

  /** The send callback to give each engine. */
  sender(clientId: string): (msg: ClientMessage) => void {
    return (msg) => {
      const link = this.links.get(clientId);
      if (link?.connected) link.up.push(msg);
    };
  }

  open(clientId: string): void {
    const link = this.links.get(clientId)!;
    link.connected = true;
    link.engine.handleOpen();
  }

  /** Drop the socket: queued traffic is lost, like a dead connection. */
  drop(clientId: string): void {
    const link = this.links.get(clientId)!;
    link.connected = false;
    link.up = [];
    link.down = [];
    this.dispatch(this.room.leave(clientId));
    link.engine.handleClose();
  }

  freeze(clientId: string): void {
    this.links.get(clientId)!.frozen = true;
  }
  thaw(clientId: string): void {
    this.links.get(clientId)!.frozen = false;
  }

  private roleFor(key: string): CollabRole | null {
    return key === this.keys.editor ? "editor" : key === this.keys.viewer ? "viewer" : null;
  }

  private dispatch(out: readonly Outgoing[]): void {
    for (const item of out) {
      for (const link of this.links.values()) {
        if (!link.connected) continue;
        if (item.to !== "*" && item.to !== link.clientId) continue;
        if (item.except === link.clientId) continue;
        link.down.push(item.msg);
      }
    }
  }

  /** Deliver queued traffic until nothing more moves (respecting frozen links). */
  async pump(maxRounds = 200): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      let moved = false;
      for (const link of this.links.values()) {
        if (link.frozen || !link.connected) continue;
        while (link.up.length > 0) {
          const msg = link.up.shift()!;
          moved = true;
          if (msg.type === "hello") {
            const role = this.roleFor(msg.key);
            if (!role) this.dispatch([{ to: link.clientId, msg: { type: "error", code: "forbidden", message: "Bad invite key." } }]);
            else this.dispatch(this.room.hello(msg, role, link.clientId));
          } else {
            this.dispatch(this.room.handle(link.clientId, msg));
          }
        }
      }
      for (const link of this.links.values()) {
        if (link.frozen || !link.connected) continue;
        while (link.down.length > 0) {
          const msg = link.down.shift()!;
          moved = true;
          await link.engine.handleMessage(msg);
        }
        await link.engine.idle();
      }
      if (!moved) return;
    }
    throw new Error("LoopbackHub.pump did not settle");
  }
}

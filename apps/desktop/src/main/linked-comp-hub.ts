import { CHANNELS, LINKED_COMP_MAX_MESSAGE_BYTES, linkedCompMessageSchema, type LinkedCompMessage } from "../shared/ipc-contract";

/**
 * Routing for linked composition windows. A composition is edited in its own
 * window, but the project lives in the editor (opener) window: every message an
 * editor window posts goes to its opener, and every message the opener posts about
 * a composition goes to the window editing it. Nothing else is ever forwarded, so
 * a window cannot reach a composition it did not open or was not opened for.
 */

export interface HubPeer {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

interface EditorEntry {
  readonly editor: HubPeer;
  readonly host: HubPeer;
}

export class LinkedCompHub {
  private readonly byComposition = new Map<string, EditorEntry>();

  /** Register `editor` as the window editing `compositionId` for `host`. Replaces a stale entry. */
  register(compositionId: string, host: HubPeer, editor: HubPeer): void {
    if (host.id === editor.id) throw new Error("A window cannot edit a composition for itself.");
    this.byComposition.set(compositionId, { editor, host });
  }

  /** The window editing a composition, if one is open. */
  editorOf(compositionId: string): HubPeer | undefined {
    const entry = this.byComposition.get(compositionId);
    if (!entry || entry.editor.isDestroyed()) return undefined;
    return entry.editor;
  }

  /** The editor window a composition window edits for, if one is open. */
  hostOf(compositionId: string): HubPeer | undefined {
    const entry = this.byComposition.get(compositionId);
    if (!entry || entry.editor.isDestroyed()) return undefined;
    return entry.host;
  }

  /** Is `peerId` a composition window (as opposed to an editor window)? */
  isEditor(peerId: number): boolean {
    for (const entry of this.byComposition.values()) if (entry.editor.id === peerId) return true;
    return false;
  }

  /** Forget every composition a window edits, or edits for. Returns the editor windows that lost their host. */
  unregister(peerId: number): HubPeer[] {
    const orphaned: HubPeer[] = [];
    for (const [compositionId, entry] of [...this.byComposition]) {
      if (entry.editor.id === peerId) this.byComposition.delete(compositionId);
      else if (entry.host.id === peerId) {
        this.byComposition.delete(compositionId);
        orphaned.push(entry.editor);
      }
    }
    return orphaned;
  }

  /**
   * Relay a raw message posted by `fromId`. Returns false when it was rejected
   * (malformed, oversized, or not routable from that sender).
   */
  relay(fromId: number, raw: unknown): boolean {
    const parsed = linkedCompMessageSchema.safeParse(raw);
    if (!parsed.success) return false;
    const message: LinkedCompMessage = parsed.data;
    try {
      if (JSON.stringify(message).length > LINKED_COMP_MAX_MESSAGE_BYTES) return false;
    } catch {
      return false;
    }
    const entry = this.byComposition.get(message.compositionId);
    if (!entry) return false;
    if (entry.editor.id === fromId) {
      // Window -> opener: only what a window may say.
      if (message.type !== "hello" && message.type !== "edit" && message.type !== "closed") return false;
      if (entry.host.isDestroyed()) return false;
      entry.host.send(CHANNELS.linkedCompMessage, message);
      return true;
    }
    if (entry.host.id === fromId) {
      // Opener -> window: only what the editor may say.
      if (message.type !== "state" && message.type !== "gone") return false;
      if (entry.editor.isDestroyed()) return false;
      entry.editor.send(CHANNELS.linkedCompMessage, message);
      return true;
    }
    return false;
  }
}

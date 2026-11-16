import { describe, expect, it } from "vitest";
import { CHANNELS, LINKED_COMP_MAX_MESSAGE_BYTES, linkedCompMessageSchema } from "../src/shared/ipc-contract";
import { LinkedCompHub, type HubPeer } from "../src/main/linked-comp-hub";

interface FakePeer extends HubPeer {
  sent: Array<{ channel: string; payload: unknown }>;
  destroyed: boolean;
}
const peer = (id: number): FakePeer => {
  const fake: FakePeer = {
    id,
    sent: [],
    destroyed: false,
    isDestroyed: () => fake.destroyed,
    send: (channel, payload) => {
      fake.sent.push({ channel, payload });
    },
  };
  return fake;
};

const template = { schemaVersion: 1, id: "t", name: "n" };

describe("linked composition IPC contract", () => {
  it("exposes the channel names the preload and main process share", () => {
    expect(CHANNELS.linkedCompOpen).toBe("openreel:linkedComp:open");
    expect(CHANNELS.linkedCompPost).toBe("openreel:linkedComp:post");
    expect(CHANNELS.linkedCompMessage).toBe("openreel:linkedComp:message");
  });

  it("accepts the five message shapes and rejects anything else", () => {
    for (const message of [
      { type: "hello", compositionId: "c" },
      { type: "closed", compositionId: "c" },
      { type: "gone", compositionId: "c" },
      { type: "edit", compositionId: "c", baseRevision: 2, label: "Edit", template },
      { type: "state", compositionId: "c", name: "n", revision: 3, template, rejected: "no" },
    ]) {
      expect(linkedCompMessageSchema.safeParse(message).success, JSON.stringify(message)).toBe(true);
    }
    expect(linkedCompMessageSchema.safeParse({ type: "edit", compositionId: "c" }).success).toBe(false);
    expect(linkedCompMessageSchema.safeParse({ type: "run", compositionId: "c" }).success).toBe(false);
    expect(linkedCompMessageSchema.safeParse({ type: "hello", compositionId: "" }).success).toBe(false);
    expect(linkedCompMessageSchema.safeParse({ type: "edit", compositionId: "c", baseRevision: Number.NaN, label: "", template }).success).toBe(false);
  });
});

describe("LinkedCompHub", () => {
  it("reports which editor window a composition window edits for", () => {
    const hub = new LinkedCompHub();
    const hostA = peer(1);
    const editorA = peer(2);
    hub.register("c1", hostA, editorA);
    expect(hub.hostOf("c1")?.id).toBe(1);
    expect(hub.hostOf("other")).toBeUndefined();
    editorA.destroyed = true;
    expect(hub.hostOf("c1")).toBeUndefined();
  });

  it("relays an edit from the composition window to the editor window and state back", () => {
    const hub = new LinkedCompHub();
    const host = peer(1);
    const editor = peer(2);
    hub.register("c1", host, editor);
    const edit = { type: "edit", compositionId: "c1", baseRevision: 1, label: "Move", template };
    expect(hub.relay(2, edit)).toBe(true);
    expect(host.sent).toEqual([{ channel: CHANNELS.linkedCompMessage, payload: edit }]);
    expect(editor.sent).toHaveLength(0);

    const state = { type: "state", compositionId: "c1", name: "n", revision: 2, template };
    expect(hub.relay(1, state)).toBe(true);
    expect(editor.sent).toEqual([{ channel: CHANNELS.linkedCompMessage, payload: state }]);
  });

  it("refuses messages a side may not send, from strangers, for unknown compositions and malformed ones", () => {
    const hub = new LinkedCompHub();
    const host = peer(1);
    const editor = peer(2);
    hub.register("c1", host, editor);
    // A window cannot push state at the editor, and the editor cannot send edits to the window.
    expect(hub.relay(2, { type: "state", compositionId: "c1", name: "n", revision: 1, template })).toBe(false);
    expect(hub.relay(1, { type: "edit", compositionId: "c1", baseRevision: 1, label: "x", template })).toBe(false);
    expect(hub.relay(99, { type: "hello", compositionId: "c1" })).toBe(false);
    expect(hub.relay(2, { type: "hello", compositionId: "other" })).toBe(false);
    expect(hub.relay(2, "nonsense")).toBe(false);
    expect(host.sent).toHaveLength(0);
    expect(editor.sent).toHaveLength(0);
  });

  it("drops oversized messages", () => {
    const hub = new LinkedCompHub();
    const host = peer(1);
    hub.register("c1", host, peer(2));
    const huge = { schemaVersion: 1, blob: "x".repeat(LINKED_COMP_MAX_MESSAGE_BYTES + 10) };
    expect(hub.relay(2, { type: "edit", compositionId: "c1", baseRevision: 1, label: "x", template: huge })).toBe(false);
    expect(host.sent).toHaveLength(0);
  });

  it("does not deliver to destroyed windows, and forgets windows that close", () => {
    const hub = new LinkedCompHub();
    const host = peer(1);
    const editor = peer(2);
    hub.register("c1", host, editor);
    editor.destroyed = true;
    expect(hub.editorOf("c1")).toBeUndefined();
    expect(hub.relay(1, { type: "gone", compositionId: "c1" })).toBe(false);
    editor.destroyed = false;
    expect(hub.isEditor(2)).toBe(true);
    expect(hub.isEditor(1)).toBe(false);
    expect(hub.unregister(2)).toEqual([]);
    expect(hub.relay(2, { type: "hello", compositionId: "c1" })).toBe(false);
  });

  it("closing the editor window orphans its composition windows", () => {
    const hub = new LinkedCompHub();
    const host = peer(1);
    const a = peer(2);
    const b = peer(3);
    hub.register("c1", host, a);
    hub.register("c2", host, b);
    expect(hub.unregister(1).map((p) => p.id).sort()).toEqual([2, 3]);
    expect(hub.isEditor(2)).toBe(false);
  });

  it("a window cannot be its own editor", () => {
    const hub = new LinkedCompHub();
    expect(() => hub.register("c1", peer(1), peer(1))).toThrow();
  });
});

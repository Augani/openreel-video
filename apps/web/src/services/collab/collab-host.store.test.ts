import "../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { CollabEngine, LoopbackHub, type CollabNotice } from "@openreel/collab";
import type { Action, Project } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { createProjectStoreHost } from "./collab-host";

const marker = (id: string, label: string, time = 1): Action => ({ type: "marker/add", id, timestamp: 1, params: { time, label, color: "#fff" } });

beforeEach(() => {
  const project = createEmptyProject("Shared", undefined, true);
  useProjectStore.getState().loadProject(project);
});

describe("project store host + engine (one real editor, one scripted peer)", () => {
  it("applies a collaborator's action to the open project without touching the undo stack", async () => {
    const hub = new LoopbackHub();
    const notices: CollabNotice[] = [];
    const host = createProjectStoreHost();
    const engine = new CollabEngine(host, { clientId: "me", name: "Me", key: "editor-key", send: hub.sender("me") });
    engine.onNotice((n) => notices.push(n));
    const unsubscribe = useProjectStore.getState().actionHistory.subscribeApplied((e) => engine.localApplied(e));
    hub.attach(engine, true);
    await hub.pump();
    expect(engine.getSnapshot().status).toBe("live");

    // A scripted second editor joins and authors an edit.
    const peer = new CollabEngine(createFakeHost(useProjectStore.getState().project), { clientId: "peer", name: "Peer", key: "editor-key", send: hub.sender("peer") });
    hub.attach(peer, true);
    await hub.pump();
    peer.localApplied({ kind: "edit", actions: [marker("peer-1", "from peer")] });
    await hub.pump();

    const state = useProjectStore.getState();
    expect(state.project.timeline.markers.map((m) => m.label)).toEqual(["from peer"]);
    expect(state.actionHistory.canUndo()).toBe(false);
    expect(notices).toEqual([]);

    // The user's own edit is undoable and is sent; undo does not remove the collaborator's marker.
    await state.executeAction(marker("mine-1", "mine", 2));
    await hub.pump();
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(1);
    await useProjectStore.getState().undo();
    await hub.pump();
    expect(useProjectStore.getState().project.timeline.markers.map((m) => m.label)).toEqual(["from peer"]);
    unsubscribe();
  });
});

/** The scripted peer only needs to author and apply on a plain project object. */
function createFakeHost(seed: Project) {
  let project = structuredClone({ ...seed, mediaLibrary: { items: [] } }) as Project;
  return {
    getProject: () => project,
    clone: (p: Project) => structuredClone(p),
    replaceProject: (next: Project) => {
      project = next;
    },
    projectChanged: () => undefined,
    applyAction: async (action: { type: string; id: string; timestamp: number; params: Record<string, unknown> }, p: Project) => {
      const { ActionExecutor } = await import("@openreel/core");
      return (await new ActionExecutor().applyRemote(action, p)).success;
    },
    serialize: (p: Project) => JSON.parse(JSON.stringify(p)),
    deserialize: (raw: unknown) => raw as Project,
  };
}

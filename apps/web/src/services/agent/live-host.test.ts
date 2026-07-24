import { describe, it, expect, beforeEach } from "vitest";
import type { Action } from "@openreel/core";
import { executeTool } from "@openreel/agent";
import type { EditorStateView } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { LiveEditorHost } from "./live-host";

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${type}`,
  timestamp: Date.now(),
  params,
});

describe("LiveEditorHost", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
  });

  it("drives the live store through the agent executor", async () => {
    const host = new LiveEditorHost();
    const before = useProjectStore.getState().project.timeline.tracks.length;

    const res = await executeTool("add_track", { trackType: "video" }, host);
    expect(res.ok).toBe(true);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before + 1);

    const state = (await executeTool("get_editor_state", {}, host)).data as EditorStateView;
    expect(state.trackCount).toBe(before + 1);
  });

  it("requireOpenProject throws when no project is open", () => {
    useProjectStore.setState({ hasOpenProject: false });
    const host = new LiveEditorHost();
    expect(() => host.getProject()).toThrow(/No project is open/);
  });

  it("rolls a transaction back as one unit", async () => {
    const host = new LiveEditorHost();
    const before = useProjectStore.getState().project.timeline.tracks.length;

    const txn = host.beginTransaction("turn");
    await host.applyAction(act("track/add", { trackType: "text" }));
    await host.applyAction(act("track/add", { trackType: "graphics" }));
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before + 2);

    await host.rollbackTransaction(txn);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before);
  });

  it("exposes the capability manifest", () => {
    const host = new LiveEditorHost();
    expect(host.capabilities().blendModes.length).toBeGreaterThan(0);
  });
});

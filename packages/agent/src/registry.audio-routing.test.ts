import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { ActionExecutor } from "@openreel/core/actions/action-executor";

const trackId = (host: HeadlessHost) => host.getProject().timeline.tracks[0].id;
const buses = (host: HeadlessHost) => host.getProject().timeline.audioBuses ?? [];

describe("agent audio routing tools", () => {
  it("registers the routing tools", () => {
    for (const name of ["create_bus", "update_bus", "remove_bus", "set_track_output", "add_send", "set_send_level", "export_stems"]) {
      expect(getTool(name)).toBeDefined();
    }
  });

  it("creates buses, assigns outputs and sends, edits levels and undoes each as one step", async () => {
    const history = new ActionHistory();
    const host = new HeadlessHost(makeProjectWithClip(), { history });
    const track = trackId(host);
    const dlg = await executeTool("create_bus", { name: "Dialogue", role: "dialogue" }, host);
    expect(dlg.ok).toBe(true);
    const dlgId = (dlg.data as { busId: string }).busId;
    const fx = await executeTool("create_bus", { name: "Reverb" }, host);
    const fxId = (fx.data as { busId: string }).busId;
    expect(buses(host).map((b) => b.name)).toEqual(["Dialogue", "Reverb"]);

    expect((await executeTool("set_track_output", { trackId: track, busId: dlgId }, host)).ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].output).toBe(dlgId);

    const added = await executeTool("add_send", { trackId: track, busId: fxId, level: 0.5, preFader: true }, host);
    expect(added.ok).toBe(true);
    const sendId = (added.data as { sendId: string }).sendId;
    expect(host.getProject().timeline.tracks[0].sends).toMatchObject([{ busId: fxId, level: 0.5, preFader: true }]);

    const level = await executeTool(
      "set_send_level",
      { trackId: track, sendId, level: 0.25, automation: [{ time: 0, value: 0 }, { time: 2, value: 1 }] },
      host,
    );
    expect(level.ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].sends?.[0]).toMatchObject({ level: 0.25, automation: [{ time: 0, value: 0 }, { time: 2, value: 1 }] });

    const before = JSON.stringify(host.getProject().timeline);
    const depth = history.getUndoStackSize();
    expect((await executeTool("set_send_level", { trackId: track, sendId, removeSend: true }, host)).ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(depth + 1);
    expect(host.getProject().timeline.tracks[0].sends).toBeUndefined();
    expect((await new ActionExecutor(history).undo(host.getProject())).success).toBe(true);
    expect(JSON.stringify(host.getProject().timeline)).toBe(before);
  });

  it("edits track fader and pan lanes as one undo step each and clears them", async () => {
    const history = new ActionHistory();
    const host = new HeadlessHost(makeProjectWithClip(), { history });
    const track = trackId(host);
    const depth = history.getUndoStackSize();
    const vol = await executeTool("set_track_automation", { trackId: track, lane: "volume", points: [{ time: 2, value: 9 }, { time: 0, value: 1 }] }, host);
    expect(vol.ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].automation?.volume).toEqual([{ time: 0, value: 1 }, { time: 2, value: 4 }]);
    expect((await executeTool("set_track_automation", { trackId: track, lane: "pan", points: [{ time: 1, value: -2 }] }, host)).ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].automation?.pan).toEqual([{ time: 1, value: -1 }]);
    expect(history.getUndoStackSize()).toBe(depth + 2);
    expect((await executeTool("set_track_automation", { trackId: track, lane: "volume", points: [] }, host)).ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].automation?.volume).toBeUndefined();
    expect((await new ActionExecutor(history).undo(host.getProject())).success).toBe(true);
    expect(host.getProject().timeline.tracks[0].automation?.volume).toHaveLength(2);
  });

  it("refuses an unknown track or lane for track automation", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    expect((await executeTool("set_track_automation", { trackId: "ghost", lane: "volume", points: [] }, host)).ok).toBe(false);
    expect((await executeTool("set_track_automation", { trackId: trackId(host), lane: "width", points: [] }, host)).ok).toBe(false);
  });

  it("refuses routing loops, unknown ids and a duplicate send with clear messages", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const a = (await executeTool("create_bus", { name: "Music" }, host)).data as { busId: string };
    const b = (await executeTool("create_bus", { name: "Dialogue", output: a.busId }, host)).data as { busId: string };
    const loop = await executeTool("update_bus", { busId: a.busId, output: b.busId }, host);
    expect(loop.ok).toBe(false);
    expect(loop.summary).toMatch(/routing loop/);
    expect((await executeTool("set_track_output", { trackId: trackId(host), busId: "ghost" }, host)).ok).toBe(false);
    expect((await executeTool("add_send", { trackId: trackId(host), busId: a.busId }, host)).ok).toBe(true);
    expect((await executeTool("add_send", { trackId: trackId(host), busId: a.busId }, host)).ok).toBe(false);
  });

  it("builds the Dialogue / Music / FX preset and removing a bus re-routes its tracks", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const preset = await executeTool("create_bus", { preset: "stems" }, host);
    expect(preset.ok).toBe(true);
    expect(buses(host).map((b) => b.name)).toEqual(["Dialogue", "Music", "FX"]);
    const music = buses(host)[1].id;
    await executeTool("set_track_output", { trackId: trackId(host), busId: music }, host);
    expect((await executeTool("remove_bus", { busId: music }, host)).ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].output).toBeUndefined();
  });

  it("export_stems fails clearly on a headless host", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const result = await executeTool("export_stems", {}, host);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNSUPPORTED_HOST");
  });

  it("the rack tools accept a bus id as target (fader and effects on a bus)", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const bus = (await executeTool("create_bus", { name: "Music" }, host)).data as { busId: string };
    const fader = await executeTool("set_track_audio_effect_param", { target: bus.busId, volume: 0.5, pan: -0.25 }, host);
    expect(fader.ok).toBe(true);
    expect(buses(host)[0].rack).toMatchObject({ volume: 0.5, pan: -0.25 });
    const fx = await executeTool("add_track_audio_effect", { target: bus.busId, effectType: "gain" }, host);
    expect(fx.ok).toBe(true);
    expect(buses(host)[0].rack?.effects).toHaveLength(1);
    expect((await executeTool("add_track_audio_effect", { target: "ghost", effectType: "gain" }, host)).ok).toBe(false);
  });

  it("update_bus refuses to silently drop fields combined with volumeAutomation", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const bus = (await executeTool("create_bus", { name: "Music" }, host)).data as { busId: string };
    const result = await executeTool("update_bus", { busId: bus.busId, muted: true, volumeAutomation: [{ time: 0, value: 1 }] }, host);
    expect(result.ok).toBe(false);
    expect(buses(host)[0].muted).toBe(false);
  });
});

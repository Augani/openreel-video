import { describe, it, expect } from "vitest";
import { getMaxRackEffects } from "@openreel/core/audio/track-audio-rack";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

const trackId = (host: HeadlessHost) => host.getProject().timeline.tracks[0].id;
const rackOf = (host: HeadlessHost, target = trackId(host)) =>
  target === "master"
    ? host.getProject().timeline.masterAudioRack
    : host.getProject().timeline.tracks.find((t) => t.id === target)?.audioRack;

describe("agent track audio rack tools", () => {
  it("registers the three tools", () => {
    for (const name of ["add_track_audio_effect", "set_track_audio_effect_param", "remove_track_audio_effect"]) {
      expect(getTool(name)).toBeDefined();
    }
  });

  it("adds, edits, bypasses and removes an effect", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const target = trackId(host);
    const added = await executeTool("add_track_audio_effect", { target, effectType: "limiter", params: { ceiling: -6 } }, host);
    expect(added.ok).toBe(true);
    const effectId = (added.data as { effectId: string }).effectId;
    expect(rackOf(host)?.effects[0]).toMatchObject({ type: "limiter", bypassed: false, params: { ceiling: -6 } });

    const edited = await executeTool("set_track_audio_effect_param", { target, effectId, params: { ceiling: -99 }, bypassed: true }, host);
    expect(edited.ok).toBe(true);
    expect(rackOf(host)?.effects[0].params.ceiling).toBe(-24);
    expect(rackOf(host)?.effects[0].bypassed).toBe(true);

    const fader = await executeTool("set_track_audio_effect_param", { target, volume: 0.5, pan: -0.25 }, host);
    expect(fader.ok).toBe(true);
    expect(rackOf(host)).toMatchObject({ volume: 0.5, pan: -0.25 });

    const removed = await executeTool("remove_track_audio_effect", { target, effectId }, host);
    expect(removed.ok).toBe(true);
    expect(rackOf(host)?.effects).toHaveLength(0);
  });

  it("reorders an effect, and refuses effect edits that name no effect", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const target = trackId(host);
    const a = await executeTool("add_track_audio_effect", { target, effectType: "gain" }, host);
    await executeTool("add_track_audio_effect", { target, effectType: "eq" }, host);
    const id = (a.data as { effectId: string }).effectId;
    const moved = await executeTool("set_track_audio_effect_param", { target, effectId: id, position: 1 }, host);
    expect(moved.ok).toBe(true);
    expect(rackOf(host)?.effects.map((e) => e.type)).toEqual(["eq", "gain"]);
    const orphan = await executeTool("set_track_audio_effect_param", { target, params: { gainDb: 3 } }, host);
    expect(orphan.ok).toBe(false);
  });

  it("works on the master bus and rejects an effect past the slot limit, bad types and unknown tracks", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    for (let i = 0; i < getMaxRackEffects(); i++) {
      expect((await executeTool("add_track_audio_effect", { target: "master", effectType: "gain" }, host)).ok).toBe(true);
    }
    expect(rackOf(host, "master")?.effects).toHaveLength(getMaxRackEffects());
    const overflow = await executeTool("add_track_audio_effect", { target: "master", effectType: "gain" }, host);
    expect(overflow.ok).toBe(false);
    expect((await executeTool("add_track_audio_effect", { target: trackId(host), effectType: "wah" }, host)).ok).toBe(false);
    expect((await executeTool("add_track_audio_effect", { target: "nope", effectType: "gain" }, host)).ok).toBe(false);
  });
});

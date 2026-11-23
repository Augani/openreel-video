import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectSerializer, nativePluginKeyframeProperty, pluginRackSteps, readNativePluginParams, type NativePluginDescriptor } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import {
  addNativePluginToRack,
  clearRackNativeParameterKeyframes,
  keyframeRackNativeParameter,
  moveRackNativePlugin,
  removeRackNativePlugin,
  updateRackNativePlugin,
} from "./native-plugin-host";
import { findProjectMissingPlugins } from "./native-plugin-report";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8"));
const serializer = new ProjectSerializer({} as never);
const steps = () => useProjectStore.getState().actionHistory.getDisplayHistory().length;
const timeline = () => useProjectStore.getState().project.timeline;
const delay: NativePluginDescriptor = { id: "au:aufx:dely:appl", format: "au", name: "AUDelay", vendor: "Apple", status: "ok", latencySamples: 0 };
const lowpass: NativePluginDescriptor = { id: "au:aufx:lpas:appl", format: "au", name: "AULowpass", vendor: "Apple", status: "ok" };

async function openProjectWithBus(): Promise<{ trackId: string; busId: string }> {
  const doc = structuredClone(fixture);
  useProjectStore.getState().loadProject(serializer.importFromJson(JSON.stringify(doc)));
  const trackId = timeline().tracks.find((t) => t.type === "audio")!.id;
  await useProjectStore.getState().applyAudioRouting({ ok: true, label: "Add bus", params: { buses: [{ id: "bus-1", name: "Music bus", muted: false, solo: false }] } } as never);
  return { trackId, busId: timeline().audioBuses?.[0]?.id ?? "bus-1" };
}

describe("hosted plugin racks on tracks and buses", () => {
  beforeEach(() => {
    useTimelineStore.setState({ playheadPosition: 0 } as never);
  });

  it("insert, edit, move, keyframe and remove are one undo step each, on a track and on a bus", async () => {
    const { trackId, busId } = await openProjectWithBus();
    for (const target of [trackId, busId]) {
      const before = steps();
      const first = (await addNativePluginToRack(target, delay))!;
      const second = (await addNativePluginToRack(target, lowpass))!;
      expect(steps()).toBe(before + 2);
      await updateRackNativePlugin(target, first, { values: { "0": 60 }, state: "YnBsaXN0MDA=", latencySamples: 9 });
      expect(steps()).toBe(before + 3);
      useTimelineStore.setState({ playheadPosition: 1 } as never);
      expect(await keyframeRackNativeParameter(target, first, "0", 10)).toBe(true);
      useTimelineStore.setState({ playheadPosition: 3 } as never);
      expect(await keyframeRackNativeParameter(target, first, "0", 90)).toBe(true);
      expect(steps(), "one undo step per keyframe insert").toBe(before + 5);
      expect(await keyframeRackNativeParameter(target, first, "0", 95, 3.002)).toBe(true);
      expect(steps(), "an edit within 10 ms of a key edits it, one step").toBe(before + 6);
      await moveRackNativePlugin(target, second, 0);
      expect(steps()).toBe(before + 7);
      const rack = () => (timeline().tracks.find((t) => t.id === target) ?? timeline().audioBuses!.find((b) => b.id === target)!).pluginRack!;
      expect(rack().plugins.map((p) => p.id)).toEqual([second, first]);
      expect(rack().keyframes!.map((k) => [k.property, k.time, k.value])).toEqual([[nativePluginKeyframeProperty(first, "0"), 1, 10], [nativePluginKeyframeProperty(first, "0"), 3, 95]]);
      // the steps the render uses carry the lane in timeline seconds
      expect(pluginRackSteps(rack()).find((s) => s.effectId === first)?.automation["0"]).toEqual([[1, 10], [3, 95]]);

      await clearRackNativeParameterKeyframes(target, first, "0");
      expect(rack().keyframes).toBeUndefined();
      await useProjectStore.getState().undo();
      expect(rack().keyframes).toHaveLength(2);
      const beforeRemove = steps();
      await removeRackNativePlugin(target, first);
      expect(steps(), "removing a plugin and its keyframes is one step").toBe(beforeRemove + 1);
      expect(rack().plugins.map((p) => p.id)).toEqual([second]);
      expect(rack().keyframes).toBeUndefined();
      await useProjectStore.getState().undo();
      expect(rack().keyframes).toHaveLength(2);
    }
  });

  it("the rack, its state chunk, values and keyframes persist with the project file", async () => {
    const { trackId, busId } = await openProjectWithBus();
    const onTrack = (await addNativePluginToRack(trackId, delay))!;
    await addNativePluginToRack(busId, lowpass);
    await updateRackNativePlugin(trackId, onTrack, { state: "YnBsaXN0MDA=", values: { "1": 0.12 } });
    useTimelineStore.setState({ playheadPosition: 2 } as never);
    await keyframeRackNativeParameter(trackId, onTrack, "1", 0.5);
    const saved = serializer.exportToJson(useProjectStore.getState().getFullProject());
    useProjectStore.getState().loadProject(serializer.importFromJson(saved));
    const track = timeline().tracks.find((t) => t.id === trackId)!;
    expect(readNativePluginParams(track.pluginRack!.plugins[0])).toMatchObject({ pluginId: delay.id, name: "AUDelay", state: "YnBsaXN0MDA=", values: { "1": 0.12 } });
    expect(track.pluginRack!.keyframes).toHaveLength(1);
    expect(timeline().audioBuses![0].pluginRack!.plugins[0].params.pluginId).toBe(lowpass.id);
    expect(track.pluginRack!.plugins[0].params).not.toHaveProperty("automation");
  });

  it("reports plugins on tracks and buses that cannot run, and never drops them", async () => {
    const { trackId, busId } = await openProjectWithBus();
    await addNativePluginToRack(trackId, delay);
    await addNativePluginToRack(busId, lowpass);
    expect(findProjectMissingPlugins(new Set([delay.id, lowpass.id]))).toEqual([]);
    const missing = findProjectMissingPlugins(new Set([delay.id]), new Map([[lowpass.id, "blocked after a crash"]]));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ rackTarget: busId, name: "AULowpass", reason: "blocked after a crash" });
    expect(missing[0].clipId).toBeUndefined();
    expect(findProjectMissingPlugins(null)).toHaveLength(2);
    expect(timeline().audioBuses![0].pluginRack?.plugins).toHaveLength(1);
  });

  it("refuses a keyframe before the timeline start and unknown targets", async () => {
    const { trackId } = await openProjectWithBus();
    const effectId = (await addNativePluginToRack(trackId, delay))!;
    expect(await keyframeRackNativeParameter(trackId, effectId, "0", 1, -1)).toBe(false);
    expect(await addNativePluginToRack("nope", delay)).toBeNull();
    expect(await removeRackNativePlugin("nope", effectId)).toBe(false);
  });
});

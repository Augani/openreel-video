import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NativePluginCancelledError,
  NativePluginRenderError,
  NativePluginUnavailableError,
  ProjectSerializer,
  getNativePluginEffects,
  nativePluginKeyframeProperty,
  nativePluginSteps,
  readNativePluginParams,
  resolveClipAudioEffects,
  type Clip,
  type NativePluginDescriptor,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { addNativePluginToClip, keyframeNativePluginParameter, removeNativePluginFromClip, setNativePluginPreviewBypass, updateNativePlugin } from "./native-plugin-host";
import { findProjectMissingPlugins } from "./native-plugin-report";
import { createDesktopNativePluginBackend } from "./native-plugin-backend";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8"));
const serializer = new ProjectSerializer({} as never);
const clipOf = (id: string): Clip => useProjectStore.getState().getClip(id)!;
const steps = () => useProjectStore.getState().actionHistory.getDisplayHistory().length;
const plugin: NativePluginDescriptor = { id: "au:aufx:dely:appl", format: "au", name: "AUDelay", vendor: "Apple", status: "ok", latencySamples: 0 };

function openProject(): string {
  const doc = structuredClone(fixture);
  const tracks = doc.project.timeline.tracks as Array<{ name: string; clips: Array<Record<string, unknown>> }>;
  const music = tracks.find((t) => t.name === "Music")!;
  const dialogue = tracks.find((t) => t.name === "Dialogue")!;
  dialogue.clips = [{ ...music.clips[0], id: "clip-plugin", trackId: (dialogue as unknown as { id: string }).id, startTime: 1, duration: 4, inPoint: 2, outPoint: 6, volume: 1, audioEffects: [], keyframes: [] }];
  useProjectStore.getState().loadProject(serializer.importFromJson(JSON.stringify(doc)));
  return "clip-plugin";
}

describe("hosted plugin editing", () => {
  beforeEach(() => {
    useTimelineStore.setState({ playheadPosition: 0 } as never);
  });

  it("adding, editing and removing a plugin are undoable steps, and the state chunk persists with the project", async () => {
    const id = openProject();
    const before = steps();
    const effectId = (await addNativePluginToClip(id, plugin))!;
    expect(steps()).toBe(before + 1);
    expect(getNativePluginEffects(clipOf(id).audioEffects)).toHaveLength(1);
    await updateNativePlugin(id, effectId, { state: "YnBsaXN0MDA=", values: { "0": 75 }, latencySamples: 12 });
    expect(steps()).toBe(before + 2);
    const saved = serializer.exportToJson(useProjectStore.getState().getFullProject());
    await useProjectStore.getState().undo();
    expect(readNativePluginParams(getNativePluginEffects(clipOf(id).audioEffects)[0]).state).toBeUndefined();
    await useProjectStore.getState().undo();
    expect(getNativePluginEffects(clipOf(id).audioEffects)).toHaveLength(0);
    // the saved project still carries the plugin, its state chunk and its values; opening it brings them back
    useProjectStore.getState().loadProject(serializer.importFromJson(saved));
    expect(readNativePluginParams(getNativePluginEffects(clipOf(id).audioEffects)[0])).toMatchObject({ pluginId: plugin.id, name: "AUDelay", state: "YnBsaXN0MDA=", values: { "0": 75 }, latencySamples: 12 });
  });

  it("automates a parameter with ordinary clip keyframes that preview and export both resolve into the same lane", async () => {
    const id = openProject();
    const effectId = (await addNativePluginToClip(id, plugin))!;
    useTimelineStore.setState({ playheadPosition: 1 } as never);
    expect(keyframeNativePluginParameter(id, effectId, "0", 10)).toBe(true);
    useTimelineStore.setState({ playheadPosition: 3 } as never);
    expect(keyframeNativePluginParameter(id, effectId, "0", 90)).toBe(true);
    expect(clipOf(id).keyframes.map((k) => [k.property, k.time, k.value])).toEqual([
      [nativePluginKeyframeProperty(effectId, "0"), 0, 10],
      [nativePluginKeyframeProperty(effectId, "0"), 2, 90],
    ]);
    useTimelineStore.setState({ playheadPosition: 0 } as never);
    expect(keyframeNativePluginParameter(id, effectId, "0", 1)).toBe(false);
    const resolved = resolveClipAudioEffects(clipOf(id), useProjectStore.getState().project.timeline);
    expect(nativePluginSteps(resolved)[0].automation).toEqual({ "0": [[2, 10], [4, 90]] });
    expect(getNativePluginEffects(clipOf(id).audioEffects)[0].params).not.toHaveProperty("automation");
  });

  it("removing a plugin removes its keyframes in the same undo step", async () => {
    const id = openProject();
    const effectId = (await addNativePluginToClip(id, plugin))!;
    useTimelineStore.setState({ playheadPosition: 2 } as never);
    keyframeNativePluginParameter(id, effectId, "0", 5);
    const before = steps();
    await removeNativePluginFromClip(id, effectId);
    expect(getNativePluginEffects(clipOf(id).audioEffects)).toHaveLength(0);
    expect(clipOf(id).keyframes).toHaveLength(0);
    expect(steps()).toBe(before + 1);
    await useProjectStore.getState().undo();
    expect(getNativePluginEffects(clipOf(id).audioEffects)).toHaveLength(1);
    expect(clipOf(id).keyframes).toHaveLength(1);
  });

  it("Hear dry is a preview-only bypass: the effect stays enabled for the export", async () => {
    const id = openProject();
    const effectId = (await addNativePluginToClip(id, plugin))!;
    setNativePluginPreviewBypass(id, effectId, true);
    const effect = getNativePluginEffects(clipOf(id).audioEffects)[0];
    expect(effect.metadata?.previewBypass).toBe(true);
    expect(effect.enabled).toBe(true);
  });

  it("lists the plugins a project uses that the host cannot run, with the reason, without touching the project", async () => {
    const id = openProject();
    await addNativePluginToClip(id, plugin);
    await addNativePluginToClip(id, { ...plugin, id: "au:aufx:gone:none", name: "Gone Reverb" });
    const missing = findProjectMissingPlugins(new Set([plugin.id]), new Map());
    expect(missing).toEqual([expect.objectContaining({ clipId: id, name: "Gone Reverb", reason: "it is not installed on this computer" })]);
    expect(findProjectMissingPlugins(new Set(), new Map([["au:aufx:gone:none", "crashed during the scan"]])).map((m) => m.reason)).toEqual(["it is not installed on this computer", "crashed during the scan"]);
    expect(findProjectMissingPlugins(null)[0].reason).toMatch(/desktop app/);
    expect(getNativePluginEffects(clipOf(id).audioEffects)).toHaveLength(2);
  });
});

describe("desktop render backend", () => {
  const request = { pluginId: plugin.id, values: { "0": 1 }, automation: { "0": [[0, 1] as const] }, channels: [new Float32Array(4)], sampleRate: 48000 };

  it("is null in the browser build", () => {
    delete (window as unknown as { openreel?: unknown }).openreel;
    expect(createDesktopNativePluginBackend()).toBeNull();
  });

  it("maps the main process outcome onto the cache's error classes", async () => {
    const render = vi.fn();
    (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", plughost: { render, cancel: vi.fn(), onProgress: () => () => undefined } };
    const backend = createDesktopNativePluginBackend()!;
    render.mockResolvedValueOnce({ ok: true, result: { channels: [new Float32Array(4)], latencySamples: 3 } });
    expect((await backend.render(request)).latencySamples).toBe(3);
    render.mockResolvedValueOnce({ ok: false, kind: "unavailable", message: "not installed" });
    await expect(backend.render(request)).rejects.toBeInstanceOf(NativePluginUnavailableError);
    render.mockResolvedValueOnce({ ok: false, kind: "failed", message: "SIGSEGV" });
    await expect(backend.render(request)).rejects.toBeInstanceOf(NativePluginRenderError);
    render.mockResolvedValueOnce({ ok: false, kind: "cancelled" });
    await expect(backend.render(request)).rejects.toBeInstanceOf(NativePluginCancelledError);
    delete (window as unknown as { openreel?: unknown }).openreel;
  });
});

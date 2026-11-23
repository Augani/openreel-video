/**
 * A TRACK plugin rack rendered through the merged VST3 helper: the Steinberg SDK's own "adelay" example (built by
 * scripts/build-vst3-testplugins.mjs into a temp folder, never committed) is scanned by the host service, added to a track's
 * rack, and the track's stem is resolved the way the export mixdown and the live preview resolve it (resolveRackStems + the
 * shared render cache). The format spawner must pick the VST3 helper for the VST3 id, the stem must equal adelay's analytic
 * output, a second resolve must be a cache hit (no second helper run), the render must be labelled with the track's name (what
 * the background-task panel titles the row with), and moving a clip of the track must re-render.
 *
 * Needs the built VST3 helper, CMake and the pinned SDK (cached under apps/desktop/.cache); skipped when any is missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audioRangeFingerprint } from "../../../packages/core/src/audio/mixdown-cache";
import { NativePluginRenderCache } from "../../../packages/core/src/audio/native-plugin/native-plugin-cache";
import { planAddRackPlugin, planUpdateRackPlugin, pluginRackSteps } from "../../../packages/core/src/audio/native-plugin/native-plugin-rack";
import { RackStemCache, resolveRackStems } from "../../../packages/core/src/audio/native-plugin/rack-stems";
import {
  NativePluginCancelledError,
  NativePluginRenderError,
  NativePluginUnavailableError,
  type NativePluginBackend,
  type NativePluginStep,
} from "../../../packages/core/src/audio/native-plugin/native-plugin-types";
import type { Clip, Project, Track } from "../../../packages/core/src/types";
// @ts-expect-error plain .mjs build script without types
import { buildTestPlugins } from "../scripts/build-vst3-testplugins.mjs";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { formatHelperSpawner } from "../src/main/plughost/helper-path";
import { PlugHostService } from "../src/main/plughost/host-service";

const exe = process.platform === "win32" ? "openreel-vst3host.exe" : "openreel-vst3host";
const HELPER = process.env.OPENREEL_VST3HOST_PATH ?? path.resolve(__dirname, `../resources/vst3host/${process.platform}-${process.arch}/${exe}`);
const enabled = existsSync(HELPER) && spawnSync("cmake", ["--version"], { stdio: "ignore" }).status === 0;
const d = enabled ? describe : describe.skip;

const SR = 8000;
const DELAY_ID = "vst3:0CDBB66985D548A9BFD8371909D24BB3";
const DELAY_PARAM = "100";
const DELAY = 0.0125; // normalized seconds: D = trunc(0.0125 * 8000) = 100 samples

let work = "";
let service: PlugHostService | null = null;
/** The format of every "serve" helper the host asked for ("none:" = no binary for it). */
const requestedFormats: Array<string | undefined> = [];
let renders = 0;

beforeAll(async () => {
  if (!enabled) return;
  work = mkdtempSync(path.join(os.tmpdir(), "trackrack-vst3-"));
  const folder: string = (await buildTestPlugins(path.join(work, "plugins"), { log: () => undefined })) ?? "";
  const spawner = formatHelperSpawner({ au: null, vst3: HELPER });
  service = new PlugHostService({
    helper: (mode, format) => {
      const spawn = spawner(mode, format);
      if (mode === "serve") requestedFormats.push(spawn ? format : `none:${format}`);
      return spawn;
    },
    blocklist: new PluginBlocklist(path.join(work, "bl.json")),
    vst3Roots: [folder],
    probeTimeoutMs: 6000,
  });
}, 300_000);
afterAll(() => {
  service?.dispose();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** The renderer's backend as the desktop bridge builds it: one host-service job per render. */
const backend: NativePluginBackend = {
  async render(request, options) {
    renders += 1;
    const outcome = await service!.render(`job-${renders}`, request, options?.onProgress);
    if (outcome.ok && outcome.result) return outcome.result;
    if (outcome.kind === "unavailable") throw new NativePluginUnavailableError(request.pluginId, outcome.message ?? "unavailable");
    if (outcome.kind === "cancelled") throw new NativePluginCancelledError();
    throw new NativePluginRenderError(outcome.message ?? "failed");
  },
};

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "media", trackId, startTime, duration, inPoint: 0, outPoint: duration, effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const audioBuffer = (channels: Float32Array[]): AudioBuffer =>
  ({ numberOfChannels: channels.length, sampleRate: SR, length: channels[0].length, duration: channels[0].length / SR, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;
const noise = (frames: number): Float32Array[] =>
  [0, 1].map((ch) => {
    let s = 7 + ch * 1000;
    return Float32Array.from({ length: frames }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return ((s >>> 8) / 16777216 - 0.5) * 0.8;
    });
  });

function projectWithRack(clips: Clip[]): Project {
  const owner = { id: "drums" };
  const added = planAddRackPlugin(owner, { id: DELAY_ID, format: "vst3", name: "ADelay", vendor: "Steinberg" }, { actionId: "a1", effectId: "fx1" })!;
  const rack = added.params.rack as NonNullable<Track["pluginRack"]>;
  const edited = planUpdateRackPlugin({ id: "drums", pluginRack: rack }, "fx1", { values: { [DELAY_PARAM]: DELAY } }, { actionId: "a2" })!;
  const track = { id: "drums", name: "Drums", type: "audio", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, pluginRack: edited.params.rack } as unknown as Track;
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: SR, channels: 2 },
    mediaLibrary: { items: [{ id: "media", name: "m.wav", type: "audio", blob: null, metadata: { duration: 60 } }] },
    timeline: { duration: 1, markers: [], subtitles: [], tracks: [track] },
  } as unknown as Project;
}

d("track plugin rack on the VST3 helper", () => {
  it("renders the track's stem through the SDK adelay plugin, labelled with the track's name, cached, and re-rendered when a clip moves", async () => {
    const scan = await service!.scanNow();
    expect(scan.plugins.find((p) => p.id === DELAY_ID)).toMatchObject({ format: "vst3", status: "ok" });
    requestedFormats.length = 0; // only what the render itself asks for from here on

    const cache = new NativePluginRenderCache({ backend, makeBuffer: (channels) => audioBuffer(channels) });
    const labels: Array<string | undefined> = [];
    cache.onStatus((buffer, status) => {
      if (status.state === "running") labels.push(cache.labelFor(buffer));
    });
    const dry = noise(SR); // one second
    const stems = new RackStemCache();
    const renderedDry: number[] = [];
    const deps = {
      renderStem: async (_project: Project, seconds: number) => {
        renderedDry.push(seconds);
        return audioBuffer(dry);
      },
      runChain: async (buffer: AudioBuffer, steps: readonly NativePluginStep[], label: string) => {
        const outcome = await cache.request(buffer, steps, { label });
        return { buffer: outcome.buffer, bypassed: outcome.bypassed };
      },
      fingerprint: (p: Project, seconds: number) => audioRangeFingerprint(p, 0, seconds),
      hasHost: true,
      audibility: new Map<string, boolean>(),
      preview: false,
    };

    const project = projectWithRack([clip("c1", "drums", 0, 1)]);
    expect(pluginRackSteps(project.timeline.tracks[0].pluginRack)[0].values).toEqual({ [DELAY_PARAM]: DELAY });
    renderedDry.length = 0;
    const first = await resolveRackStems(project, deps, stems);
    const result = first.get("drums")!;
    expect(result.allBypassed, [...result.bypassed.values()].join("; ")).toBe(false);
    expect(requestedFormats, "the VST3 id was routed to the VST3 helper").toContain("vst3");
    expect(requestedFormats.filter((f) => f?.startsWith("none:")), "no render ever asked for a helper that does not exist").toEqual([]);
    expect(labels, "the stem render is labelled with the track name for the task panel").toContain("Track Drums");

    const wet = result.buffer!;
    for (let c = 0; c < 2; c += 1) {
      const out = wet.getChannelData(c);
      for (let n = 0; n < dry[c].length; n += 1) {
        const expected = n >= 100 ? dry[c][n - 100] : 0;
        if (out[n] !== expected) throw new Error(`channel ${c} sample ${n}: ${out[n]} != adelay's ${expected}`);
      }
    }

    const rendersBefore = renders;
    const again = await resolveRackStems(project, deps, stems);
    expect(again.get("drums")).toBe(result);
    expect(renders, "a second resolve is a cache hit: no helper run").toBe(rendersBefore);

    const moved = projectWithRack([clip("c1", "drums", 0.25, 0.5)]);
    const third = await resolveRackStems(moved, deps, stems);
    expect(third.get("drums")).not.toBe(result);
    expect(renderedDry.length, "the dry stem was re-rendered after the clip timing changed").toBe(2);
  }, 120_000);
});

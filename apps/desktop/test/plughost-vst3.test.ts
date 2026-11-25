/**
 * VST3 side of the plugin host on the protocol mock (runs on every platform, no plugin or native helper needed): the scanner
 * probes bundles with the VST3 helper and replaces the path-derived id with the class id the plugin reports, crash/hang/refusal
 * handling and the blocklist work for VST3 exactly as for Audio Units, renders send the bundle path, and the two helpers answer
 * the shared protocol the same way.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NativePluginRenderRequest } from "../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { formatHelperSpawner, resolveVst3hostPath, vst3hostRelativePath } from "../src/main/plughost/helper-path";
import { HelperProcess } from "../src/main/plughost/helper-process";
import { PlugHostService } from "../src/main/plughost/host-service";
import { vst3SearchPaths } from "../src/main/plughost/scan-paths";
import { scanPlugins } from "../src/main/plughost/scanner";

const MOCK = path.resolve(__dirname, "fixtures/mock-plughost.mjs");
const mock = (mode: string) => ({ command: process.execPath, args: [MOCK, mode] });
const vst3Only = (mode: string, format?: string) => (format === "vst3" ? mock(mode) : null);

let work = "";
let folder = "";
const bundle = (name: string) => path.join(folder, `${name}.vst3`);
beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), "plughost-vst3-"));
  folder = path.join(work, "VST3");
  for (const name of ["MockGain", "MockLatency", "MockCrash", "MockHang", "MockLateCrash", "NotAPlugin"]) mkdirSync(path.join(folder, `${name}.vst3`, "Contents"), { recursive: true });
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

const classIdOf = (name: string): string => Buffer.from(name).toString("hex").toUpperCase().padEnd(32, "0").slice(0, 32);
const signal = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 20) * 0.5);
const request = (pluginId: string, channels: Float32Array[], extra: Partial<NativePluginRenderRequest> = {}): NativePluginRenderRequest => ({ pluginId, values: {}, automation: {}, channels, sampleRate: 48000, ...extra });

describe("VST3 scan through the helper", () => {
  it("probes every bundle in its own process, takes the class id from the loaded plugin, and blocks crashes and hangs", async () => {
    const blocklist = new PluginBlocklist(path.join(work, "bl-scan.json"));
    const result = await scanPlugins({ helper: vst3Only, blocklist, vst3Roots: [folder], probeTimeoutMs: 4000 });
    const byName = new Map(result.plugins.map((p) => [p.path ? path.basename(p.path, ".vst3") : p.name, p]));
    expect(byName.get("MockGain")).toMatchObject({ id: `vst3:${classIdOf("MockGain")}`, format: "vst3", name: "MockGain", vendor: "MockVendor", version: "1.2.3", status: "ok", latencySamples: 0, parameterCount: 1, path: bundle("MockGain") });
    expect(byName.get("MockLatency")).toMatchObject({ status: "ok", latencySamples: 128 });
    expect(byName.get("MockCrash")).toMatchObject({ format: "vst3", status: "blocked", statusReason: expect.stringMatching(/SIGSEGV|access violation/) });
    expect(byName.get("MockHang")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/did not answer/) });
    // a bundle the helper cannot load is reported for this scan only (a refusal, not a crash)
    expect(byName.get("NotAPlugin")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/could not be loaded/) });
    // crashes and hangs are remembered; the refusal is not
    expect(blocklist.list().map((e) => e.kind).sort()).toEqual(["crash", "timeout"]);
  }, 30_000);

  it("remembers a crashing bundle and does not load it again on the next scan", async () => {
    const blocklist = new PluginBlocklist(path.join(work, "bl-scan2.json"));
    await scanPlugins({ helper: vst3Only, blocklist, vst3Roots: [folder], probeTimeoutMs: 4000 });
    const crashId = blocklist.list().find((e) => /SIGSEGV|access violation/.test(e.reason))?.id;
    expect(crashId).toMatch(/^vst3:/);
    const before = blocklist.get(crashId as string);
    const second = await scanPlugins({ helper: vst3Only, blocklist, vst3Roots: [folder], probeTimeoutMs: 4000 });
    expect(blocklist.get(crashId as string)?.count, "a blocked bundle is not probed (and so not crashed) again").toBe(before?.count);
    expect(second.plugins.find((p) => p.id === crashId)?.status).toBe("blocked");
    await blocklist.remove(crashId as string);
    await scanPlugins({ helper: vst3Only, blocklist, vst3Roots: [folder], probeTimeoutMs: 4000 });
    expect(blocklist.get(crashId as string)?.count, "unblocked, it is probed (and crashes) again").toBe(1);
  }, 60_000);

  it("lists bundles as unsupported when this build has no VST3 helper", async () => {
    const result = await scanPlugins({ helper: (mode, format) => (format === "vst3" ? null : mock(mode)), blocklist: new PluginBlocklist(path.join(work, "bl-none.json")), vst3Roots: [folder], probeTimeoutMs: 4000 });
    const vst3 = result.plugins.filter((p) => p.format === "vst3");
    expect(vst3).toHaveLength(6);
    for (const p of vst3) expect(p).toMatchObject({ status: "unsupported", statusReason: expect.stringMatching(/no VST3 host helper/) });
    expect(result.plugins.some((p) => p.format === "au" && p.status === "ok")).toBe(true);
  }, 30_000);
});

describe("VST3 render through the host service", () => {
  const service = () => new PlugHostService({ helper: vst3Only, blocklist: new PluginBlocklist(path.join(work, `bl-${Math.random()}.json`)), vst3Roots: [folder], probeTimeoutMs: 4000 });

  it("sends the bundle path to the helper, renders, and compensates the reported latency", async () => {
    const host = service();
    const id = `vst3:${classIdOf("MockLatency")}`;
    const input = signal(3000);
    const out = await host.render("v1", request(id, [input, input], { values: { "0": 0.5 } }));
    expect(out).toMatchObject({ ok: true, result: { latencySamples: 128 } });
    expect(out.result?.channels[0]).toHaveLength(3000);
    for (let i = 0; i < 3000; i += 97) expect(out.result?.channels[0][i]).toBeCloseTo(input[i] * 0.5, 6);
    const described = await host.describe(id);
    expect(described).toMatchObject({ latencySamples: 128, parameters: [expect.objectContaining({ key: "0" })] });
  }, 30_000);

  it("fails a mid-render crash loudly, blocks the class id it was rendered under, and keeps the rest usable", async () => {
    const host = service();
    await host.scanNow();
    // MockLateCrash passes the probe (which renders 8 blocks only in the real helper; the mock probe does not render) and dies on block 3.
    const id = `vst3:${classIdOf("MockLateCrash")}`;
    expect(host.usableIds().has(id)).toBe(true);
    const failed = await host.render("v2", request(id, [signal(20000)]));
    expect(failed).toMatchObject({ ok: false, kind: "failed", message: expect.stringMatching(/SIGSEGV|access violation/) });
    expect(host.usableIds().has(id)).toBe(false);
    expect(await host.render("v3", request(id, [signal(2000)]))).toMatchObject({ ok: false, kind: "unavailable" });
    expect(host.usableIds().has(`vst3:${classIdOf("MockGain")}`)).toBe(true);
  }, 30_000);

  it("is unavailable, not failed, when the VST3 helper is missing", async () => {
    const host = new PlugHostService({ helper: () => null, blocklist: new PluginBlocklist(path.join(work, "bl-x.json")), vst3Roots: [folder] });
    expect(await host.render("v4", request(`vst3:${classIdOf("MockGain")}`, [signal(100)]))).toMatchObject({ ok: false, kind: "unavailable" });
  });
});

describe("one protocol, two helpers", () => {
  it("answers hello, unknown messages and out-of-order requests with the same shapes (mock stands in for both)", async () => {
    const helper = new HelperProcess(mock("serve"));
    const hello = await helper.start();
    expect(Object.keys(hello).sort()).toEqual(["formats", "helper", "platform", "protocol", "reqId", "type", "version"].filter((k) => k in hello));
    expect(hello).toMatchObject({ type: "ready", protocol: 1 });
    await expect(helper.request({ type: "block", frames: 4 }, 3000, new Uint8Array(32))).rejects.toMatchObject({ kind: "plugin", message: "no plugin is open" });
    await expect(helper.request({ type: "frobnicate" }, 3000)).rejects.toMatchObject({ kind: "plugin", message: expect.stringMatching(/unknown message type/) });
    await expect(helper.request({ type: "open", id: `vst3:${classIdOf("MockGain")}`, sampleRate: 48000, channels: 2, maxBlock: 512 }, 3000)).rejects.toMatchObject({ kind: "plugin", message: expect.stringMatching(/needs the path/) });
    helper.kill();
  });

  it("builds helper command lines by format", () => {
    const spawn = formatHelperSpawner({ au: "/x/plughost", vst3: "/x/vst3host" });
    expect(spawn("serve")).toMatchObject({ command: "/x/plughost", args: ["serve"] });
    expect(spawn("ui", "vst3")).toMatchObject({ command: "/x/vst3host", args: ["ui"] });
    expect(formatHelperSpawner({ au: "/x/plughost", vst3: null })("serve", "vst3")).toBeNull();
  });

  it("finds the bundled VST3 helper per platform, honours the dev override only unpackaged", () => {
    expect(vst3hostRelativePath("darwin", "arm64")).toBe("darwin-arm64/openreel-vst3host");
    expect(vst3hostRelativePath("win32", "x64")).toBe("win32-x64/openreel-vst3host.exe");
    const exists = () => true;
    expect(resolveVst3hostPath({ platform: "darwin", arch: "arm64", isPackaged: true, resourcesPath: "/App/Resources", dirname: "/d", exists })).toBe(path.join("/App/Resources", "vst3host", "darwin-arm64/openreel-vst3host"));
    expect(resolveVst3hostPath({ platform: "darwin", arch: "arm64", isPackaged: false, resourcesPath: "/r", dirname: "/repo/apps/desktop/dist/main", exists })).toBe(path.join("/repo/apps/desktop/resources/vst3host", "darwin-arm64/openreel-vst3host"));
    expect(resolveVst3hostPath({ isPackaged: false, resourcesPath: "/r", dirname: "/d", env: { OPENREEL_VST3HOST_PATH: "/custom/host" }, exists })).toBe("/custom/host");
    expect(resolveVst3hostPath({ isPackaged: true, resourcesPath: "/R", dirname: "/d", platform: "linux", arch: "x64", env: { OPENREEL_VST3HOST_PATH: "/custom/host" }, exists })).toBe(path.join("/R", "vst3host", "linux-x64/openreel-vst3host"));
    expect(resolveVst3hostPath({ platform: "darwin", arch: "arm64", isPackaged: true, resourcesPath: "/R", dirname: "/d", exists: () => false })).toBeNull();
  });

  it("adds OPENREEL_VST3_PATH folders after the standard VST3 locations", () => {
    const sep = path.posix.delimiter;
    expect(vst3SearchPaths({ platform: "darwin", home: "/Users/a", env: { OPENREEL_VST3_PATH: `/tmp/one${sep}/tmp/two` } })).toEqual(["/Library/Audio/Plug-Ins/VST3", "/Users/a/Library/Audio/Plug-Ins/VST3", "/tmp/one", "/tmp/two"]);
  });
});

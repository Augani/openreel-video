import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { HelperError, HelperProcess } from "../src/main/plughost/helper-process";
import { discoverVst3, vst3SearchPaths, audioUnitSearchPaths } from "../src/main/plughost/scan-paths";
import { probePlugin, scanPlugins } from "../src/main/plughost/scanner";

const MOCK = path.resolve(__dirname, "fixtures/mock-plughost.mjs");
const spawnOptions = (mode = "serve") => ({ command: process.execPath, args: [MOCK, mode] });
let work = "";
beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), "plughost-scan-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("helper process isolation", () => {
  it("turns a segfault into a rejected request naming the signal", async () => {
    const helper = new HelperProcess(spawnOptions());
    await helper.start();
    await expect(helper.request({ type: "probe", id: "au:aufx:cras:mock" }, 5000)).rejects.toMatchObject({ kind: "crash", message: expect.stringMatching(/SIGSEGV|access violation/) });
    expect(helper.alive).toBe(false);
  });

  it("kills a hung plugin at the deadline", async () => {
    const helper = new HelperProcess(spawnOptions());
    await helper.start();
    const started = Date.now();
    await expect(helper.request({ type: "probe", id: "au:aufx:hang:mock" }, 400)).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(helper.alive).toBe(false);
  });

  it("treats garbage on the pipe as a protocol failure, and a missing binary as a spawn failure", async () => {
    const junk = new HelperProcess(spawnOptions());
    await junk.start();
    await expect(junk.request({ type: "probe", id: "au:aufx:junk:mock" }, 5000)).rejects.toBeInstanceOf(HelperError);
    junk.kill();
    const missing = new HelperProcess({ command: path.join(work, "does-not-exist"), args: [] });
    await expect(missing.start(2000)).rejects.toMatchObject({ kind: "spawn" });
  });
});

describe("blocklist", () => {
  it("persists, counts repeat offenders, and gives a new plugin version a fresh chance", async () => {
    const file = path.join(work, "block", "list.json");
    const list = new PluginBlocklist(file, () => 1234);
    await list.add("au:aufx:cras:mock", "crash", "SIGSEGV", "1.0");
    await list.add("au:aufx:cras:mock", "crash", "SIGSEGV again", "1.0");
    const reloaded = new PluginBlocklist(file);
    await reloaded.load();
    expect(reloaded.get("au:aufx:cras:mock", "1.0")).toMatchObject({ kind: "crash", count: 2, reason: "SIGSEGV again", at: 1234 });
    expect(reloaded.has("au:aufx:cras:mock", "2.0")).toBe(false);
    expect(await reloaded.remove("au:aufx:cras:mock")).toBe(true);
    expect(await reloaded.remove("au:aufx:cras:mock")).toBe(false);
    const again = new PluginBlocklist(file);
    await again.load();
    expect(again.list()).toEqual([]);
  });

  it("starts empty from a corrupt file instead of refusing to scan", async () => {
    const file = path.join(work, "corrupt.json");
    writeFileSync(file, "{ not json");
    const list = new PluginBlocklist(file);
    await list.load();
    expect(list.list()).toEqual([]);
  });
});

describe("sandboxed scan", () => {
  it("validates each plugin in its own process; crashes, hangs and garbage are blocked and recorded, the rest stay usable", async () => {
    const blocklist = new PluginBlocklist(path.join(work, "scan-blocklist.json"));
    const result = await scanPlugins({ helper: spawnOptions, blocklist, vst3Roots: [], probeTimeoutMs: 4000 });
    expect(result.helperAvailable).toBe(true);
    const byId = new Map(result.plugins.map((p) => [p.id, p]));
    expect(byId.get("au:aufx:gain:mock")).toMatchObject({ status: "ok", latencySamples: 0, parameterCount: 1 });
    expect(byId.get("au:aufx:lkah:mock")).toMatchObject({ status: "ok", latencySamples: 300 });
    expect(byId.get("au:aufx:cras:mock")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/SIGSEGV|access violation/) });
    expect(byId.get("au:aufx:hang:mock")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/did not answer/) });
    expect(byId.get("au:aufx:junk:mock")?.status).toBe("blocked");
    expect(byId.get("au:aufx:bad_:mock")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/does not accept/) });
    // crashes, timeouts and protocol breakage are remembered; a plain refusal is not
    expect(blocklist.list().map((e) => [e.id, e.kind]).sort()).toEqual([["au:aufx:cras:mock", "crash"], ["au:aufx:hang:mock", "timeout"], ["au:aufx:junk:mock", "crash"]]);
  }, 30_000);

  it("does not probe a blocked plugin again, and probes it again once unblocked", async () => {
    const blocklist = new PluginBlocklist(path.join(work, "scan-blocklist2.json"));
    await blocklist.add("au:aufx:gain:mock", "manual", "blocked by the user");
    const first = await scanPlugins({ helper: spawnOptions, blocklist, vst3Roots: [], probeTimeoutMs: 4000 });
    expect(first.plugins.find((p) => p.id === "au:aufx:gain:mock")).toMatchObject({ status: "blocked", statusReason: "blocked by the user" });
    await blocklist.remove("au:aufx:gain:mock");
    const second = await scanPlugins({ helper: spawnOptions, blocklist, vst3Roots: [], probeTimeoutMs: 4000 });
    expect(second.plugins.find((p) => p.id === "au:aufx:gain:mock")?.status).toBe("ok");
  }, 30_000);

  it("reports a missing helper without failing the scan, and still lists VST3 bundles it can see", async () => {
    const vst3 = path.join(work, "vst3");
    mkdirSync(path.join(vst3, "Vendor", "Cool.vst3", "Contents", "Resources"), { recursive: true });
    writeFileSync(path.join(vst3, "Vendor", "Cool.vst3", "Contents", "Resources", "moduleinfo.json"), JSON.stringify({ Name: "Cool Synth FX", Version: "2.1", Factory: { Vendor: "CoolCo" }, Classes: [{ CID: "0123456789abcdef0123456789abcdef", Category: "Audio Module Class" }] }));
    const result = await scanPlugins({ helper: () => null, blocklist: new PluginBlocklist(path.join(work, "bl3.json")), vst3Roots: [vst3] });
    expect(result.helperAvailable).toBe(false);
    expect(result.helperError).toMatch(/no plugin helper/);
    expect(result.plugins).toEqual([expect.objectContaining({ id: "vst3:0123456789ABCDEF0123456789ABCDEF", format: "vst3", name: "Cool Synth FX", vendor: "CoolCo", status: "unsupported" })]);
  });

  it("probePlugin returns the validation facts for a good plugin", async () => {
    expect(await probePlugin(spawnOptions(), "au:aufx:lkah:mock", 5000)).toMatchObject({ ok: true, latencySamples: 300, tailSeconds: 0.5 });
  });
});

describe("plugin folders", () => {
  it("lists the standard VST3 and AU locations per platform", () => {
    expect(vst3SearchPaths({ platform: "darwin", home: "/Users/a" })).toEqual(["/Library/Audio/Plug-Ins/VST3", "/Users/a/Library/Audio/Plug-Ins/VST3"]);
    expect(vst3SearchPaths({ platform: "linux", home: "/home/a" })).toEqual(["/home/a/.vst3", "/usr/lib/vst3", "/usr/local/lib/vst3"]);
    expect(vst3SearchPaths({ platform: "win32", home: "C:\\Users\\a", env: { COMMONPROGRAMFILES: "C:\\Program Files\\Common Files", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" } }).map((p) => p.replace(/\\/g, "/"))).toEqual(["C:/Program Files/Common Files/VST3", "C:/Users/a/AppData/Local/Programs/Common/VST3"].map((p) => path.join(p).replace(/\\/g, "/")));
    expect(audioUnitSearchPaths({ platform: "darwin", home: "/Users/a" })).toContain("/Library/Audio/Plug-Ins/Components");
    expect(audioUnitSearchPaths({ platform: "linux" })).toEqual([]);
  });

  it("discovers bundles without loading them, falling back to the bundle name and a stable id", async () => {
    const root = path.join(work, "vst3-plain");
    mkdirSync(path.join(root, "Plain.vst3"), { recursive: true });
    const [bundle] = await discoverVst3([root, path.join(work, "nope")]);
    expect(bundle).toMatchObject({ name: "Plain", vendor: "" });
    expect(bundle.id).toMatch(/^vst3:[0-9A-F]{32}$/);
    expect((await discoverVst3([root]))[0].id).toBe(bundle.id);
  });
});

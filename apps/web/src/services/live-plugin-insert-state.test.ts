import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planAddRackPlugin, planSetRackLivePreview, type AudioPluginRack, type Project, type Track } from "@openreel/core";

const loaded = vi.fn();
vi.mock("./live-plugin-inserts", () => {
  loaded();
  return { getLivePluginInserts: () => ({ sync: vi.fn(), pushValues: vi.fn(), retry: vi.fn(), reopenAll: vi.fn() }) };
});

import { liveInsertsSupported, readLiveBlockFrames, syncLiveInserts, writeLiveBlockFrames } from "./live-plugin-insert-state";

const DELAY = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple" };
const rack = (): AudioPluginRack => planAddRackPlugin({ id: "x" }, DELAY, { actionId: "a", effectId: "fx1" })!.params.rack as AudioPluginRack;
const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
const project = (tracks: Track[]): Project => ({ id: "p", settings: { sampleRate: 8000, channels: 2 }, timeline: { duration: 3, markers: [], subtitles: [], tracks }, mediaLibrary: { items: [] } }) as unknown as Project;

describe("live insert gate (the lazy door)", () => {
  beforeEach(() => {
    loaded.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    delete (window as unknown as { openreel?: unknown }).openreel;
  });

  it("is unsupported without the desktop bridge, and then loads nothing", async () => {
    expect(liveInsertsSupported()).toBe(false);
    syncLiveInserts(project([track("t1", { pluginRack: rack() })]));
    await Promise.resolve();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("with the bridge but no live rack with plugins, nothing is loaded", async () => {
    (window as unknown as { openreel: unknown }).openreel = { plughost: { liveOpen: vi.fn() } };
    syncLiveInserts(project([track("t1")]));
    const renderedRack = (planSetRackLivePreview({ id: "t1", pluginRack: rack() }, false, { actionId: "x" })!.params as { rack: AudioPluginRack }).rack;
    syncLiveInserts(project([track("t1", { pluginRack: renderedRack })]));
    await Promise.resolve();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("the first live rack loads the controller, once", async () => {
    (window as unknown as { openreel: unknown }).openreel = { plughost: { liveOpen: vi.fn() } };
    syncLiveInserts(project([track("t1", { pluginRack: rack() })]));
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
    syncLiveInserts(project([track("t1", { pluginRack: rack() })]));
    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("remembers the block size and only accepts the supported ones", () => {
    expect(readLiveBlockFrames()).toBe(256);
    writeLiveBlockFrames(128);
    expect(readLiveBlockFrames()).toBe(128);
    window.localStorage.setItem("openreel-live-insert-block-frames", "1000");
    expect(readLiveBlockFrames()).toBe(256);
  });
});

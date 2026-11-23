import { create } from "zustand";
import { activePluginRackTargets, rackIsLive, type Project } from "@openreel/core";

/**
 * The small, always-loaded side of live plugin inserts: the status the panels show, and the lazy door to the real thing.
 * Nothing heavy is imported here. The controller (live-plugin-inserts.ts: AudioWorklet node, ports, helper sessions) is
 * only loaded, through a dynamic import, the first time a rack with live preview has plugins on a build that can host them.
 */

export type LiveInsertPhase = "opening" | "live" | "failed" | "unavailable";

export interface LiveInsertStatus {
  readonly phase: LiveInsertPhase;
  /** Whole-insert latency (transport + plugin), milliseconds. */
  readonly latencyMs: number;
  readonly blockFrames: number;
  readonly underruns: number;
  readonly lateBlocks: number;
  readonly reason?: string;
}

export const useLiveInsertState = create<{ readonly targets: Readonly<Record<string, LiveInsertStatus>> }>(() => ({ targets: {} }));

export const LIVE_BLOCK_STORAGE_KEY = "openreel-live-insert-block-frames";

export const liveInsertsSupported = (): boolean => typeof window !== "undefined" && typeof window.openreel?.plughost?.liveOpen === "function";

type Controller = { sync(project: Project): void; pushValues(target: string, effectId: string, values: Record<string, number>): void; retry(target: string): void; reopenAll(): void };
let controller: Controller | null = null;
let loading: Promise<Controller> | null = null;

const load = (): Promise<Controller> =>
  (loading ??= import("./live-plugin-inserts").then((mod) => {
    controller = mod.getLivePluginInserts();
    return controller;
  }));

/** Reconciles the live inserts with the project. Loads the controller only when some rack wants to play live. */
export function syncLiveInserts(project: Project): void {
  if (!liveInsertsSupported()) return;
  const wants = activePluginRackTargets(project.timeline).some((target) => rackIsLive(target.rack));
  if (controller) {
    controller.sync(project);
    return;
  }
  if (!wants) return;
  void load().then((c) => c.sync(project)).catch((error: unknown) => console.warn("[live-insert] the live insert controller could not load", error));
}

/** A parameter was edited: reach the plugin within one block, without waiting for the edit to commit. No-op unless that rack plays live. */
export function pushLiveValues(target: string, effectId: string, values: Record<string, number>): void {
  controller?.pushValues(target, effectId, values);
}

export function retryLiveInsert(target: string): void {
  controller?.retry(target);
}

/** The block size changed in the settings: reopen every live insert with it. */
export function reopenLiveInserts(): void {
  controller?.reopenAll();
}

export function readLiveBlockFrames(): 128 | 256 | 512 {
  try {
    const value = Number(window.localStorage.getItem(LIVE_BLOCK_STORAGE_KEY));
    if (value === 128 || value === 512) return value;
  } catch {
    /* storage unavailable */
  }
  return 256;
}

export function writeLiveBlockFrames(frames: 128 | 256 | 512): void {
  try {
    window.localStorage.setItem(LIVE_BLOCK_STORAGE_KEY, String(frames));
  } catch {
    /* storage unavailable */
  }
  reopenLiveInserts();
}

import { app, BrowserWindow, MessageChannelMain, type IpcMainInvokeEvent, type MessagePortMain } from "electron";
import path from "node:path";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels";
import { isValidPluginId } from "../../shared/plughost-protocol";
import { handle } from "../ipc";
import { PluginBlocklist } from "../plughost/blocklist";
import { formatHelperSpawner, resolvePlughostPath, resolveVst3hostPath } from "../plughost/helper-path";
import { PlugHostService } from "../plughost/host-service";
import { audioUnitSearchPaths, vst3SearchPaths } from "../plughost/scan-paths";

/**
 * Renderer-facing side of plugin hosting. Plugins never load in the renderer or the main process: every call here ends in a
 * helper process (see plughost/). Renders return a structured outcome instead of throwing, so the renderer can tell a plugin
 * that is simply not there (bypass and report) from one that broke while rendering (fail loudly).
 */

const pluginId = z.string().refine(isValidPluginId, "invalid plugin id");
const numberRecord = z.record(z.string().max(32), z.number().finite());
const lane = z.array(z.tuple([z.number().finite(), z.number().finite()])).max(200_000);
const samples = z.custom<ArrayBufferView>((value) => ArrayBuffer.isView(value) && value.byteLength % 4 === 0 && value.byteLength <= 1_000_000_000);
const stateString = z.string().max(64 * 1024 * 1024);

const renderArgs = z.object({
  jobId: z.string().min(1).max(100),
  pluginId,
  state: stateString.optional(),
  values: numberRecord,
  automation: z.record(z.string().max(32), lane),
  channels: z.array(samples).min(1).max(16),
  sampleRate: z.number().int().min(8000).max(384000),
});

let service: PlugHostService | null = null;
let spawner: ReturnType<typeof formatHelperSpawner> | null = null;
/** Created on first use: a session that never plays a rack live never loads the live insert code. */
let live: import("../plughost/live-service").LiveInsertService | null = null;
const liveSessionsOf = new Map<number, Set<string>>();

export function plugHostService(): PlugHostService {
  if (!service) {
    const locate = { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, dirname: __dirname, env: process.env };
    const binaries = { au: resolvePlughostPath(locate), vst3: resolveVst3hostPath(locate) };
    spawner = formatHelperSpawner(binaries);
    service = new PlugHostService({
      helper: spawner,
      blocklist: new PluginBlocklist(path.join(app.getPath("userData"), "plugin-blocklist.json")),
      vst3Roots: vst3SearchPaths(),
    });
  }
  return service;
}

const asFloat32 = (view: ArrayBufferView): Float32Array => new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));

function broadcast(channel: string, payload: unknown, sender?: IpcMainInvokeEvent["sender"]): void {
  if (sender && !sender.isDestroyed()) {
    sender.send(channel, payload);
    return;
  }
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

const liveStep = z.object({ pluginId, effectId: z.string().min(1).max(100), state: stateString.optional(), values: numberRecord, automation: z.record(z.string().max(32), lane) });
const liveOpenArgs = z.object({
  sessionId: z.string().min(1).max(100),
  steps: z.array(liveStep).min(1).max(8),
  sampleRate: z.number().int().min(8000).max(384000),
  blockFrames: z.union([z.literal(128), z.literal(256), z.literal(512)]),
});

async function liveService(): Promise<import("../plughost/live-service").LiveInsertService> {
  if (!live) {
    const { LiveInsertService } = await import("../plughost/live-service");
    const host = plugHostService();
    live = new LiveInsertService({
      ensureScanned: () => host.ensureScanned(),
      helper: (mode, format) => spawner?.(mode, format) ?? null,
      createChannel: () => {
        const { port1, port2 } = new MessageChannelMain();
        return { local: port1 as unknown as import("../plughost/live-service").LivePortLike, remote: port2 };
      },
    });
  }
  return live;
}

const liveKey = (event: IpcMainInvokeEvent, sessionId: string): string => `${event.sender.id}:${sessionId}`;

export function registerPlughostIpc(): void {
  const host = plugHostService();
  handle(CHANNELS.plughostScan, z.object({ force: z.boolean().optional() }).optional(), async (args, event) => {
    const result = args?.force || !host.lastScan ? await host.scanNow((done, total) => broadcast(CHANNELS.plughostScanProgress, { done, total }, event.sender)) : host.lastScan;
    return { ...result, auSearchPaths: audioUnitSearchPaths() };
  });
  handle(CHANNELS.plughostUnblock, z.object({ id: pluginId }), async ({ id }) => host.unblock(id));
  handle(CHANNELS.plughostRender, renderArgs, async (args, event) => {
    let last = 0;
    const outcome = await host.render(
      args.jobId,
      { pluginId: args.pluginId, ...(args.state ? { state: args.state } : {}), values: args.values, automation: args.automation, channels: args.channels.map(asFloat32), sampleRate: args.sampleRate },
      (fraction) => {
        if (fraction - last >= 0.01 || fraction >= 1) {
          last = fraction;
          broadcast(CHANNELS.plughostProgress, { jobId: args.jobId, fraction }, event.sender);
        }
      },
    );
    return outcome;
  });
  handle(CHANNELS.plughostCancel, z.object({ jobId: z.string() }), ({ jobId }) => host.cancel(jobId));
  handle(CHANNELS.plughostDescribe, z.object({ pluginId, state: stateString.optional() }), async ({ pluginId: id, state }) => {
    try {
      return { ok: true as const, ...(await host.describe(id, state)) };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  });
  handle(CHANNELS.plughostUiOpen, z.object({ pluginId, title: z.string().max(200), state: stateString.optional(), values: numberRecord.optional() }), async (args, event) => {
    try {
      const sessionId = await host.openUi(args.pluginId, { title: args.title, state: args.state, values: args.values }, (uiEvent) => broadcast(CHANNELS.plughostUiEvent, uiEvent, event.sender));
      return { ok: true as const, sessionId };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  });
  handle(CHANNELS.plughostUiClose, z.object({ sessionId: z.string() }), ({ sessionId }) => host.closeUi(sessionId));

  handle(CHANNELS.plughostLiveOpen, liveOpenArgs, async (args, event) => {
    const service = await liveService();
    const key = liveKey(event, args.sessionId);
    const owned = liveSessionsOf.get(event.sender.id) ?? new Set<string>();
    if (!liveSessionsOf.has(event.sender.id)) {
      liveSessionsOf.set(event.sender.id, owned);
      event.sender.once("destroyed", () => {
        for (const id of owned) live?.close(id);
        liveSessionsOf.delete(event.sender.id);
      });
    }
    const outcome = await service.open({
      sessionId: key,
      steps: args.steps,
      sampleRate: args.sampleRate,
      blockFrames: args.blockFrames,
      deliver: (remote) => event.sender.postMessage(CHANNELS.plughostLivePort, { sessionId: args.sessionId }, [remote as MessagePortMain]),
    });
    if (outcome.ok) owned.add(key);
    return outcome.ok ? { ok: true as const, sessionId: args.sessionId, ...outcome.open } : outcome;
  });
  handle(CHANNELS.plughostLiveSet, z.object({ sessionId: z.string(), effectId: z.string(), values: numberRecord.optional(), automation: z.record(z.string().max(32), lane).optional() }), (args, event) => live?.setValues(liveKey(event, args.sessionId), args.effectId, args.values, args.automation) ?? false);
  handle(CHANNELS.plughostLiveClose, z.object({ sessionId: z.string() }), (args, event) => {
    const key = liveKey(event, args.sessionId);
    live?.close(key);
    liveSessionsOf.get(event.sender.id)?.delete(key);
    return true;
  });
  handle(CHANNELS.plughostLiveStats, z.object({ sessionId: z.string() }), (args, event) => live?.stats(liveKey(event, args.sessionId)) ?? null);
}

export function disposePlughost(): void {
  live?.dispose();
  service?.dispose();
}

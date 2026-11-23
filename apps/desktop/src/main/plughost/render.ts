import {
  NATIVE_PLUGIN_BLOCK_FRAMES,
  blockParameterValues,
  changedParameterValues,
  compensateLatency,
  packBlock,
  planNativeRender,
  sanitizeLatencySamples,
  unpackBlock,
} from "../../../../../packages/core/src/audio/native-plugin/native-plugin-render";
import {
  NativePluginCancelledError,
  NativePluginRenderError,
  type NativePluginRenderRequest,
  type NativePluginRenderResult,
} from "../../../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { fromFloat32, toFloat32 } from "../../shared/plughost-protocol";
import { HelperError, HelperProcess, type HelperSpawnOptions } from "./helper-process";

/**
 * Offline render of one plugin over a whole clip source through the helper, block by block over the pipe.
 *
 * It is the editor's implementation of the block loop that planNativeRender / blockParameterValues describe; the helper's
 * own `offline` command line mode implements the same loop natively, and the end-to-end test requires the two to agree
 * sample for sample.
 */

export const OPEN_TIMEOUT_MS = 25_000;
export const BLOCK_TIMEOUT_MS = 10_000;

export interface PipeRenderOptions {
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (fraction: number) => void;
  readonly blockFrames?: number;
  readonly openTimeoutMs?: number;
  readonly blockTimeoutMs?: number;
  /** VST3: the .vst3 bundle to load (the helper needs the path; Audio Units are found by id). */
  readonly pluginPath?: string;
  /** Called with the helper process when it starts, so the caller can kill it on cancel. */
  readonly onHelper?: (helper: HelperProcess) => void;
}

const isChannelRefusal = (error: unknown): boolean => error instanceof HelperError && error.kind === "plugin" && /does not accept|channel/i.test(error.message);

async function openPlugin(spawn: HelperSpawnOptions, request: NativePluginRenderRequest, channels: number, block: number, options: PipeRenderOptions): Promise<{ helper: HelperProcess; latency: number }> {
  const helper = new HelperProcess(spawn);
  options.onHelper?.(helper);
  try {
    await helper.start();
    const opened = await helper.request(
      { type: "open", id: request.pluginId, sampleRate: request.sampleRate, channels, maxBlock: block, ...(options.pluginPath ? { path: options.pluginPath } : {}), ...(request.state ? { state: request.state } : {}), params: request.values },
      options.openTimeoutMs ?? OPEN_TIMEOUT_MS,
    );
    return { helper, latency: sanitizeLatencySamples(opened.json.latencySamples, request.sampleRate) };
  } catch (error) {
    helper.kill();
    throw error;
  }
}

function describeFailure(pluginId: string, error: unknown): NativePluginRenderError {
  if (error instanceof NativePluginRenderError) return error;
  if (error instanceof HelperError) {
    const tail = error.detail ? ` [${error.detail.split("\n").slice(-2).join(" | ")}]` : "";
    return new NativePluginRenderError(pluginId, `${error.message}${tail}`);
  }
  return new NativePluginRenderError(pluginId, error instanceof Error ? error.message : String(error));
}

export async function renderThroughHelper(spawn: HelperSpawnOptions, request: NativePluginRenderRequest, options: PipeRenderOptions = {}): Promise<NativePluginRenderResult> {
  const block = options.blockFrames ?? NATIVE_PLUGIN_BLOCK_FRAMES;
  const inputChannels = request.channels.length;
  const frames = request.channels[0]?.length ?? 0;
  if (inputChannels === 0 || frames === 0) return { channels: request.channels.map((c) => c.slice()), latencySamples: 0 };

  let channels = inputChannels;
  let source: readonly Float32Array[] = request.channels;
  let session: { helper: HelperProcess; latency: number };
  let monoToStereo = false;
  try {
    try {
      session = await openPlugin(spawn, request, channels, block, options);
    } catch (error) {
      if (inputChannels === 1 && isChannelRefusal(error)) {
        // Mono source, plugin only does stereo: run it dual-mono and fold the result back down.
        channels = 2;
        source = [request.channels[0], request.channels[0]];
        monoToStereo = true;
        session = await openPlugin(spawn, request, channels, block, options);
      } else throw error;
    }
  } catch (error) {
    throw describeFailure(request.pluginId, error);
  }
  const { helper, latency } = session;
  const plan = planNativeRender(frames, latency, block);
  const raw = Array.from({ length: channels }, () => new Float32Array(plan.totalFrames));
  const held: Record<string, number> = {};
  try {
    for (let start = 0; start < plan.totalFrames; start += block) {
      if (options.signal?.aborted) {
        helper.kill();
        throw new NativePluginCancelledError();
      }
      const count = Math.min(block, plan.totalFrames - start);
      const values = blockParameterValues(request.values, request.automation, start, request.sampleRate);
      const reply = await helper.request(
        { type: "block", frames: count, params: changedParameterValues(values, held) },
        options.blockTimeoutMs ?? BLOCK_TIMEOUT_MS,
        fromFloat32(packBlock(source, start, count)),
      );
      const out = toFloat32(reply.binary);
      if (out.length !== channels * count) throw new NativePluginRenderError(request.pluginId, `the plugin returned ${out.length} samples for a ${channels} x ${count} block`);
      for (let i = 0; i < out.length; i += 1) {
        if (!Number.isFinite(out[i])) throw new NativePluginRenderError(request.pluginId, "the plugin produced NaN or infinite samples");
      }
      unpackBlock(out, channels, count, raw, start);
      options.onProgress?.(Math.min(1, (start + count) / plan.totalFrames));
    }
  } catch (error) {
    helper.kill();
    if (error instanceof NativePluginCancelledError) throw error;
    throw describeFailure(request.pluginId, error);
  }
  await helper.close();
  let aligned = raw.map((channel) => compensateLatency(channel, plan));
  if (monoToStereo) aligned = [aligned[0].map((v, i) => (v + aligned[1][i]) * 0.5)];
  options.onProgress?.(1);
  return { channels: aligned, latencySamples: latency };
}

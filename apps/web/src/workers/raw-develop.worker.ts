/// <reference lib="webworker" />

import { decodeDng, developRaw, inspectDngRaw, looksLikeDng, type DngRaw, type RawInspection, type RawSourceSettings } from "@openreel/core/raw/index";

/**
 * Develops camera RAW off the main thread. The decoded sensor data stays in
 * the worker (two files at most), so changing a slider re-develops without
 * re-reading or re-decoding the file.
 */

export type RawWorkerRequest =
  | { id: number; type: "develop"; sourceKey: string; blob: Blob; settings: RawSourceSettings; maxLongEdge?: number }
  | { id: number; type: "inspect"; sourceKey: string; blob: Blob };

export type RawWorkerReply =
  | { id: number; ok: true; type: "develop"; width: number; height: number; rgba: Uint8ClampedArray }
  | { id: number; ok: true; type: "inspect"; inspection: RawInspection }
  | { id: number; ok: false; message: string };

const cache = new Map<string, Promise<DngRaw>>();

function decode(sourceKey: string, blob: Blob): Promise<DngRaw> {
  const hit = cache.get(sourceKey);
  if (hit) {
    cache.delete(sourceKey);
    cache.set(sourceKey, hit);
    return hit;
  }
  const pending = blob.arrayBuffer().then((buffer) => {
    if (!looksLikeDng(buffer)) throw new Error("This file is not a DNG.");
    return decodeDng(buffer);
  });
  cache.set(sourceKey, pending);
  pending.catch(() => cache.delete(sourceKey));
  while (cache.size > 2) cache.delete(cache.keys().next().value as string);
  return pending;
}

self.onmessage = (event: MessageEvent<RawWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const raw = await decode(request.sourceKey, request.blob);
      if (request.type === "inspect") {
        const reply: RawWorkerReply = { id: request.id, ok: true, type: "inspect", inspection: inspectDngRaw(raw) };
        self.postMessage(reply);
        return;
      }
      const frame = developRaw(raw, request.settings, request.maxLongEdge ? { maxLongEdge: request.maxLongEdge } : {});
      const reply: RawWorkerReply = { id: request.id, ok: true, type: "develop", width: frame.width, height: frame.height, rgba: frame.rgba };
      self.postMessage(reply, [frame.rgba.buffer]);
    } catch (error) {
      const reply: RawWorkerReply = { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
      self.postMessage(reply);
    }
  })();
};

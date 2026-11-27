import { decodeVideoBackdrop } from "../components/editor/playhead-video-frame";

self.onmessage = async ({ data }: MessageEvent<{ blob: Blob; time: number; max: number }>) => {
  const bitmap = await decodeVideoBackdrop(data.blob, data.time, data.max).catch(() => null);
  self.postMessage(bitmap, { transfer: bitmap ? [bitmap] : [] });
};

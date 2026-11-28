import { MessageChannel as NodeMessageChannel } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";
import { requestThumbnail } from "./preview-thumbnail-worker";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
});

it("cancels one decode and reuses the worker for the next thumbnail until the page closes", async () => {
  let created = 0;
  let cancelReceived!: () => void;
  const cancelled = new Promise<void>((resolve) => { cancelReceived = resolve; });
  const terminate = vi.fn();
  class ThumbnailWorker {
    terminate = terminate;
    constructor() { created++; }
    postMessage(request: { time: number }, [senderPort]: MessagePort[]) {
      const port = structuredClone(senderPort, { transfer: [senderPort] });
      if (request.time === 0) {
        port.onmessage = ({ data }) => {
          if (data === "cancel") cancelReceived();
          port.close();
        };
      } else {
        port.postMessage({ type: "backdrop", bitmap: null });
        port.close();
      }
    }
  }
  vi.stubGlobal("Worker", ThumbnailWorker);
  vi.stubGlobal("MessageChannel", NodeMessageChannel);
  const blob = new Blob();
  const controller = new AbortController();
  const first = requestThumbnail({ type: "backdrop", blob, time: 0, max: 128 }, { signal: controller.signal });
  const second = requestThumbnail({ type: "backdrop", blob, time: 1, max: 128 });
  controller.abort();
  expect(await first).toBeNull();
  await cancelled;
  expect(await second).toEqual({ type: "backdrop", bitmap: null });
  expect(await requestThumbnail({ type: "backdrop", blob, time: 2, max: 128 })).toEqual({ type: "backdrop", bitmap: null });
  expect(created).toBe(1);
  expect(terminate).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pagehide"));
  expect(terminate).toHaveBeenCalledTimes(1);
});

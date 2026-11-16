export interface DecodeRequest {
  type: "decode";
  requestId: string;
  clipId: string;
  blob: Blob;
  time: number;
  width: number;
  height: number;
}

export interface DecodeResponse {
  type: "decoded";
  requestId: string;
  clipId: string;
  bitmap: ImageBitmap | null;
  time: number;
  error?: string;
}

interface InitRequest {
  type: "init";
}

export interface InitResponse {
  type: "ready";
  workerId: number;
  mediabunnyAvailable?: boolean;
}

type WorkerRequest = DecodeRequest | InitRequest;
export type WorkerResponse = DecodeResponse | InitResponse;

interface CachedResource {
  input: unknown;
  sink: unknown;
  videoTrack: unknown;
  blobUrl: string;
}

const resourceCache = new Map<string, CachedResource>();
let workerId = 0;
let mediabunnyModule: typeof import("mediabunny") | null = null;

async function loadMediaBunny(): Promise<typeof import("mediabunny") | null> {
  if (mediabunnyModule) {
    return mediabunnyModule;
  }
  try {
    mediabunnyModule = await import("mediabunny");
    return mediabunnyModule;
  } catch {
    try {
      mediabunnyModule = (await import(
        "https://esm.sh/mediabunny@1.25.3" as string
      )) as typeof import("mediabunny");
      return mediabunnyModule;
    } catch {
      return null;
    }
  }
}

async function getOrCreateResources(
  clipId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<CachedResource | null> {
  const cached = resourceCache.get(clipId);
  if (cached) {
    return cached;
  }

  try {
    const mediabunny = await loadMediaBunny();
    if (!mediabunny) {
      return null;
    }
    const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunny;

    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    }) as unknown;

    const videoTrack = await (
      input as { getPrimaryVideoTrack: () => Promise<unknown> }
    ).getPrimaryVideoTrack();
    if (!videoTrack) {
      return null;
    }

    const sink = new CanvasSink(videoTrack as never, {
      width,
      height,
      fit: "contain",
    }) as unknown;

    const resource: CachedResource = {
      input,
      sink,
      videoTrack,
      blobUrl: URL.createObjectURL(blob),
    };

    resourceCache.set(clipId, resource);
    return resource;
  } catch (error) {
    console.error(
      `[DecodeWorker ${workerId}] Failed to create resources for ${clipId}:`,
      error,
    );
    return null;
  }
}

async function decodeFrame(request: DecodeRequest): Promise<DecodeResponse> {
  const { requestId, clipId, blob, time, width, height } = request;

  try {
    const resources = await getOrCreateResources(clipId, blob, width, height);
    if (!resources) {
      return {
        type: "decoded",
        requestId,
        clipId,
        bitmap: null,
        time,
        error: "Failed to create decode resources",
      };
    }

    const sink = resources.sink as {
      getCanvas: (time: number) => Promise<{
        canvas: HTMLCanvasElement | OffscreenCanvas;
        timestamp: number;
        duration: number;
      } | null>;
    };

    const frameResult = await sink.getCanvas(time);
    if (!frameResult?.canvas) {
      return {
        type: "decoded",
        requestId,
        clipId,
        bitmap: null,
        time,
        error: "No frame at requested time",
      };
    }

    const bitmap = await createImageBitmap(frameResult.canvas);

    return {
      type: "decoded",
      requestId,
      clipId,
      bitmap,
      time,
    };
  } catch (error) {
    return {
      type: "decoded",
      requestId,
      clipId,
      bitmap: null,
      time,
      error: error instanceof Error ? error.message : "Unknown decode error",
    };
  }
}

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (
    message: unknown,
    options?: { transfer?: Transferable[] },
  ) => void;
};

workerSelf.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  switch (request.type) {
    case "init":
      workerId = Math.floor(Math.random() * 10000);
      await loadMediaBunny();
      const initResponse: InitResponse = { type: "ready", workerId };
      workerSelf.postMessage(initResponse);
      break;

    case "decode":
      const response = await decodeFrame(request);
      if (response.bitmap) {
        workerSelf.postMessage(response, { transfer: [response.bitmap] });
      } else {
        workerSelf.postMessage(response);
      }
      break;
  }
};

const decodeWorkerCode = `
const resourceCache = new Map();
let workerId = 0;
let mediabunnyModule = null;
let mediabunnyAvailable = false;

async function loadMediaBunny() {
 if (mediabunnyModule) {
 return mediabunnyModule;
 }
 try {
 mediabunnyModule = await import("mediabunny");
 mediabunnyAvailable = true;
 return mediabunnyModule;
 } catch (error) {
 try {
 mediabunnyModule = await import("https://esm.sh/mediabunny@1.25.3");
 mediabunnyAvailable = true;
 return mediabunnyModule;
 } catch (cdnError) {
 mediabunnyAvailable = false;
 return null;
 }
 }
}

async function getOrCreateResources(clipId, blob, width, height) {
 if (!mediabunnyAvailable || !mediabunnyModule) {
 return null;
 }

 const cached = resourceCache.get(clipId);
 if (cached) {
 return cached;
 }

 try {
 const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunnyModule;

 const input = new Input({
 source: new BlobSource(blob),
 formats: ALL_FORMATS,
 });

 const videoTrack = await input.getPrimaryVideoTrack();
 if (!videoTrack) {
 return null;
 }

 const sink = new CanvasSink(videoTrack, {
 width,
 height,
 fit: "contain",
 });

 const resource = {
 input,
 sink,
 videoTrack,
 blobUrl: URL.createObjectURL(blob),
 };

 resourceCache.set(clipId, resource);
 return resource;
 } catch (error) {
 return null;
 }
}

async function decodeFrame(request) {
 const { requestId, clipId, blob, time, width, height } = request;

 if (!mediabunnyAvailable) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: "MediaBunny not available in worker",
 };
 }

 try {
 const resources = await getOrCreateResources(clipId, blob, width, height);
 if (!resources) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: "Failed to create decode resources",
 };
 }

 const frameResult = await resources.sink.getCanvas(time);
 if (!frameResult?.canvas) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: "No frame at requested time",
 };
 }

 const bitmap = await createImageBitmap(frameResult.canvas);

 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap,
 time,
 };
 } catch (error) {
 return {
 type: "decoded",
 requestId,
 clipId,
 bitmap: null,
 time,
 error: error instanceof Error ? error.message : "Unknown decode error",
 };
 }
}

self.onmessage = async (event) => {
 const request = event.data;

 switch (request.type) {
 case "init":
 workerId = Math.floor(Math.random() * 10000);
 await loadMediaBunny();
 self.postMessage({ type: "ready", workerId, mediabunnyAvailable });
 break;

 case "decode":
 const response = await decodeFrame(request);
 if (response.bitmap) {
 self.postMessage(response, [response.bitmap]);
 } else {
 self.postMessage(response);
 }
 break;
 }
};
`;

function createDecodeWorkerBlob(): Blob {
  return new Blob([decodeWorkerCode], { type: "application/javascript" });
}

export function createDecodeWorkerUrl(): string {
  const blob = createDecodeWorkerBlob();
  return URL.createObjectURL(blob);
}

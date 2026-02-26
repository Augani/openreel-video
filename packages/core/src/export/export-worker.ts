import type { VideoExportSettings } from "./types";

interface WorkerMessage {
  type:
    | "init"
    | "addFrame"
    | "addAudio"
    | "finalize"
    | "cancel";
  settings?: VideoExportSettings;
  frame?: ImageBitmap;
  frameIndex?: number;
  timestamp?: number;
  totalFrames?: number;
  audioBuffer?: {
    channels: Float32Array[];
    sampleRate: number;
    length: number;
  };
  projectName?: string;
  useStreamTarget?: boolean;
}

interface WorkerResponse {
  type: "progress" | "complete" | "error" | "ready" | "frameProcessed" | "chunk";
  progress?: number;
  phase?: string;
  currentFrame?: number;
  totalFrames?: number;
  blob?: Blob;
  error?: string;
  chunk?: {
    data: Uint8Array;
    position: number;
  };
}

let mediabunny: typeof import("mediabunny") | null = null;
let output: InstanceType<typeof import("mediabunny").Output> | null = null;
let videoSource: InstanceType<typeof import("mediabunny").VideoSampleSource> | null = null;
let audioSource: InstanceType<typeof import("mediabunny").AudioSampleSource> | null = null;
let target: InstanceType<typeof import("mediabunny").BufferTarget> | InstanceType<typeof import("mediabunny").StreamTarget> | null = null;
let cancelled = false;
let useStreamTarget = false;

interface QueuedFrame {
  frame: ImageBitmap;
  frameIndex: number;
  timestamp: number;
  totalFrames: number;
  frameRate: number;
}

const frameQueue: QueuedFrame[] = [];
let isProcessing = false;

async function initialize(
  settings: VideoExportSettings,
  projectName: string,
  streamMode?: boolean,
) {
  try {
    mediabunny = await import("mediabunny");

    const {
      Output,
      BufferTarget,
      StreamTarget,
      Mp4OutputFormat,
      WebMOutputFormat,
      MovOutputFormat,
      VideoSampleSource,
      AudioSampleSource,
      getFirstEncodableVideoCodec,
      getFirstEncodableAudioCodec,
      QUALITY_MEDIUM,
    } = mediabunny;

    useStreamTarget = streamMode || false;

    let outputFormat;
    switch (settings.format) {
      case "webm":
        outputFormat = new WebMOutputFormat();
        break;
      case "mov":
        outputFormat = new MovOutputFormat();
        break;
      case "mp4":
      default:
        outputFormat = new Mp4OutputFormat({ fastStart: streamMode ? false : "in-memory" });
        break;
    }

    if (useStreamTarget) {
      const chunkStream = new WritableStream({
        write(chunk: { data: Uint8Array; position: number }) {
          const dataCopy = new Uint8Array(chunk.data);
          (self as unknown as Worker).postMessage({
            type: "chunk",
            chunk: { data: dataCopy, position: chunk.position },
          } as WorkerResponse, [dataCopy.buffer]);
        },
      });
      target = new StreamTarget(chunkStream, {
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      });
    } else {
      target = new BufferTarget();
    }

    output = new Output({ format: outputFormat, target });

    const videoCodec = await getFirstEncodableVideoCodec(
      outputFormat.getSupportedVideoCodecs(),
      { width: settings.width, height: settings.height },
    );

    if (!videoCodec) {
      throw new Error("No supported video codec found");
    }

    const supportedAudioCodecs = outputFormat.getSupportedAudioCodecs();
    let audioCodec = await getFirstEncodableAudioCodec(supportedAudioCodecs);

    for (const fallbackCodec of ["aac", "mp3", "opus"]) {
      if (!audioCodec) {
        const found = supportedAudioCodecs.find((c: string) =>
          String(c).toLowerCase().includes(fallbackCodec) ||
          (fallbackCodec === "aac" && String(c).toLowerCase().includes("mp4a"))
        );
        if (found) {
          audioCodec = found;
          break;
        }
      }
    }

    videoSource = new VideoSampleSource({
      codec: videoCodec,
      bitrate: settings.bitrate ? settings.bitrate * 1000 : QUALITY_MEDIUM,
      keyFrameInterval: settings.keyframeInterval / settings.frameRate,
      hardwareAcceleration: "prefer-hardware",
    });

    audioSource = new AudioSampleSource({
      codec: (audioCodec || "aac") as "aac" | "opus" | "mp3",
      bitrate: settings.audioSettings.bitrate * 1000,
    });

    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);
    output.setMetadataTags({
      title: projectName,
      date: new Date(),
    });

    await output.start();

    postMessage({ type: "ready" } as WorkerResponse);
  } catch (error) {
    postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "Failed to initialize encoder",
    } as WorkerResponse);
  }
}

async function processFrameQueue() {
  if (isProcessing || frameQueue.length === 0) return;

  isProcessing = true;

  while (frameQueue.length > 0 && !cancelled) {
    const item = frameQueue.shift()!;
    await processFrame(item);
  }

  isProcessing = false;
}

async function processFrame(item: QueuedFrame) {
  if (cancelled || !mediabunny || !videoSource) {
    item.frame.close();
    return;
  }

  try {
    const { VideoSample } = mediabunny;

    const videoSample = new VideoSample(item.frame, {
      timestamp: item.timestamp,
      duration: 1 / item.frameRate,
    });

    await videoSource.add(videoSample);
    videoSample.close();
    item.frame.close();

    postMessage({
      type: "progress",
      progress: (item.frameIndex + 1) / item.totalFrames,
      phase: "encoding",
      currentFrame: item.frameIndex + 1,
      totalFrames: item.totalFrames,
    } as WorkerResponse);

    postMessage({ type: "frameProcessed" } as WorkerResponse);
  } catch (error) {
    item.frame.close();
    postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "Failed to encode frame",
    } as WorkerResponse);
  }
}

function queueFrame(
  frame: ImageBitmap,
  frameIndex: number,
  timestamp: number,
  totalFrames: number,
  frameRate: number,
) {
  frameQueue.push({ frame, frameIndex, timestamp, totalFrames, frameRate });
  processFrameQueue();
}

async function addAudio(audioData: {
  channels: Float32Array[];
  sampleRate: number;
  length: number;
}) {
  if (cancelled || !mediabunny || !audioSource) return;

  try {
    const { AudioSample } = mediabunny;

    const audioContext = new OfflineAudioContext(
      audioData.channels.length,
      audioData.length,
      audioData.sampleRate,
    );
    const audioBuffer = audioContext.createBuffer(
      audioData.channels.length,
      audioData.length,
      audioData.sampleRate,
    );

    for (let i = 0; i < audioData.channels.length; i++) {
      const channelData = audioBuffer.getChannelData(i);
      channelData.set(audioData.channels[i]);
    }

    const audioSamples = AudioSample.fromAudioBuffer(audioBuffer, 0);
    for (const sample of audioSamples) {
      await audioSource.add(sample);
      sample.close();
    }
  } catch (error) {
    postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "Failed to encode audio",
    } as WorkerResponse);
  }
}

async function finalize() {
  while (frameQueue.length > 0 || isProcessing) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  if (cancelled || !output || !videoSource || !audioSource || !target) {
    postMessage({
      type: "error",
      error: "Encoder not initialized",
    } as WorkerResponse);
    return;
  }

  try {
    videoSource.close();
    audioSource.close();

    postMessage({
      type: "progress",
      progress: 0.98,
      phase: "muxing",
    } as WorkerResponse);

    await output.finalize();

    if (useStreamTarget) {
      postMessage({
        type: "complete",
        blob: undefined,
        progress: 1,
        phase: "complete",
      } as WorkerResponse);
    } else {
      const bufferTarget = target as InstanceType<typeof import("mediabunny").BufferTarget>;
      const buffer = bufferTarget.buffer;
      if (!buffer) {
        throw new Error("Output buffer is empty");
      }

      const blob = new Blob([buffer], { type: "video/mp4" });

      postMessage({
        type: "complete",
        blob,
        progress: 1,
        phase: "complete",
      } as WorkerResponse);
    }
  } catch (error) {
    postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "Failed to finalize video",
    } as WorkerResponse);
  }
}

function cancel() {
  cancelled = true;
  for (const item of frameQueue) {
    item.frame.close();
  }
  frameQueue.length = 0;
  if (videoSource) {
    try { videoSource.close(); } catch {}
  }
  if (audioSource) {
    try { audioSource.close(); } catch {}
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const {
    type,
    settings,
    frame,
    frameIndex,
    timestamp,
    totalFrames,
    audioBuffer,
    projectName,
    useStreamTarget: streamMode,
  } = event.data;

  switch (type) {
    case "init":
      if (settings && projectName) {
        cancelled = false;
        initialize(settings, projectName, streamMode);
      }
      break;
    case "addFrame":
      if (frame !== undefined && frameIndex !== undefined && timestamp !== undefined && totalFrames !== undefined && settings) {
        queueFrame(frame, frameIndex, timestamp, totalFrames, settings.frameRate);
      }
      break;
    case "addAudio":
      if (audioBuffer) {
        addAudio(audioBuffer);
      }
      break;
    case "finalize":
      finalize();
      break;
    case "cancel":
      cancel();
      break;
  }
};

export {};

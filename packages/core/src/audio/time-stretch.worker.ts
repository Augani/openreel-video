import { timeStretchChannels } from "./time-stretch";

/** Off-main-thread pitch-preserving stretch. Imports nothing but the pure DSP so it bundles as a tiny module worker. */
export interface StretchWorkerRequest {
  readonly id: number;
  readonly channels: Float32Array[];
  readonly sampleRate: number;
  readonly speed: number;
}

export interface StretchWorkerResponse {
  readonly id: number;
  readonly channels?: Float32Array[];
  readonly error?: string;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<StretchWorkerRequest>) => void) | null;
  postMessage(message: StretchWorkerResponse, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id, channels, sampleRate, speed } = event.data;
  try {
    const out = timeStretchChannels(channels, sampleRate, speed);
    scope.postMessage({ id, channels: out }, out.map((channel) => channel.buffer));
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
};

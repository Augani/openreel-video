import { createSpectralHandler, type SpectralRequest, type SpectralResponse } from "./spectral-worker-core";

/** Off-main-thread spectral repair and spectrogram computation. Imports only the pure DSP so it bundles as a small module worker. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SpectralRequest>) => void) | null;
  postMessage(message: SpectralResponse, transfer: Transferable[]): void;
};

const handle = createSpectralHandler();

scope.onmessage = (event) => {
  const response = handle(event.data);
  const transfer: Transferable[] = [];
  for (const channel of response.channels ?? []) transfer.push(channel.buffer);
  if (response.view) transfer.push(response.view.data.buffer);
  scope.postMessage(response, transfer);
};

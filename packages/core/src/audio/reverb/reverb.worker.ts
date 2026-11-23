import { createReverbHandler, reverbTransferListOf, type ReverbRequest, type ReverbResponse } from "./reverb-worker-core";

/** Off-main-thread Reduce Reverb: the STFTs and the prediction filters run here, the page only posts samples and listens for progress. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReverbRequest>) => void) | null;
  postMessage(message: ReverbResponse, transfer?: Transferable[]): void;
};

const handler = createReverbHandler();

scope.onmessage = (event) => {
  void handler.handle(event.data, (response) => {
    scope.postMessage(response, reverbTransferListOf(response));
  });
};

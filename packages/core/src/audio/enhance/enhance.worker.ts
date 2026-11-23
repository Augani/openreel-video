import { createEnhanceHandler, transferListOf, type EnhanceRequest, type EnhanceResponse } from "./enhance-worker-core";

/** Off-main-thread speech enhancement: the network and the STFT run here, the page only posts samples and listens for progress. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EnhanceRequest>) => void) | null;
  postMessage(message: EnhanceResponse, transfer?: Transferable[]): void;
};

const handler = createEnhanceHandler();

scope.onmessage = (event) => {
  void handler.handle(event.data, (response) => {
    scope.postMessage(response, transferListOf(response));
  });
};

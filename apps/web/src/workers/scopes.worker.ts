/// <reference lib="webworker" />
import {
  renderScope,
  type ScopeKind,
} from "../components/editor/scopes/scope-render";

export interface ScopesWorkerRequest {
  id: number;
  kind: ScopeKind;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

self.onmessage = (event: MessageEvent<ScopesWorkerRequest>) => {
  const { id, kind, width, height, buffer } = event.data;
  const raster = renderScope(kind, {
    data: new Uint8ClampedArray(buffer),
    width,
    height,
  });
  (self as unknown as Worker).postMessage({ id, raster }, [
    raster.pixels.buffer,
  ]);
};

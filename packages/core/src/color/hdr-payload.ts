import type { OutputColorSpec, YuvFrame } from "../export/color-output";

/** What the export backends take from a rendered frame instead of reading 8 bits back from its bitmap. */
export interface HdrPayload {
  readonly yuv: YuvFrame;
  readonly spec: OutputColorSpec;
}

const payloads = new WeakMap<object, HdrPayload>();

export function attachHdrPayload(bitmap: object, payload: HdrPayload): void {
  payloads.set(bitmap, payload);
}

/** The float-derived planes rendered with this bitmap, if the frame went through the HDR path. */
export function takeHdrPayload(bitmap: object): HdrPayload | undefined {
  return payloads.get(bitmap);
}

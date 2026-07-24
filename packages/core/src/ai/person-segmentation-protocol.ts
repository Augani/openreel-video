export interface SegmentationWorkerInitRequest {
  type: "init";
}

export interface SegmentationWorkerFrameRequest {
  type: "segment";
  requestId: number;
  streamId: string;
  timestampMs: number;
  bitmap: ImageBitmap;
  reset: boolean;
}

export interface SegmentationWorkerDisposeRequest {
  type: "dispose";
}

export type SegmentationWorkerRequest =
  | SegmentationWorkerInitRequest
  | SegmentationWorkerFrameRequest
  | SegmentationWorkerDisposeRequest;

export interface SegmentationWorkerReadyResponse {
  type: "ready";
}

export interface SegmentationWorkerResultResponse {
  type: "result";
  requestId: number;
  streamId: string;
  timestampMs: number;
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  referenceRgba: Uint8ClampedArray;
  referenceWidth: number;
  referenceHeight: number;
}

export interface SegmentationWorkerErrorResponse {
  type: "error";
  requestId?: number;
  streamId?: string;
  message: string;
}

export type SegmentationWorkerResponse =
  | SegmentationWorkerReadyResponse
  | SegmentationWorkerResultResponse
  | SegmentationWorkerErrorResponse;

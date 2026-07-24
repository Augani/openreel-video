import { FilesetResolver, FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";
import type { DetectorKind } from "../subjects";

interface FaceLandmarkerHandle {
  kind: "FaceLandmarker";
  instance: FaceLandmarker;
}

interface ImageSegmenterHandle {
  kind: "ImageSegmenter";
  instance: ImageSegmenter;
}

type Handle = FaceLandmarkerHandle | ImageSegmenterHandle;

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

export class DetectorPool {
  private handles = new Map<DetectorKind, Handle>();
  private filesetPromise: Promise<unknown> | null = null;

  private getFileset() {
    if (!this.filesetPromise) {
      this.filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH);
    }
    return this.filesetPromise;
  }

  has(kind: DetectorKind): boolean {
    return this.handles.has(kind);
  }

  get(kind: DetectorKind): Handle | undefined {
    return this.handles.get(kind);
  }

  async ensure(kinds: DetectorKind[]): Promise<void> {
    const fileset = await this.getFileset();
    for (const kind of kinds) {
      if (this.handles.has(kind)) continue;
      if (kind === "FaceLandmarker") {
        const instance = await FaceLandmarker.createFromOptions(fileset as never, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
        });
        this.handles.set(kind, { kind, instance });
      } else if (kind === "ImageSegmenter") {
        const instance = await ImageSegmenter.createFromOptions(fileset as never, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite" },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        this.handles.set(kind, { kind, instance });
      }
    }
  }

  releaseUnused(stillNeeded: DetectorKind[]): void {
    const keep = new Set(stillNeeded);
    for (const [kind, handle] of this.handles) {
      if (!keep.has(kind)) {
        handle.instance.close();
        this.handles.delete(kind);
      }
    }
  }

  disposeAll(): void {
    for (const handle of this.handles.values()) handle.instance.close();
    this.handles.clear();
  }
}

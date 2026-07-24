import type { Graph } from "@openreel/fxpkg";

export type SubjectKind = "face" | "subject_silhouette" | "full_frame";

export type AnchorId =
  | "eyes" | "eye_left" | "eye_right" | "nose" | "mouth" | "jaw" | "forehead" | "face_bbox"
  | "mask" | "mask_edge" | "bbox" | "centroid"
  | "frame" | "center" | "corners";

export type AtomicKind = "glow" | "particles" | "color-tint" | "blur" | "replace" | "distort" | "mask-edge";

export type Behavior =
  | {
      id: string;
      kind: "preset";
      presetId: string;
      params: Record<string, unknown>;
      name: string;
      visible: boolean;
    }
  | {
      id: string;
      kind: "atomic";
      atomicKind: AtomicKind;
      params: Record<string, unknown>;
      name: string;
      visible: boolean;
    };

export interface Subject {
  id: string;
  kind: SubjectKind;
  name: string;
  visible: boolean;
  behaviors: Behavior[];
}

export interface Scene {
  subjects: Subject[];
  sampleClipId: string;
}

export const DEFAULT_SAMPLE_CLIP_ID = "portrait-closeup-01";

export function emptyScene(sampleClipId: string = DEFAULT_SAMPLE_CLIP_ID): Scene {
  return { subjects: [], sampleClipId };
}

export type SceneCompileResult = { ok: true; graph: Graph } | { ok: false; errors: string[] };

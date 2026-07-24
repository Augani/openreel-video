import type { IconName } from "../icons";
import type { AnchorId, SubjectKind } from "./scene";

export type DetectorKind = "FaceLandmarker" | "ImageSegmenter";

export interface SubjectCapability {
  kind: SubjectKind;
  defaultName: string;
  iconName: IconName;
  detector: DetectorKind | null;
  anchors: readonly AnchorId[];
}

export const SUBJECT_CAPABILITIES: Record<SubjectKind, SubjectCapability> = {
  face: {
    kind: "face",
    defaultName: "Face",
    iconName: "face",
    detector: "FaceLandmarker",
    anchors: ["eyes", "eye_left", "eye_right", "nose", "mouth", "jaw", "forehead", "face_bbox"] as const,
  },
  subject_silhouette: {
    kind: "subject_silhouette",
    defaultName: "Subject silhouette",
    iconName: "person",
    detector: "ImageSegmenter",
    anchors: ["mask", "mask_edge", "bbox", "centroid"] as const,
  },
  full_frame: {
    kind: "full_frame",
    defaultName: "Full frame",
    iconName: "monitor",
    detector: null,
    anchors: ["frame", "center", "corners"] as const,
  },
};

const ORDER: SubjectKind[] = ["face", "subject_silhouette", "full_frame"];

export function listSubjectKinds(): SubjectKind[] {
  return [...ORDER];
}

export function getSubjectCapability(kind: SubjectKind): SubjectCapability {
  return SUBJECT_CAPABILITIES[kind];
}

export function activeDetectorKinds(subjectKinds: SubjectKind[]): DetectorKind[] {
  const detectors = new Set<DetectorKind>();
  for (const kind of subjectKinds) {
    const d = SUBJECT_CAPABILITIES[kind].detector;
    if (d) detectors.add(d);
  }
  return [...detectors];
}

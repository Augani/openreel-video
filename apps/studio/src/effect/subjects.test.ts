import { describe, it, expect } from "vitest";
import { SUBJECT_CAPABILITIES, listSubjectKinds, getSubjectCapability } from "./subjects";

describe("subject capability registry", () => {
  it("registers exactly the v1 subject kinds: face, subject_silhouette, full_frame", () => {
    expect(listSubjectKinds()).toEqual(["face", "subject_silhouette", "full_frame"]);
  });

  it("face requires FaceLandmarker detector and exposes eye/nose/mouth anchors", () => {
    const cap = getSubjectCapability("face");
    expect(cap.detector).toBe("FaceLandmarker");
    expect(cap.anchors).toEqual(
      expect.arrayContaining(["eyes", "eye_left", "eye_right", "nose", "mouth", "jaw", "forehead", "face_bbox"]),
    );
    expect(cap.defaultName).toBe("Face");
    expect(cap.iconName).toBe("face");
  });

  it("subject_silhouette requires ImageSegmenter and exposes mask anchors", () => {
    const cap = getSubjectCapability("subject_silhouette");
    expect(cap.detector).toBe("ImageSegmenter");
    expect(cap.anchors).toEqual(expect.arrayContaining(["mask", "mask_edge", "bbox", "centroid"]));
    expect(cap.defaultName).toBe("Subject silhouette");
    expect(cap.iconName).toBe("person");
  });

  it("full_frame requires no detector", () => {
    const cap = getSubjectCapability("full_frame");
    expect(cap.detector).toBeNull();
    expect(cap.anchors).toEqual(expect.arrayContaining(["frame", "center", "corners"]));
    expect(cap.defaultName).toBe("Full frame");
    expect(cap.iconName).toBe("monitor");
  });

  it("registry is exhaustive over SubjectKind union", () => {
    const ids = Object.keys(SUBJECT_CAPABILITIES);
    expect(new Set(ids)).toEqual(new Set(["face", "subject_silhouette", "full_frame"]));
  });
});

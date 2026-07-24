export type ObjectMode = "erase" | "replace" | "outpaint";
export type MaskTool = "box" | "points";

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NormPoint {
  x: number;
  y: number;
}

export interface ExpandSides {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ObjectRemovalDraft {
  mode: ObjectMode;
  tool: MaskTool;
  bbox: BBox | null;
  points: NormPoint[];
  prompt: string;
  expand: number;
  expandSides?: ExpandSides | null;
}

export type BuildResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; error: string };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function buildObjectRemovalParams(draft: ObjectRemovalDraft): BuildResult {
  if (draft.mode === "outpaint") {
    const params: Record<string, unknown> = { mode: "outpaint" };
    if (draft.expandSides) {
      params.expandLeft = clamp01(draft.expandSides.left);
      params.expandRight = clamp01(draft.expandSides.right);
      params.expandTop = clamp01(draft.expandSides.top);
      params.expandBottom = clamp01(draft.expandSides.bottom);
      const total =
        (params.expandLeft as number) +
        (params.expandRight as number) +
        (params.expandTop as number) +
        (params.expandBottom as number);
      if (total <= 0) return { ok: false, error: "Set how much to expand" };
    } else {
      const expand = clamp01(draft.expand);
      if (expand <= 0) return { ok: false, error: "Set how much to expand" };
      params.expand = expand;
    }
    if (draft.prompt.trim()) params.prompt = draft.prompt.trim();
    return { ok: true, params };
  }

  const maskMode = draft.tool === "box" ? "bbox" : "points";
  const params: Record<string, unknown> = { mode: draft.mode, maskMode };

  if (draft.tool === "box") {
    if (!draft.bbox || draft.bbox.w <= 0 || draft.bbox.h <= 0) {
      return { ok: false, error: "Draw a box around the object" };
    }
    params.bbox = [
      clamp01(draft.bbox.x),
      clamp01(draft.bbox.y),
      clamp01(draft.bbox.w),
      clamp01(draft.bbox.h),
    ];
  } else {
    if (draft.points.length === 0) {
      return { ok: false, error: "Tap the object to mark it" };
    }
    params.points = draft.points.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }));
  }

  if (draft.mode === "replace") {
    if (!draft.prompt.trim()) {
      return { ok: false, error: "Describe what to put there" };
    }
    params.prompt = draft.prompt.trim();
  }

  return { ok: true, params };
}

import type {
  ColorMonitorBridge,
  ComparisonSnapshot,
  SceneDetectionBridge,
  ScopeFrame,
  ScopesBridge,
  ScopesState,
} from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useColorMonitorStore } from "../../stores/color-monitor-store";
import { grabStill } from "../comparison-service";
import { getPreviewCanvas } from "../../components/editor/scopes/preview-canvas-registry";
import {
  SCOPE_ANALYSIS_WIDTH,
  frameHasContent,
} from "../../components/editor/scopes/scope-render";
import {
  analyseClipScenes,
  applySceneCuts,
  sourceToTimelineTime,
  type SceneAnalysis,
} from "../scene-detection";

/** Analyses kept for apply_scene_cuts; oldest are dropped first. */
const MAX_ANALYSES = 8;

/**
 * Scene detection for the agent: the same decode + cut-finding + one-undo
 * apply path the Scene Edit Detection dialog uses.
 */
export function createSceneDetectionBridge(): SceneDetectionBridge {
  const analyses = new Map<string, SceneAnalysis>();
  return {
    async analyse({ clipId, sensitivity, minSceneLength }) {
      const analysis = await analyseClipScenes(clipId, { sensitivity, minSceneLength });
      const analysisId = crypto.randomUUID();
      analyses.set(analysisId, analysis);
      while (analyses.size > MAX_ANALYSES) {
        const oldest = analyses.keys().next().value;
        if (oldest === undefined) break;
        analyses.delete(oldest);
      }
      const clip = useProjectStore.getState().getClip(clipId);
      return {
        analysisId,
        clipId,
        cuts: analysis.cuts.map((cut) => ({
          sourceTime: cut.time,
          timelineTime: clip ? sourceToTimelineTime(clip, cut.time) : cut.time,
          score: cut.score,
        })),
      };
    },
    async apply({ analysisId, splitClip, addMarkers }) {
      const analysis = analyses.get(analysisId);
      if (!analysis)
        throw new Error("Unknown analysisId. Run detect_scenes again.");
      return applySceneCuts(analysis, { splitClip, addMarkers });
    },
  };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Re-reads after a seek: once soon, again after the async frame decode. */
const SETTLE_DELAYS_MS = [120, 300, 600] as const;

function readProgramFrame(scratch: HTMLCanvasElement): ScopeFrame | null {
  const src = getPreviewCanvas();
  if (!src || src.width === 0 || src.height === 0) return null;
  const w = SCOPE_ANALYSIS_WIDTH;
  const h = Math.max(1, Math.round((src.height / src.width) * w));
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    return frameHasContent(image.data)
      ? { data: image.data, width: w, height: h }
      : null;
  } catch {
    return null;
  }
}

/** Cheap content fingerprint of a frame (sampled FNV-1a), null for no frame. */
function frameSignature(frame: ScopeFrame | null): number | null {
  if (!frame) return null;
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(frame.data.length / 4096));
  for (let i = 0; i < frame.data.length; i += step) {
    hash = Math.imul(hash ^ frame.data[i], 16777619);
  }
  return hash >>> 0;
}

/** Opens/closes the Scopes panel and reads the program frame it analyses. */
export function createScopesBridge(): ScopesBridge {
  const state = (): ScopesState => {
    const ui = useUIStore.getState();
    return {
      visible: ui.scopesVisible,
      kind: ui.scopesKind,
      scale: ui.scopesScale,
      falseColor: useColorMonitorStore.getState().falseColor,
    };
  };
  return {
    getState: state,
    setView(patch) {
      if (patch.scale) useUIStore.getState().setScopesScale(patch.scale);
      if (patch.falseColor !== undefined)
        useColorMonitorStore.getState().setFalseColor(patch.falseColor);
      return state();
    },
    setVisible(visible, kind) {
      const ui = useUIStore.getState();
      if (kind) ui.setScopesKind(kind);
      ui.setScopesVisible(visible);
      return state();
    },
    async captureFrame(options) {
      const scratch = document.createElement("canvas");
      if (options?.timeSec === undefined) return readProgramFrame(scratch);
      const timeline = useTimelineStore.getState();
      const previous = timeline.playheadPosition;
      const target = Math.max(0, options.timeSec);
      // A frame read right after a seek is usually still the OLD frame, so
      // compare against what was on screen before and wait for it to change.
      // When the target is the current position (or the frames really are
      // identical) the final read after the last delay is returned.
      const sameTime = Math.abs(previous - target) < 1e-6;
      if (sameTime) return readProgramFrame(scratch);
      const before = frameSignature(readProgramFrame(scratch));
      timeline.seekTo(target);
      let latest: ScopeFrame | null = null;
      try {
        for (const delay of SETTLE_DELAYS_MS) {
          await wait(delay);
          const frame = readProgramFrame(scratch);
          if (frame) latest = frame;
          if (frame && (before === null || frameSignature(frame) !== before)) return frame;
        }
        return latest;
      } finally {
        // get_scope_stats is read-only: put the playhead back.
        useTimelineStore.getState().seekTo(previous);
      }
    },
  };
}

/** Comparison view + stills for the agent (same store and service as the Color tab). */
export function createColorMonitorBridge(): ColorMonitorBridge {
  const snapshot = (): ComparisonSnapshot => {
    const { comparison, stills } = useColorMonitorStore.getState();
    return {
      ...comparison,
      stills: stills.map(({ id, label, time }) => ({ id, label, time })),
    };
  };
  return {
    getComparison: snapshot,
    setComparison(patch) {
      useColorMonitorStore.getState().setComparison(patch);
      return snapshot();
    },
    async grabStill(options) {
      const still = await grabStill(options);
      return still
        ? {
            stillId: still.id,
            label: still.label,
            time: still.time,
            width: still.width,
            height: still.height,
          }
        : null;
    },
  };
}

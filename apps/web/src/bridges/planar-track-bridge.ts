import { correctPlanarFrame, mergePlanarTrack, trackPlanarSurface, type PlanarTrackData } from "@openreel/core";
import { createMotionTrackingSource } from "../services/motion-tracking-source";
import { createWorkerPlanarStepper } from "../services/planar-track-stepper";
import { persistPlanarTrackAnalysis, readPlanarTrackAnalysis } from "../services/planar-track-edit";
import { useProjectStore } from "../stores/project-store";

export type PlanarTrackRange = "clip" | "forward" | "backward";
export interface PlanarTrackState { isTracking: boolean; progress: number; lostFrames: number; error: string | null; clipId: string | null }
export interface PlanarTrackRun { clipId: string; /** Source pixels, TL TR BR BL, defined at `anchorFrame`. */ corners: number[]; anchorFrame: number; range: PlanarTrackRange; confidenceThreshold?: number; merge?: boolean }

type Listener = (state: PlanarTrackState) => void;
const IDLE: PlanarTrackState = { isTracking: false, progress: 0, lostFrames: 0, error: null, clipId: null };

class PlanarTrackBridge {
  private state: PlanarTrackState = IDLE;
  private listeners = new Set<Listener>();
  private active: AbortController | null = null;

  subscribe(listener: Listener): () => void { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  getState(): PlanarTrackState { return this.state; }
  private update(partial: Partial<PlanarTrackState>): void { this.state = { ...this.state, ...partial }; for (const l of this.listeners) l(this.state); }

  /** Track and save the path on the clip (one undo step). Resolves with the saved data; rejects on failure or cancel. */
  async track(run: PlanarTrackRun): Promise<PlanarTrackData> {
    if (this.active) throw new Error("The previous tracking job is still finishing");
    const controller = new AbortController();
    this.active = controller;
    this.update({ isTracking: true, progress: 0, lostFrames: 0, error: null, clipId: run.clipId });
    const xs = run.corners.filter((_, i) => i % 2 === 0), ys = run.corners.filter((_, i) => i % 2 === 1);
    const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    let source: ReturnType<typeof createMotionTrackingSource> | null = null;
    try {
      source = createMotionTrackingSource(run.clipId, bounds, controller.signal);
      const anchor = Math.max(0, Math.min(source.lastFrame, Math.round(run.anchorFrame)));
      const legs: Array<"forward" | "backward"> = run.range === "clip" ? ["backward", "forward"] : [run.range];
      let result: PlanarTrackData | null = null, lost = 0;
      for (const [index, direction] of legs.entries()) {
        const base = index / legs.length * 100;
        const leg = await trackPlanarSurface({
          clipId: run.clipId, frameRate: source.frameRate, anchorFrame: anchor, direction, corners: run.corners, confidenceThreshold: run.confidenceThreshold,
          startFrame: direction === "backward" ? 0 : anchor, endFrame: direction === "backward" ? anchor : source.lastFrame,
          readFrame: source.readFrame, createStepper: createWorkerPlanarStepper, signal: controller.signal,
          onProgress: (percent, lostFrames) => this.update({ progress: base + percent / legs.length, lostFrames: lost + lostFrames }),
        });
        lost += leg.lostFrames.length;
        result = result ? mergePlanarTrack(result, leg) : leg;
      }
      if (!result) throw new Error("Tracking did not produce a path");
      source.assertCurrent();
      const previous = run.merge ? readPlanarTrackAnalysis(run.clipId)?.data ?? null : null;
      const data = run.merge ? mergePlanarTrack(previous, result) : result;
      await persistPlanarTrackAnalysis(source.projectId, { version: 1, signature: source.signature, data }, controller.signal, run.merge ? "Re-track planar surface" : "Track planar surface");
      this.update({ isTracking: false, progress: 100, lostFrames: data.lostFrames.length });
      return data;
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      this.update({ isTracking: false, progress: 0, error: cancelled ? null : error instanceof Error ? error.message : "Tracking failed" });
      throw cancelled ? new Error("Tracking was cancelled") : error;
    } finally {
      source?.dispose();
      this.active = null;
    }
  }

  cancel(): void { this.active?.abort(); }

  /** Set the four corners at one frame by hand. One undo step; every pinned clip follows. */
  async correctFrame(clipId: string, frame: number, corners: number[]): Promise<PlanarTrackData> {
    const saved = readPlanarTrackAnalysis(clipId);
    if (!saved) throw new Error("Track the clip before editing corners");
    const data = correctPlanarFrame(saved.data, frame, corners);
    await persistPlanarTrackAnalysis(useProjectStore.getState().project.id, { ...saved, data }, undefined, "Edit planar corners");
    return data;
  }
}

let instance: PlanarTrackBridge | null = null;
export function getPlanarTrackBridge(): PlanarTrackBridge { return instance ??= new PlanarTrackBridge(); }

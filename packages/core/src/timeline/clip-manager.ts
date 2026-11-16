import type { Track, Timeline, Clip } from "../types";
import type { Action } from "../types/actions";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";

interface ClipManagerOptions {
  executor?: ActionExecutor;
  history?: ActionHistory;
  snapToGridEnabled?: boolean;
  gridSize?: number; // Grid size in seconds
  snapThreshold?: number; // Snap threshold in pixels (converted to time based on zoom)
}

interface AddClipParams {
  trackId: string;
  mediaId: string;
  startTime: number;
  duration?: number;
}

interface MoveClipParams {
  clipId: string;
  startTime: number;
  trackId?: string;
}

interface ClipOperationResult {
  success: boolean;
  clipId?: string;
  error?: string;
  constrainedPosition?: number;
}

interface SnapResult {
  snappedTime: number;
  didSnap: boolean;
  snapTarget?: "grid" | "clip-start" | "clip-end" | "playhead";
}

export class ClipManager {
  private executor: ActionExecutor;
  private snapToGridEnabled: boolean;
  private gridSize: number;
  private snapThreshold: number;

  constructor(options: ClipManagerOptions = {}) {
    this.executor = options.executor || new ActionExecutor(options.history);
    this.snapToGridEnabled = options.snapToGridEnabled ?? true;
    this.gridSize = options.gridSize ?? 1; // Default 1 second grid
    this.snapThreshold = options.snapThreshold ?? 10; // Default 10 pixels
  }

  async addClip(
    timeline: Timeline,
    params: AddClipParams,
    pixelsPerSecond: number = 100,
  ): Promise<ClipOperationResult> {
    const track = timeline.tracks.find((t) => t.id === params.trackId);
    if (!track) {
      return { success: false, error: "Track not found" };
    }

    if (track.locked) {
      return { success: false, error: "Track is locked" };
    }
    let startTime = params.startTime;
    if (this.snapToGridEnabled) {
      const snapResult = this.snapToGrid(
        startTime,
        timeline,
        params.trackId,
        pixelsPerSecond,
      );
      startTime = snapResult.snappedTime;
    }
    const duration = params.duration ?? 5; // Default duration
    const constrainedPosition = this.findNonOverlappingPosition(
      track,
      startTime,
      duration,
      null,
    );

    if (constrainedPosition !== startTime) {
      // Position was adjusted due to overlap
      startTime = constrainedPosition;
    }

    const action: Action = {
      type: "clip/add",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackId: params.trackId,
        mediaId: params.mediaId,
        startTime,
        duration,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    if (result.success) {
      const newClip = project.timeline.tracks
        .find((t: Track) => t.id === params.trackId)
        ?.clips.find(
          (c: Clip) =>
            !timeline.tracks
              .find((t) => t.id === params.trackId)
              ?.clips.some((existing) => existing.id === c.id),
        );

      return {
        success: true,
        clipId: newClip?.id,
        constrainedPosition:
          constrainedPosition !== params.startTime
            ? constrainedPosition
            : undefined,
      };
    }

    return {
      success: false,
      error: result.error?.message,
    };
  }

  async moveClip(
    timeline: Timeline,
    params: MoveClipParams,
    pixelsPerSecond: number = 100,
  ): Promise<ClipOperationResult> {
    const clip = this.findClip(timeline, params.clipId);
    if (!clip) {
      return { success: false, error: "Clip not found" };
    }

    const sourceTrack = timeline.tracks.find((t) => t.id === clip.trackId);
    if (!sourceTrack) {
      return { success: false, error: "Source track not found" };
    }

    if (sourceTrack.locked) {
      return { success: false, error: "Source track is locked" };
    }

    const targetTrackId = params.trackId ?? clip.trackId;
    const targetTrack = timeline.tracks.find((t) => t.id === targetTrackId);
    if (!targetTrack) {
      return { success: false, error: "Target track not found" };
    }

    if (targetTrack.locked) {
      return { success: false, error: "Target track is locked" };
    }
    let startTime = params.startTime;
    if (this.snapToGridEnabled) {
      const snapResult = this.snapToGrid(
        startTime,
        timeline,
        targetTrackId,
        pixelsPerSecond,
        params.clipId,
      );
      startTime = snapResult.snappedTime;
    }
    const constrainedPosition = this.findNonOverlappingPosition(
      targetTrack,
      startTime,
      clip.duration,
      params.clipId,
    );

    if (constrainedPosition !== startTime) {
      startTime = constrainedPosition;
    }

    const action: Action = {
      type: "clip/move",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        clipId: params.clipId,
        startTime,
        trackId: params.trackId,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      clipId: params.clipId,
      error: result.error?.message,
      constrainedPosition:
        constrainedPosition !== params.startTime
          ? constrainedPosition
          : undefined,
    };
  }

  snapToGrid(
    time: number,
    timeline: Timeline,
    trackId: string,
    pixelsPerSecond: number,
    excludeClipId?: string,
  ): SnapResult {
    if (!this.snapToGridEnabled) {
      return { snappedTime: time, didSnap: false };
    }
    const timeThreshold = this.snapThreshold / pixelsPerSecond;

    let closestSnap = time;
    let closestDistance = Infinity;
    let snapTarget: SnapResult["snapTarget"] = undefined;

    // Snap to grid lines
    const gridSnap = Math.round(time / this.gridSize) * this.gridSize;
    const gridDistance = Math.abs(time - gridSnap);
    if (gridDistance < timeThreshold && gridDistance < closestDistance) {
      closestSnap = gridSnap;
      closestDistance = gridDistance;
      snapTarget = "grid";
    }

    // Snap to clip boundaries on the same track
    const track = timeline.tracks.find((t) => t.id === trackId);
    if (track) {
      for (const clip of track.clips) {
        if (clip.id === excludeClipId) continue;

        // Snap to clip start
        const startDistance = Math.abs(time - clip.startTime);
        if (startDistance < timeThreshold && startDistance < closestDistance) {
          closestSnap = clip.startTime;
          closestDistance = startDistance;
          snapTarget = "clip-start";
        }

        // Snap to clip end
        const clipEnd = clip.startTime + clip.duration;
        const endDistance = Math.abs(time - clipEnd);
        if (endDistance < timeThreshold && endDistance < closestDistance) {
          closestSnap = clipEnd;
          closestDistance = endDistance;
          snapTarget = "clip-end";
        }
      }
    }

    return {
      snappedTime: closestSnap,
      didSnap: closestDistance < timeThreshold,
      snapTarget,
    };
  }

  wouldOverlap(
    track: Track,
    startTime: number,
    duration: number,
    excludeClipId?: string,
  ): boolean {
    const endTime = startTime + duration;

    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;

      const clipEnd = clip.startTime + clip.duration;
      // and ends after the other starts
      if (startTime < clipEnd && endTime > clip.startTime) {
        return true;
      }
    }

    return false;
  }

  findNonOverlappingPosition(
    track: Track,
    desiredStartTime: number,
    duration: number,
    excludeClipId: string | null,
  ): number {
    if (
      !this.wouldOverlap(
        track,
        desiredStartTime,
        duration,
        excludeClipId ?? undefined,
      )
    ) {
      return desiredStartTime;
    }
    const otherClips = track.clips
      .filter((c) => c.id !== excludeClipId)
      .sort((a, b) => a.startTime - b.startTime);

    if (otherClips.length === 0) {
      return desiredStartTime;
    }
    let bestPosition = desiredStartTime;
    let bestDistance = Infinity;

    // Option 1: Place at the beginning (time 0)
    if (!this.wouldOverlap(track, 0, duration, excludeClipId ?? undefined)) {
      const distance = Math.abs(desiredStartTime - 0);
      if (distance < bestDistance) {
        bestPosition = 0;
        bestDistance = distance;
      }
    }

    // Option 2: Place after each existing clip
    for (const clip of otherClips) {
      const afterClipStart = clip.startTime + clip.duration;
      if (
        !this.wouldOverlap(
          track,
          afterClipStart,
          duration,
          excludeClipId ?? undefined,
        )
      ) {
        const distance = Math.abs(desiredStartTime - afterClipStart);
        if (distance < bestDistance) {
          bestPosition = afterClipStart;
          bestDistance = distance;
        }
      }
    }

    // Option 3: Place before each existing clip (if there's room)
    for (const clip of otherClips) {
      const beforeClipStart = clip.startTime - duration;
      if (beforeClipStart >= 0) {
        if (
          !this.wouldOverlap(
            track,
            beforeClipStart,
            duration,
            excludeClipId ?? undefined,
          )
        ) {
          const distance = Math.abs(desiredStartTime - beforeClipStart);
          if (distance < bestDistance) {
            bestPosition = beforeClipStart;
            bestDistance = distance;
          }
        }
      }
    }

    return Math.max(0, bestPosition);
  }

  getOverlappingClips(
    track: Track,
    startTime: number,
    duration: number,
    excludeClipId?: string,
  ): Clip[] {
    const endTime = startTime + duration;
    return track.clips.filter((clip) => {
      if (clip.id === excludeClipId) return false;
      const clipEnd = clip.startTime + clip.duration;
      return startTime < clipEnd && endTime > clip.startTime;
    });
  }

  findClip(timeline: Timeline, clipId: string): Clip | undefined {
    for (const track of timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return undefined;
  }

  getTrackClips(timeline: Timeline, trackId: string): Clip[] {
    const track = timeline.tracks.find((t) => t.id === trackId);
    return track ? [...track.clips] : [];
  }

  getClipsSortedByTime(timeline: Timeline, trackId: string): Clip[] {
    return this.getTrackClips(timeline, trackId).sort(
      (a, b) => a.startTime - b.startTime,
    );
  }

  canTrackAcceptClip(
    _track: Track,
    _mediaType: "video" | "audio" | "image",
  ): boolean {
    return true;
  }

  setSnapToGrid(enabled: boolean): void {
    this.snapToGridEnabled = enabled;
  }

  isSnapToGridEnabled(): boolean {
    return this.snapToGridEnabled;
  }

  setGridSize(size: number): void {
    this.gridSize = size;
  }

  getGridSize(): number {
    return this.gridSize;
  }

  setSnapThreshold(threshold: number): void {
    this.snapThreshold = threshold;
  }

  getSnapThreshold(): number {
    return this.snapThreshold;
  }

  getExecutor(): ActionExecutor {
    return this.executor;
  }

  async splitClip(
    timeline: Timeline,
    clipId: string,
    splitTime: number,
  ): Promise<ClipOperationResult> {
    const clip = this.findClip(timeline, clipId);
    if (!clip) {
      return { success: false, error: "Clip not found" };
    }

    const track = timeline.tracks.find((t) => t.id === clip.trackId);
    if (!track) {
      return { success: false, error: "Track not found" };
    }

    if (track.locked) {
      return { success: false, error: "Track is locked" };
    }
    const clipEnd = clip.startTime + clip.duration;
    if (splitTime <= clip.startTime || splitTime >= clipEnd) {
      return {
        success: false,
        error: "Split time must be within clip bounds",
      };
    }

    const action: Action = {
      type: "clip/split",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        clipId,
        time: splitTime,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    // This API edits its supplied Timeline. The shared Split action returns
    // new collections so history can retain the exact original records.
    if (result.success && project.timeline !== timeline) Object.assign(timeline, project.timeline);

    return {
      success: result.success,
      clipId,
      error: result.error?.message,
    };
  }

  async trimClip(
    timeline: Timeline,
    clipId: string,
    params: { inPoint?: number; outPoint?: number },
  ): Promise<ClipOperationResult> {
    const clip = this.findClip(timeline, clipId);
    if (!clip) {
      return { success: false, error: "Clip not found" };
    }

    const track = timeline.tracks.find((t) => t.id === clip.trackId);
    if (!track) {
      return { success: false, error: "Track not found" };
    }

    if (track.locked) {
      return { success: false, error: "Track is locked" };
    }
    if (params.inPoint !== undefined && params.outPoint !== undefined) {
      if (params.inPoint >= params.outPoint) {
        return {
          success: false,
          error: "In-point must be less than out-point",
        };
      }
    }

    if (params.inPoint !== undefined) {
      if (params.inPoint < 0) {
        return { success: false, error: "In-point cannot be negative" };
      }
      if (params.inPoint >= clip.outPoint) {
        return {
          success: false,
          error: "In-point must be less than current out-point",
        };
      }
    }

    if (params.outPoint !== undefined) {
      if (params.outPoint <= clip.inPoint) {
        return {
          success: false,
          error: "Out-point must be greater than current in-point",
        };
      }
    }

    const action: Action = {
      type: "clip/trim",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        clipId,
        inPoint: params.inPoint,
        outPoint: params.outPoint,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      clipId,
      error: result.error?.message,
    };
  }

  async deleteClip(
    timeline: Timeline,
    clipId: string,
  ): Promise<ClipOperationResult> {
    const clip = this.findClip(timeline, clipId);
    if (!clip) {
      return { success: false, error: "Clip not found" };
    }

    const track = timeline.tracks.find((t) => t.id === clip.trackId);
    if (!track) {
      return { success: false, error: "Track not found" };
    }

    if (track.locked) {
      return { success: false, error: "Track is locked" };
    }

    const action: Action = {
      type: "clip/remove",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        clipId,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      clipId,
      error: result.error?.message,
    };
  }

  async rippleDeleteClip(
    timeline: Timeline,
    clipId: string,
  ): Promise<ClipOperationResult> {
    const clip = this.findClip(timeline, clipId);
    if (!clip) {
      return { success: false, error: "Clip not found" };
    }

    const track = timeline.tracks.find((t) => t.id === clip.trackId);
    if (!track) {
      return { success: false, error: "Track not found" };
    }

    if (track.locked) {
      return { success: false, error: "Track is locked" };
    }

    const action: Action = {
      type: "clip/rippleDelete",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        clipId,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      clipId,
      error: result.error?.message,
    };
  }

  private createProjectWrapper(timeline: Timeline): any {
    return {
      id: "temp-project",
      name: "Temp Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2,
      },
      mediaLibrary: {
        items: [
          {
            id: "media-1",
            name: "Default Media",
            type: "video",
            fileHandle: null,
            blob: null,
            metadata: {
              duration: 10,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "h264",
              sampleRate: 48000,
              channels: 2,
              fileSize: 1024,
            },
            thumbnailUrl: null,
            waveformData: null,
          },
        ],
      },
      timeline,
    };
  }
}

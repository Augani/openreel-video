import type { TransitionEngine, TransitionValidationResult } from "@openreel/core";
import { getLoadedEngineModules } from "../services/lazy-engines";
import type { Transition, Clip, Track, TransitionEdge } from "@openreel/core";
import type { TransitionType, TransitionParams } from "@openreel/core";
import { scaleBorderToFrame } from "@openreel/core/video/transition-defaults";

/**
 * Result of a transition operation
 */
interface TransitionOperationResult {
  success: boolean;
  transitionId?: string;
  error?: string;
  warning?: string;
  maxDuration?: number;
}

const isSameTransitionPlacement = (
  candidate: Transition,
  transition: Transition,
): boolean => {
  if (candidate.id === transition.id) {
    return true;
  }

  if (candidate.clipBId || transition.clipBId) {
    return (
      candidate.clipAId === transition.clipAId &&
      candidate.clipBId === transition.clipBId
    );
  }

  return (
    candidate.clipAId === transition.clipAId &&
    (candidate.edge ?? "out") === (transition.edge ?? "out")
  );
};

/**
 * TransitionBridge class for connecting UI to transition functionality
 *
 * - 12.2: Blend outgoing and incoming clips over specified duration
 * - 12.3: Update blend timing when duration is adjusted
 * - 12.4: Restore hard cut when transition is removed
 */
class TransitionBridge {
  private transitionEngine: TransitionEngine | null = null;
  private initialized = false;

  // Store transitions per track
  private trackTransitions: Map<string, Transition[]> = new Map();

  /**
   * Initialize the transition bridge
   * Connects to TransitionEngine
   */
  initialize(width: number = 1920, height: number = 1080): void {
    if (this.initialized) {
      return;
    }

    const engines = getLoadedEngineModules();
    if (!engines) {
      throw new Error(
        "TransitionBridge initialization failed: engine modules are not loaded yet (await loadEngineModules() first)",
      );
    }

    try {
      this.transitionEngine = engines.createTransitionEngine(width, height);
      this.initialized = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(
        `TransitionBridge initialization failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the underlying TransitionEngine
   */
  getEngine(): TransitionEngine | null {
    return this.transitionEngine;
  }

  /**
   * Create a transition between two adjacent clips
   *
   * Blend outgoing and incoming clips over specified duration
   *
   * @param clipA - The outgoing clip
   * @param clipB - The incoming clip
   * @param type - The transition type
   * @param duration - The transition duration in seconds
   * @param params - Optional transition-specific parameters
   * @returns Transition operation result
   */
  createTransition(
    clipA: Clip,
    clipB: Clip,
    type: TransitionType,
    duration: number,
    params?: Partial<TransitionParams[typeof type]>,
  ): TransitionOperationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { success: false, error: "TransitionBridge not initialized" };
    }

    // Validate the transition
    const validation = this.transitionEngine.validateTransition(
      clipA,
      clipB,
      duration,
    );

    if (!validation.valid && !validation.warning) {
      return { success: false, error: validation.error };
    }

    // Create the transition
    const transition = this.transitionEngine.createTransition(
      clipA,
      clipB,
      type,
      duration,
      params,
    );

    if (!transition) {
      return { success: false, error: "Failed to create transition" };
    }

    // Store the transition
    const trackId = clipA.trackId;
    const transitions = this.trackTransitions.get(trackId) || [];

    // Remove any existing transition at this clip-to-clip placement
    const filteredTransitions = transitions.filter(
      (t) => !isSameTransitionPlacement(t, transition),
    );

    filteredTransitions.push(transition);
    this.trackTransitions.set(trackId, filteredTransitions);

    return {
      success: true,
      transitionId: transition.id,
      warning: validation.warning,
      maxDuration: validation.maxDuration,
    };
  }

  /**
   * Create a transition on a single clip edge.
   *
   * Intro transitions blend from the project background into the clip.
   * Outro transitions blend from the clip into the project background.
   */
  createClipEdgeTransition(
    clip: Clip,
    edge: TransitionEdge,
    type: TransitionType,
    duration: number,
    params?: Partial<TransitionParams[typeof type]>,
  ): TransitionOperationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { success: false, error: "TransitionBridge not initialized" };
    }
    if (type === "morphCut") {
      return { success: false, error: "Morph Cut needs a cut between two clips; it cannot fade a clip in or out" };
    }

    const validation = this.transitionEngine.validateClipEdgeTransition(
      clip,
      duration,
    );

    if (!validation.valid && !validation.warning) {
      return { success: false, error: validation.error };
    }

    const transition = this.transitionEngine.createClipEdgeTransition(
      clip,
      edge,
      type,
      duration,
      params,
    );

    if (!transition) {
      return { success: false, error: "Failed to create transition" };
    }

    const transitions = this.trackTransitions.get(clip.trackId) || [];
    const filteredTransitions = transitions.filter(
      (t) => !isSameTransitionPlacement(t, transition),
    );

    filteredTransitions.push(transition);
    this.trackTransitions.set(clip.trackId, filteredTransitions);

    return {
      success: true,
      transitionId: transition.id,
      warning: validation.warning,
      maxDuration: validation.maxDuration,
    };
  }

  /**
   * Update a transition's parameters
   *
   * Update blend timing when duration is adjusted
   *
   * @param transitionId - The transition to update
   * @param updates - The parameters to update
   * @returns Transition operation result
   */
  updateTransition(
    transitionId: string,
    updates: Partial<{
      type: TransitionType;
      duration: number;
      params: Record<string, unknown>;
    }>,
  ): TransitionOperationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { success: false, error: "TransitionBridge not initialized" };
    }

    // Find the transition
    let foundTransition: Transition | null = null;
    let foundTrackId: string | null = null;

    for (const [trackId, transitions] of this.trackTransitions.entries()) {
      const transition = transitions.find((t) => t.id === transitionId);
      if (transition) {
        foundTransition = transition;
        foundTrackId = trackId;
        break;
      }
    }

    if (!foundTransition || !foundTrackId) {
      return { success: false, error: "Transition not found" };
    }

    // Create updated transition
    const updatedTransition: Transition = {
      ...foundTransition,
      type: updates.type ?? foundTransition.type,
      duration: updates.duration ?? foundTransition.duration,
      params: updates.params
        ? { ...foundTransition.params, ...updates.params }
        : foundTransition.params,
    };

    // Update in storage
    const transitions = this.trackTransitions.get(foundTrackId) || [];
    const index = transitions.findIndex((t) => t.id === transitionId);
    if (index !== -1) {
      transitions[index] = updatedTransition;
      this.trackTransitions.set(foundTrackId, transitions);
    }

    return { success: true, transitionId };
  }

  /**
   * Remove a transition (restore hard cut)
   *
   * Restore hard cut when transition is removed
   *
   * @param transitionId - The transition to remove
   * @returns Transition operation result
   */
  removeTransition(transitionId: string): TransitionOperationResult {
    if (!this.initialized) {
      return { success: false, error: "TransitionBridge not initialized" };
    }

    // Find and remove the transition
    for (const [trackId, transitions] of this.trackTransitions.entries()) {
      const index = transitions.findIndex((t) => t.id === transitionId);
      if (index !== -1) {
        transitions.splice(index, 1);
        this.trackTransitions.set(trackId, transitions);
        return { success: true, transitionId };
      }
    }

    return { success: false, error: "Transition not found" };
  }

  /**
   * Get a transition by ID
   *
   * @param transitionId - The transition ID
   * @returns The transition or undefined
   */
  getTransition(transitionId: string): Transition | undefined {
    for (const transitions of this.trackTransitions.values()) {
      const transition = transitions.find((t) => t.id === transitionId);
      if (transition) {
        return transition;
      }
    }
    return undefined;
  }

  /**
   * Get all transitions for a track
   *
   * @param trackId - The track ID
   * @returns Array of transitions
   */
  getTransitionsForTrack(trackId: string): Transition[] {
    return this.trackTransitions.get(trackId) || [];
  }

  setTransitionsForTrack(trackId: string, transitions: Transition[], projectWidth?: number): void {
    if (projectWidth && projectWidth > 0) this.projectFrameWidth = projectWidth;
    this.trackTransitions.set(
      trackId,
      transitions.map((transition) => ({
        ...transition,
        params: { ...transition.params },
      })),
    );
  }

  /**
   * Get transition between two specific clips
   *
   * @param clipAId - The outgoing clip ID
   * @param clipBId - The incoming clip ID
   * @returns The transition or undefined
   */
  getTransitionBetweenClips(
    clipAId: string,
    clipBId: string,
  ): Transition | undefined {
    for (const transitions of this.trackTransitions.values()) {
      const transition = transitions.find(
        (t) => t.clipAId === clipAId && t.clipBId === clipBId,
      );
      if (transition) {
        return transition;
      }
    }
    return undefined;
  }

  /**
   * Validate a potential transition between two clips
   *
   * @param clipA - The outgoing clip
   * @param clipB - The incoming clip
   * @param duration - The requested duration
   * @returns Validation result
   */
  validateTransition(
    clipA: Clip,
    clipB: Clip,
    duration: number,
    alignment: unknown = "center",
  ): TransitionValidationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { valid: false, error: "TransitionBridge not initialized" };
    }

    return this.transitionEngine.validateTransition(clipA, clipB, duration, alignment);
  }

  validateClipEdgeTransition(
    clip: Clip,
    duration: number,
  ): TransitionValidationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { valid: false, error: "TransitionBridge not initialized" };
    }

    return this.transitionEngine.validateClipEdgeTransition(clip, duration);
  }

  /**
   * Check if two clips are adjacent and can have a transition
   *
   * @param clipA - The first clip
   * @param clipB - The second clip
   * @returns Whether the clips are adjacent
   */
  areClipsAdjacent(clipA: Clip, clipB: Clip): boolean {
    if (!this.initialized || !this.transitionEngine) {
      return false;
    }

    return this.transitionEngine.areClipsAdjacent(clipA, clipB);
  }

  /**
   * Find all adjacent clip pairs on a track
   *
   * @param track - The track to search
   * @returns Array of adjacent clip pairs
   */
  findAdjacentClipPairs(track: Track): Array<{ clipA: Clip; clipB: Clip }> {
    if (!this.initialized || !this.transitionEngine) {
      return [];
    }

    return this.transitionEngine.findAdjacentClipPairs(track);
  }


  /**
   * Get default parameters for a transition type
   *
   * @param type - The transition type
   * @returns Default parameters
   */
  getDefaultParams(type: TransitionType): Record<string, unknown> {
    if (!this.initialized || !this.transitionEngine) {
      return {};
    }

    return this.transitionEngine.getDefaultParams(type);
  }

  /**
   * Calculate transition progress at a given time
   *
   * @param transition - The transition
   * @param clipA - The outgoing clip
   * @param currentTime - The current playback time
   * @returns Progress value (0 to 1)
   */
  calculateProgress(
    transition: Transition,
    clipA: Clip,
    currentTime: number,
  ): number {
    if (!this.initialized || !this.transitionEngine) {
      return 0;
    }

    return this.transitionEngine.calculateTransitionProgress(
      transition,
      clipA,
      currentTime,
    );
  }

  /**
   * Check if a time position is within a transition
   *
   * @param transition - The transition
   * @param clipA - The outgoing clip
   * @param currentTime - The current playback time
   * @returns Whether the time is within the transition
   */
  isTimeInTransition(
    transition: Transition,
    clipA: Clip,
    currentTime: number,
  ): boolean {
    if (!this.initialized || !this.transitionEngine) {
      return false;
    }

    return this.transitionEngine.isTimeInTransition(
      transition,
      clipA,
      currentTime,
    );
  }

  /** Allocates the engine's per-transition buffers ahead of the first real frame (see TransitionEngine.warmUp). */
  async warmUp(transition: Transition): Promise<boolean> {
    if (!this.initialized || !this.transitionEngine) return false;
    return this.transitionEngine.warmUp(this.forEngineFrame(transition));
  }

  /** The timeline window a transition covers (the engine's own rule, so look-ahead, preview and export agree). */
  getTransitionWindow(transition: Transition, clipA: Clip): { start: number; end: number } | null {
    if (!this.initialized || !this.transitionEngine) return null;
    return this.transitionEngine.getTransitionWindow(transition, clipA);
  }

  /**
   * Render a transition frame
   *
   * @param outgoingFrame - The frame from the outgoing clip
   * @param incomingFrame - The frame from the incoming clip
   * @param transition - The transition configuration
   * @param progress - Progress through the transition (0 to 1)
   * @returns The blended frame
   */
  async renderTransition(
    outgoingFrame: globalThis.CanvasImageSource,
    incomingFrame: globalThis.CanvasImageSource,
    transition: Transition,
    progress: number,
  ): Promise<{ frame: ImageBitmap; processingTime: number } | null> {
    if (!this.initialized || !this.transitionEngine) {
      return null;
    }

    try {
      const result = await this.transitionEngine.renderTransition(
        outgoingFrame,
        incomingFrame,
        this.forEngineFrame(transition),
        progress,
      );
      return {
        frame: result.frame,
        processingTime: result.processingTime,
      };
    } catch (error) {
      console.error("[TransitionBridge] Render error:", error);
      return null;
    }
  }

  /** Width of the project frame, the unit border widths are stored in (set with the track's transitions). */
  private projectFrameWidth = 0;

  /**
   * Border width is stored in project-frame pixels, but this engine renders at its own size (1920 wide by default,
   * whatever the project is), so the width is scaled to it: the preview then draws the same border as the export.
   */
  private forEngineFrame(transition: Transition): Transition {
    const engine = this.transitionEngine;
    if (!engine || !(Number(transition.params.borderWidth) > 0)) return transition;
    const projectWidth = this.projectFrameWidth;
    return { ...transition, params: scaleBorderToFrame(transition.params, engine.getEngineDimensions().width, projectWidth) };
  }

  async renderTransitionToCanvas(
    outgoingFrame: globalThis.CanvasImageSource,
    incomingFrame: globalThis.CanvasImageSource,
    transition: Transition,
    progress: number,
  ): Promise<OffscreenCanvas | null> {
    if (!this.initialized || !this.transitionEngine) {
      return null;
    }

    try {
      return await this.transitionEngine.renderTransitionToCanvas(
        outgoingFrame,
        incomingFrame,
        this.forEngineFrame(transition),
        progress,
      );
    } catch (error) {
      console.error("[TransitionBridge] Render error:", error);
      return null;
    }
  }

  /**
   * Clear all transitions for a track
   *
   * @param trackId - The track ID
   */
  clearTransitionsForTrack(trackId: string): void {
    this.trackTransitions.delete(trackId);
  }

  /**
   * Clear all transitions
   */
  clearAllTransitions(): void {
    this.trackTransitions.clear();
  }

  /**
   * Resize the transition engine
   *
   * @param width - New width
   * @param height - New height
   */
  resize(width: number, height: number): void {
    if (this.transitionEngine) {
      this.transitionEngine.resize(width, height);
    }
  }

  /**
   * Dispose of the transition bridge and clean up resources
   */
  dispose(): void {
    if (this.transitionEngine) {
      this.transitionEngine.dispose();
    }

    this.trackTransitions.clear();
    this.transitionEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let transitionBridgeInstance: TransitionBridge | null = null;

/**
 * Get the shared TransitionBridge instance
 */
export function getTransitionBridge(): TransitionBridge {
  if (!transitionBridgeInstance) {
    transitionBridgeInstance = new TransitionBridge();
  }
  return transitionBridgeInstance;
}

/**
 * Initialize the shared TransitionBridge
 */
export function initializeTransitionBridge(
  width: number = 1920,
  height: number = 1080,
): TransitionBridge {
  const bridge = getTransitionBridge();
  bridge.initialize(width, height);
  return bridge;
}

/**
 * Dispose of the shared TransitionBridge
 */
export function disposeTransitionBridge(): void {
  if (transitionBridgeInstance) {
    transitionBridgeInstance.dispose();
    transitionBridgeInstance = null;
  }
}

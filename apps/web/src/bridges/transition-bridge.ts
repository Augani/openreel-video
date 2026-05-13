import {
  TransitionEngine,
  createTransitionEngine,
  type TransitionValidationResult,
} from "@openreel/core";
import type { Transition, Clip, Track } from "@openreel/core";
import type { TransitionType, TransitionParams } from "@openreel/core";

/**
 * Result of a transition operation
 */
export interface TransitionOperationResult {
  success: boolean;
  transitionId?: string;
  error?: string;
  warning?: string;
  maxDuration?: number;
}

/**
 * Transition configuration for UI
 */
export interface TransitionConfig {
  type: TransitionType;
  duration: number;
  params: Record<string, unknown>;
}

/**
 * Available transition types with display info
 */
export interface TransitionTypeInfo {
  type: TransitionType;
  name: string;
  description: string;
  hasDirection: boolean;
  hasCustomParams: boolean;
}

/**
 * TransitionBridge class for connecting UI to transition functionality
 *
 * - 12.2: Blend outgoing and incoming clips over specified duration
 * - 12.3: Update blend timing when duration is adjusted
 * - 12.4: Restore hard cut when transition is removed
 */
export class TransitionBridge {
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

    try {
      this.transitionEngine = createTransitionEngine(width, height);
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

    // Remove any existing transition between these clips
    const filteredTransitions = transitions.filter(
      (t) => !(t.clipAId === clipA.id && t.clipBId === clipB.id),
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

  setTransitionsForTrack(trackId: string, transitions: Transition[]): void {
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
  ): TransitionValidationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { valid: false, error: "TransitionBridge not initialized" };
    }

    return this.transitionEngine.validateTransition(clipA, clipB, duration);
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
   * Get available transition types with display information
   *
   * @returns Array of transition type info
   */
  getAvailableTransitionTypes(): TransitionTypeInfo[] {
    return [
      {
        type: "crossfade",
        name: "Crossfade",
        description: "Smooth blend between clips",
        hasDirection: false,
        hasCustomParams: false,
      },
      {
        type: "dipToBlack",
        name: "Dip to Black",
        description: "Fade through black",
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "dipToWhite",
        name: "Dip to White",
        description: "Fade through white",
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "wipe",
        name: "Wipe",
        description: "Wipe from one clip to another",
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "slide",
        name: "Slide",
        description: "Slide incoming clip over outgoing",
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "zoom",
        name: "Zoom",
        description: "Zoom transition between clips",
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "push",
        name: "Push",
        description: "Push outgoing clip with incoming",
        hasDirection: true,
        hasCustomParams: false,
      },
    ];
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
    outgoingFrame: ImageBitmap,
    incomingFrame: ImageBitmap,
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
        transition,
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

import type { Timeline, Track, Clip } from "../types/timeline";

/**
 * Helper type that removes readonly modifiers from a type and its nested properties.
 * Useful for making deep copies mutable while preserving structure.
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P] extends readonly (infer U)[]
    ? Mutable<U>[]
    : T[P] extends object
      ? Mutable<T[P]>
      : T[P];
};

export type MutableTimeline = Mutable<Timeline>;
export type MutableTrack = Mutable<Track>;
export type MutableClip = Mutable<Clip>;

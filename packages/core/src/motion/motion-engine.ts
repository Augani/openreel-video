import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import { DEFAULT_SHAPE_STYLE } from "../graphics/types";
import type {
  MotionComposition,
  MotionCompositionInstance,
  MotionLayer,
  MotionTextLayer,
} from "./types";
import {
  DEFAULT_MOTION_INSTANCE_TRANSFORM,
  DEFAULT_MOTION_TRANSFORM,
} from "./types";
import { createMotionTextAnimator } from "./motion-text-animators";

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export interface CreateMotionCompositionOptions {
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly duration?: number;
  readonly backgroundColor?: string;
}

export interface InsertMotionInstanceOptions {
  readonly compositionId: string;
  readonly trackId?: string;
  readonly startTime?: number;
  readonly duration?: number;
  readonly name?: string;
}

export class MotionEngine {
  createComposition(
    options: CreateMotionCompositionOptions = {},
  ): MotionComposition {
    const now = Date.now();
    const width = options.width ?? 1920;
    const height = options.height ?? 1080;
    return {
      id: uid("motion"),
      name: options.name ?? "Untitled Motion Scene",
      width,
      height,
      frameRate: options.frameRate ?? 30,
      duration: options.duration ?? 5,
      backgroundColor: options.backgroundColor ?? "transparent",
      layers: [],
      assets: [],
      variables: [],
      markers: [],
      guides: [],
      createdAt: now,
      modifiedAt: now,
    };
  }

  createStarterComposition(
    options: CreateMotionCompositionOptions = {},
  ): MotionComposition {
    const composition = this.createComposition(options);
    const titleLayer: MotionTextLayer = {
      id: uid("motion-layer"),
      type: "text",
      name: "Headline",
      startTime: 0,
      duration: composition.duration,
      visible: true,
      locked: false,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: composition.width / 2, y: composition.height / 2 },
      },
      keyframes: [
        {
          id: uid("motion-kf"),
          time: 0,
          property: "transform.opacity",
          value: 0,
          easing: "ease-out",
        },
        {
          id: uid("motion-kf"),
          time: 0.6,
          property: "transform.opacity",
          value: 1,
          easing: "ease-out",
        },
        {
          id: uid("motion-kf"),
          time: composition.duration - 0.5,
          property: "transform.opacity",
          value: 1,
          easing: "ease-in",
        },
        {
          id: uid("motion-kf"),
          time: composition.duration,
          property: "transform.opacity",
          value: 0,
          easing: "ease-in",
        },
      ],
      text: "Motion Scene",
      textAnimators: [
        createMotionTextAnimator("text-reveal-up", uid("motion-text-anim")),
      ],
      style: {
        fontFamily: "Inter",
        fontSize: 112,
        fontWeight: 800,
        color: "#ffffff",
        align: "center",
        lineHeight: 1.05,
      },
    };

    return {
      ...composition,
      layers: [
        {
          id: uid("motion-layer"),
          type: "shape",
          name: "Accent Bar",
          startTime: 0,
          duration: composition.duration,
          visible: true,
          locked: false,
          transform: {
            ...DEFAULT_MOTION_TRANSFORM,
            position: { x: composition.width / 2, y: composition.height * 0.65 },
            scale: { x: 1, y: 1 },
          },
          keyframes: [
            {
              id: uid("motion-kf"),
              time: 0,
              property: "transform.scale.x",
              value: 0,
              easing: "ease-out",
            },
            {
              id: uid("motion-kf"),
              time: 0.7,
              property: "transform.scale.x",
              value: 1,
              easing: "ease-out",
            },
          ],
          shapeType: "rectangle",
          width: 560,
          height: 18,
          style: {
            ...DEFAULT_SHAPE_STYLE,
            fill: { type: "solid", color: "#14b8a6", opacity: 1 },
            stroke: { color: "#14b8a6", width: 0, opacity: 0 },
            cornerRadius: 9,
          },
        },
        titleLayer,
      ],
    };
  }

  upsertComposition(
    project: Project,
    composition: MotionComposition,
  ): Project {
    const existing = project.motionCompositions ?? [];
    const next = existing.some((item) => item.id === composition.id)
      ? existing.map((item) => (item.id === composition.id ? composition : item))
      : [...existing, composition];

    return {
      ...project,
      motionCompositions: next,
      modifiedAt: Date.now(),
    };
  }

  addLayer(
    composition: MotionComposition,
    layer: MotionLayer,
  ): MotionComposition {
    return {
      ...composition,
      layers: [...composition.layers, layer],
      modifiedAt: Date.now(),
    };
  }

  createInstance(
    composition: MotionComposition,
    options: Omit<InsertMotionInstanceOptions, "compositionId"> = {},
  ): MotionCompositionInstance {
    return {
      id: uid("motion-instance"),
      compositionId: composition.id,
      name: options.name ?? composition.name,
      trackId: options.trackId,
      startTime: options.startTime ?? 0,
      duration: options.duration ?? composition.duration,
      transform: DEFAULT_MOTION_INSTANCE_TRANSFORM,
      opacity: 1,
    };
  }

  insertInstance(
    project: Project,
    instance: MotionCompositionInstance,
  ): Project {
    const { track, tracks } = ensureGraphicsTrack(project, instance.trackId);
    const trackId = track.id;
    const nextInstance = { ...instance, trackId };
    const clip = createMotionClip(nextInstance);
    const nextTracks = tracks.map((candidate) => {
      if (candidate.id !== track.id) return candidate;
      const clips = candidate.clips.some(
        (existingClip) => existingClip.metadata?.motionInstanceId === instance.id,
      )
        ? candidate.clips.map((existingClip) =>
            existingClip.metadata?.motionInstanceId === instance.id
              ? clip
              : existingClip,
          )
        : [...candidate.clips, clip];
      return { ...candidate, clips };
    });

    const nextInstances = (project.motionInstances ?? []).some(
      (existing) => existing.id === instance.id,
    )
      ? (project.motionInstances ?? []).map((existing) =>
          existing.id === instance.id ? nextInstance : existing,
        )
      : [...(project.motionInstances ?? []), nextInstance];

    return {
      ...project,
      motionInstances: nextInstances,
      timeline: {
        ...project.timeline,
        tracks: nextTracks,
        duration: Math.max(
          project.timeline.duration,
          nextInstance.startTime + nextInstance.duration,
        ),
      },
      modifiedAt: Date.now(),
    };
  }
}

function createMotionClip(instance: MotionCompositionInstance): Clip {
  return {
    id: `motion-clip-${instance.id}`,
    mediaId: `motion-${instance.id}`,
    trackId: instance.trackId ?? "track-motion",
    startTime: instance.startTime,
    duration: instance.duration,
    inPoint: 0,
    outPoint: instance.duration,
    effects: [],
    audioEffects: [],
    transform: instance.transform,
    blendMode: instance.blendMode,
    blendOpacity: instance.opacity,
    volume: 1,
    keyframes: [],
    metadata: {
      motionInstanceId: instance.id,
      motionCompositionId: instance.compositionId,
      motionClip: true,
    },
  };
}

function ensureGraphicsTrack(
  project: Project,
  preferredTrackId?: string,
): { track: Track; tracks: Track[] } {
  if (preferredTrackId) {
    const preferred = project.timeline.tracks.find(
      (track) => track.id === preferredTrackId,
    );
    if (preferred) {
      return { track: preferred, tracks: project.timeline.tracks };
    }
  }

  const existing = project.timeline.tracks.find(
    (track) => track.type === "graphics" && track.name === "Motion",
  );
  if (existing) {
    return { track: existing, tracks: project.timeline.tracks };
  }

  const track: Track = {
    id: preferredTrackId ?? uid("track-motion"),
    type: "graphics",
    name: "Motion",
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
  return { track, tracks: [...project.timeline.tracks, track] };
}

export const motionEngine = new MotionEngine();

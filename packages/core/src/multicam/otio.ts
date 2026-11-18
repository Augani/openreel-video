import type { MulticamManifest } from "./manifest";
import type { MulticamShotPlan } from "./shot-planner";

interface OtioSerializable {
  OTIO_SCHEMA: string;
  [key: string]: unknown;
}

const rationalTime = (value: number, rate: number): OtioSerializable => ({
  OTIO_SCHEMA: "RationalTime.1",
  value,
  rate,
});

const timeRange = (start: number, duration: number, rate: number): OtioSerializable => ({
  OTIO_SCHEMA: "TimeRange.1",
  start_time: rationalTime(start, rate),
  duration: rationalTime(duration, rate),
});

/** Exports every planned panel as a standards-shaped OpenTimelineIO video track. */
export function multicamPlanToOtio(
  plan: MulticamShotPlan,
  manifest: MulticamManifest,
  name = "OpenReel Automatic Multicam Edit",
): OtioSerializable {
  const maximumPanels = plan.shots.reduce(
    (maximum, shot) => Math.max(maximum, shot.layout.panels.length),
    1,
  );
  const tracks = Array.from({ length: maximumPanels }, (_, panelIndex) => {
    const children = plan.shots.flatMap((shot) => {
      const panel = shot.layout.panels[panelIndex];
      if (!panel) return [];
      const camera = manifest.cameras.find((entry) => entry.id === panel.cameraId);
      const startFrames = Math.round((shot.startMs / 1_000) * manifest.fps);
      const durationFrames = Math.round(
        ((shot.endMs - shot.startMs) / 1_000) * manifest.fps,
      );
      return [{
        OTIO_SCHEMA: "Clip.2",
        name: `${camera?.id ?? panel.cameraId} · ${shot.reason}`,
        source_range: timeRange(startFrames, durationFrames, manifest.fps),
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          target_url: camera?.file ?? "",
          available_range: null,
          metadata: { openreel_camera_id: panel.cameraId },
        },
        metadata: {
          openreel: {
            subject: panel.subject,
            layout: shot.layout.template,
            panel_rect: panel.rect,
            confidence: shot.confidence,
            reason: shot.reason,
          },
        },
      }];
    });
    return {
      OTIO_SCHEMA: "Track.1",
      name: `Multicam panel ${panelIndex + 1}`,
      kind: "Video",
      children,
      source_range: null,
      effects: [],
      markers: [],
      metadata: {},
    };
  });
  return {
    OTIO_SCHEMA: "Timeline.1",
    name,
    global_start_time: rationalTime(0, manifest.fps),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: tracks,
      source_range: null,
      effects: [],
      markers: [],
      metadata: {},
    },
    metadata: {
      openreel: {
        spec: plan.spec,
        duration_ms: plan.durationMs,
        manifest_spec: manifest.spec,
      },
    },
  };
}

export function serializeMulticamOtio(
  plan: MulticamShotPlan,
  manifest: MulticamManifest,
  name?: string,
): string {
  return JSON.stringify(multicamPlanToOtio(plan, manifest, name), null, 2);
}

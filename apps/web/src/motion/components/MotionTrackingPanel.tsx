import type { JSX } from "react";
import { useMemo, useState } from "react";
import {
  Crosshair,
  LocateFixed,
  Plus,
  Route,
  SlidersHorizontal,
  Trash2,
} from "@/icons/lucide-compat";
import {
  addMotionTrack,
  addMotionTrackPointFrame,
  applyMotionTrackToLayer,
  createMotionTrack,
  getMotionLayerPropertyValueAtTime,
  normalizeMotionTracks,
  removeMotionTrack,
  smoothMotionTrack,
  updateMotionTrack,
  type MotionComposition,
  type MotionLayer,
  type MotionTrack,
  type MotionTrackPoint,
  type MotionTrackingApplyMode,
} from "@openreel/core";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { useMotionStore } from "../stores/motion-store";
import { autoTrackVideoFeature } from "../motion-auto-track";
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  SelectInput,
  SwitchInput,
  TextInput,
} from "./primitives";
import { useTranslation } from "react-i18next";

interface MotionTrackingPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const makeId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function MotionTrackingPanel({
  composition,
  embedded = false,
}: MotionTrackingPanelProps): JSX.Element {
  const { t } = useTranslation();
  const tracks = normalizeMotionTracks(composition);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(
    tracks[0]?.id ?? null,
  );
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [applyMode, setApplyMode] =
    useState<MotionTrackingApplyMode>("position");
  const [preserveOffset, setPreserveOffset] = useState(true);
  const [smoothWindow, setSmoothWindow] = useState(0);
  const playhead = useMotionStore((state) => state.playhead);
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const mediaItems = useProjectStore((state) => state.project.mediaLibrary.items);
  const [isAutoTracking, setIsAutoTracking] = useState(false);
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const activeTrack =
    tracks.find((track) => track.id === activeTrackId) ?? tracks[0] ?? null;
  const activePoint =
    activeTrack?.points.find((point) => point.id === activePointId) ??
    activeTrack?.points[0] ??
    null;
  const secondaryPoint = activeTrack?.points.find(
    (point) => point.id !== activePoint?.id,
  );
  const samplePosition = useMemo(
    () => getLayerSamplePosition(composition, selectedLayer, playhead),
    [composition, selectedLayer, playhead],
  );
  const [sampleX, setSampleX] = useState(samplePosition.x);
  const [sampleY, setSampleY] = useState(samplePosition.y);

  const updateComposition = (nextComposition: MotionComposition) => {
    void upsertMotionComposition(nextComposition);
  };

  const replaceLayer = (nextLayer: MotionLayer) => {
    updateComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === nextLayer.id ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addTrack = () => {
    const track = createMotionTrack({
      id: makeId("motion-track"),
      name: `Track ${tracks.length + 1}`,
    });
    updateComposition(addMotionTrack(composition, track));
    setActiveTrackId(track.id);
    setActivePointId(track.points[0]?.id ?? null);
  };

  const patchTrack = (
    trackId: string,
    updater: (track: MotionTrack) => MotionTrack,
  ) => {
    updateComposition(updateMotionTrack(composition, trackId, updater));
  };

  const addPoint = () => {
    if (!activeTrack) return;
    const point: MotionTrackPoint = {
      id: makeId("motion-track-point"),
      name: `Track Point ${activeTrack.points.length + 1}`,
      color: activeTrack.points.length === 0 ? "#22d3ee" : "#f59e0b",
      frames: [],
    };
    patchTrack(activeTrack.id, (track) => ({
      ...track,
      points: [...track.points, point],
      modifiedAt: Date.now(),
    }));
    setActivePointId(point.id);
  };

  const addFrame = () => {
    if (!activeTrack || !activePoint) return;
    patchTrack(activeTrack.id, (track) =>
      addMotionTrackPointFrame(track, {
        pointId: activePoint.id,
        frame: {
          time: playhead,
          position: { x: sampleX, y: sampleY, z: 0 },
          confidence: 1,
        },
      }),
    );
  };

  const useSelectedLayerPosition = () => {
    setSampleX(samplePosition.x);
    setSampleY(samplePosition.y);
  };

  const autoTrack = async () => {
    if (!activeTrack || !activePoint || isAutoTracking) return;
    const videoMedia = mediaItems.find(
      (item) =>
        item.type === "video" &&
        (item.blob || item.fileHandle || item.originalUrl),
    );
    if (!videoMedia) {
      toast.error("No video source", "Import a video clip to auto-track from.");
      return;
    }
    setIsAutoTracking(true);
    try {
      const blob = videoMedia.blob
        ? videoMedia.blob
        : videoMedia.fileHandle
          ? await videoMedia.fileHandle.getFile()
          : videoMedia.originalUrl
            ? await (await fetch(videoMedia.originalUrl)).blob()
            : null;
      if (!blob) {
        toast.error("Auto-track failed", "Could not read the video source.");
        return;
      }
      const frames = await autoTrackVideoFeature({
        blob,
        startPosition: { x: sampleX, y: sampleY },
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        duration: composition.duration,
        frameStep: 1 / Math.max(1, composition.frameRate / 2),
        startTime: playhead,
      });
      if (frames.length < 2) {
        toast.error("Auto-track failed", "Could not analyze enough frames.");
        return;
      }
      patchTrack(activeTrack.id, (track) => {
        let next = track;
        for (const frame of frames) {
          next = addMotionTrackPointFrame(next, {
            pointId: activePoint.id,
            frame: {
              time: frame.time,
              position: { x: frame.position.x, y: frame.position.y, z: 0 },
              confidence: frame.confidence,
            },
          });
        }
        return next;
      });
      toast.success("Auto-track complete", `${frames.length} frames tracked.`);
    } catch (error) {
      toast.error(
        "Auto-track failed",
        error instanceof Error ? error.message : "Unexpected tracking error.",
      );
    } finally {
      setIsAutoTracking(false);
    }
  };

  const smoothTrack = () => {
    if (!activeTrack) return;
    patchTrack(activeTrack.id, (track) => smoothMotionTrack(track, smoothWindow));
  };

  const applyTrack = () => {
    if (!activeTrack || !selectedLayer || selectedLayer.locked) return;
    replaceLayer(
      applyMotionTrackToLayer(selectedLayer, activeTrack, {
        mode: applyMode,
        primaryPointId: activePoint?.id,
        secondaryPointId: secondaryPoint?.id,
        preserveOffset,
        smoothWindow,
        idFactory: (property, time, index) =>
          `${selectedLayer.id}-${activeTrack.id}-${property}-${time}-${index}`,
      }),
    );
    setRightTab("graph");
  };

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : (
        <PanelHeader
          title={t("Tracker")}
          icon={Route}
          actions={
            <IconButton
              icon={Plus}
              label={t("Add motion track")}
              size="sm"
              onClick={addTrack}
            />
          }
        />
      )}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title={t("Tracks")} icon={Route}>
          {tracks.length === 0 ? (
            <EmptyState
              icon={Route}
              title={t("No motion tracks")}
              description={t("Create a point track, sample positions over time, then apply it to a selected layer.")}
            />
          ) : (
            <div className="space-y-2">
              {tracks.map((track) => (
                <ToolcraftClickableCard
                  key={track.id}
                  label={`Select ${track.name}`}
                  onClick={() => {
                    setActiveTrackId(track.id);
                    setActivePointId(track.points[0]?.id ?? null);
                  }}
                  active={activeTrack?.id === track.id}
                  variant={activeTrack?.id === track.id ? "selected" : "muted"}
                  padding={3}
                >
                  <span className="flex items-center justify-between gap-2">
                    <ToolcraftText
                      as="span"
                      type="label"
                      color="primary"
                      weight="semibold"
                      maxLines={1}
                    >
                      {track.name}
                    </ToolcraftText>
                    <ToolcraftText
                      as="span"
                      type="supporting"
                      color="secondary"
                      className="shrink-0 tabular-nums"
                    >
                      {countTrackFrames(track)} {t(" frames")}</ToolcraftText>
                  </span>
                  <ToolcraftText type="supporting" color="secondary" maxLines={1} className="mt-1">
                    {track.points.length} {t(" point")}{track.points.length === 1 ? "" : "s"}
                  </ToolcraftText>
                </ToolcraftClickableCard>
              ))}
            </div>
          )}
          <Button label={t("Add Track")} icon={Plus} onClick={addTrack} />
        </Section>

        {activeTrack ? (
          <>
            <Section title={t("Active Track")} icon={SlidersHorizontal}>
              <Field label={t("Name")}>
                <TextInput
                  value={activeTrack.name}
                  onChange={(name) =>
                    patchTrack(activeTrack.id, (track) => ({
                      ...track,
                      name,
                      modifiedAt: Date.now(),
                    }))
                  }
                />
              </Field>
              <Field label={t("Point")}>
                <SelectInput
                  value={activePoint?.id ?? ""}
                  options={activeTrack.points.map((point) => ({
                    value: point.id,
                    label: t(point.name),
                  }))}
                  onChange={setActivePointId}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Button label={t("Add Point")} icon={Crosshair} onClick={addPoint} />
                <Button
                  label={t("Delete")}
                  icon={Trash2}
                  variant="danger"
                  onClick={() => {
                    updateComposition(removeMotionTrack(composition, activeTrack.id));
                    setActiveTrackId(null);
                    setActivePointId(null);
                  }}
                />
              </div>
            </Section>

            <Section title={t("Sample Frame")} icon={LocateFixed}>
              <div className="grid grid-cols-3 gap-2.5">
                <Field label={t("Time")} hint="s">
                  <NumberInput
                    value={playhead}
                    min={0}
                    max={composition.duration}
                    step={1 / Math.max(1, composition.frameRate)}
                    onChange={setPlayhead}
                  />
                </Field>
                <Field label="X">
                  <NumberInput value={sampleX} step={1} onChange={setSampleX} />
                </Field>
                <Field label="Y">
                  <NumberInput value={sampleY} step={1} onChange={setSampleY} />
                </Field>
              </div>
              <Button
                label={t("Add Frame At Playhead")}
                icon={Plus}
                variant="solid"
                disabled={!activePoint}
                onClick={addFrame}
              />
              <Button
                label={t("Use Selected Layer Position")}
                icon={LocateFixed}
                disabled={!selectedLayer}
                onClick={useSelectedLayerPosition}
              />
              <Button
                label={isAutoTracking ? t("Tracking...") : t("Auto-Track From Video")}
                icon={Route}
                disabled={!activePoint || isAutoTracking}
                onClick={() => void autoTrack()}
              />
              {activePoint ? <TrackPointFrames point={activePoint} setPlayhead={setPlayhead} /> : null}
            </Section>

            <Section title={t("Apply")} icon={Route}>
              <Field label={t("Mode")}>
                <SelectInput
                  value={applyMode}
                  options={[
                    { value: "position", label: t("Position") },
                    {
                      value: "position-scale-rotation",
                      label: t("Position, scale, rotation"),
                    },
                  ]}
                  onChange={(mode) =>
                    setApplyMode(mode as MotionTrackingApplyMode)
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label={t("Smooth")}>
                  <NumberInput
                    value={smoothWindow}
                    min={0}
                    max={12}
                    step={1}
                    onChange={setSmoothWindow}
                  />
                </Field>
                <div className="self-end">
                  <SwitchInput
                    label={t("Preserve offset")}
                    checked={preserveOffset}
                    onChange={setPreserveOffset}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  label={t("Smooth")}
                  icon={SlidersHorizontal}
                  onClick={smoothTrack}
                  disabled={countTrackFrames(activeTrack) === 0}
                />
                <Button
                  label={t("Apply")}
                  icon={Route}
                  variant="solid"
                  disabled={
                    !selectedLayer ||
                    selectedLayer.locked ||
                    countTrackFrames(activeTrack) === 0 ||
                    (applyMode === "position-scale-rotation" && !secondaryPoint)
                  }
                  onClick={applyTrack}
                />
              </div>
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TrackPointFrames({
  point,
  setPlayhead,
}: {
  point: MotionTrackPoint;
  setPlayhead: (time: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  if (point.frames.length === 0) {
    return (
      <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
        {t("Add at least two samples to generate useful tracking keyframes.")}</ToolcraftText>
    );
  }

  return (
    <div className="max-h-48 overflow-auto rounded-md border border-border bg-bg-2">
      {point.frames.map((frame) => (
        <ToolcraftClickableCard
          key={`${point.id}-${frame.time}`}
          label={`Go to sample at ${frame.time.toFixed(2)} seconds`}
          onClick={() => setPlayhead(frame.time)}
          variant="transparent"
          padding={2}
          className="border-b border-border last:border-b-0"
        >
          <span className="flex items-center justify-between gap-2">
          <ToolcraftText
            as="span"
            type="supporting"
            color="primary"
            weight="semibold"
            className="tabular-nums"
          >
            {frame.time.toFixed(2)}s
          </ToolcraftText>
          <ToolcraftText
            as="span"
            type="supporting"
            color="secondary"
            className="tabular-nums"
          >
            {Math.round(frame.position.x)}, {Math.round(frame.position.y)}
          </ToolcraftText>
          </span>
        </ToolcraftClickableCard>
      ))}
    </div>
  );
}

function getLayerSamplePosition(
  composition: MotionComposition,
  layer: MotionLayer | null,
  playhead: number,
): { readonly x: number; readonly y: number } {
  if (!layer) return { x: 960, y: 540 };
  const localTime = Math.min(
    layer.duration,
    Math.max(0, playhead - layer.startTime),
  );
  return {
    x: getMotionLayerPropertyValueAtTime(
      layer,
      "transform.position.x",
      localTime,
      composition,
    ),
    y: getMotionLayerPropertyValueAtTime(
      layer,
      "transform.position.y",
      localTime,
      composition,
    ),
  };
}

function countTrackFrames(track: MotionTrack): number {
  return track.points.reduce((count, point) => count + point.frames.length, 0);
}

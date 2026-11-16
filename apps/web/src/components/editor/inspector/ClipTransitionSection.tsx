import type { JSX } from "react";
import { generateKeyframes, detectCurrentTransitions, type TransitionPreset, type ClipLike, type ClipType } from "../../../services/clip-entry-exit-animation";
import React, { useCallback, useState, useMemo, useEffect, useId } from "react";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Eye,
  Circle,
  Square,
  Diamond,
  Star,
  Droplets,
} from "@/icons/lucide-compat";
import type {
  Clip as TimelineClip,
  EasingType,
  Transition,
  TransitionEdge,
} from "@openreel/core";
import { getMediaItemCapabilities } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { TransitionInspector } from "./TransitionInspector";
import { Button, Card, Input, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, ToggleGroup, ToggleGroupItem, cn } from "@openreel/ui";
import { useNumericDraft } from "./shell/useNumericDraft";

const PRESETS: {
  id: TransitionPreset;
  label: string;
  icon: JSX.Element | null;
}[] = [
  { id: "none", label: "None", icon: null },
  { id: "fade", label: "Fade", icon: <Eye size={12} /> },
  { id: "slide-left", label: "Slide Left", icon: <ArrowLeft size={12} /> },
  { id: "slide-right", label: "Slide Right", icon: <ArrowRight size={12} /> },
  { id: "slide-up", label: "Slide Up", icon: <ArrowUp size={12} /> },
  { id: "slide-down", label: "Slide Down", icon: <ArrowDown size={12} /> },
  { id: "zoom-in", label: "Zoom In", icon: <ZoomIn size={12} /> },
  { id: "zoom-out", label: "Zoom Out", icon: <ZoomOut size={12} /> },
  { id: "rotate", label: "Rotate", icon: <RotateCw size={12} /> },
  { id: "blur", label: "Blur", icon: <Droplets size={12} /> },
  { id: "iris-circle", label: "Iris Circle", icon: <Circle size={12} /> },
  { id: "iris-rectangle", label: "Iris Rect", icon: <Square size={12} /> },
  { id: "iris-diamond", label: "Iris Diamond", icon: <Diamond size={12} /> },
  { id: "iris-star", label: "Iris Star", icon: <Star size={12} /> },
];

const EASINGS: { id: EasingType; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "ease-in", label: "Ease In" },
  { id: "ease-out", label: "Ease Out" },
  { id: "ease-in-out", label: "Ease In Out" },
];

interface ClipTransitionSectionProps {
  clipId: string;
}

interface AdjacentTransitionConfig {
  key: "incoming" | "outgoing";
  title: string;
  description: string;
  clipA: TimelineClip;
  clipB: TimelineClip;
  transition?: Transition;
}

interface EdgeTransitionConfig {
  key: "intro" | "outro";
  title: string;
  description: string;
  edge: TransitionEdge;
  transition?: Transition;
}

function AnimationPhaseControls({ side, preset, duration, easing, maxDuration, disabled, onPreset, onDuration, onEasing }: {
  side: "entry" | "exit";
  preset: TransitionPreset;
  duration: number;
  easing: EasingType;
  maxDuration: number;
  disabled: boolean;
  onPreset: (value: TransitionPreset) => void;
  onDuration: (value: number) => void;
  onEasing: (value: EasingType) => void;
}) {
  const durationId = useId();
  const easingId = useId();
  const title = side === "entry" ? "Entry" : "Exit";
  const input = useNumericDraft({ value: duration, onChange: onDuration,
    min: Math.min(0.1, maxDuration), max: maxDuration,
    step: Math.min(0.1, maxDuration) || 0.1,
    format: (value) => String(Number(value.toPrecision(12))) });
  const easings = EASINGS.some((item) => item.id === easing) ? EASINGS : [...EASINGS, { id: easing, label: easing }];
  return <div className="min-w-0 space-y-2">
    <h3 className="text-[11px] font-medium text-fg-2">{title} Animation</h3>
    <ToggleGroup type="single" value={preset} onValueChange={(value) => { if (value) onPreset(value as TransitionPreset); }}
      disabled={disabled} aria-label={`${title} animation preset`} className="grid grid-cols-3 gap-1" variant="outline" size="sm">
      {PRESETS.map((item) => <ToggleGroupItem key={item.id} value={item.id} aria-label={`Set ${side} animation to ${item.label}`}
        className={cn("h-auto min-h-7 min-w-0 gap-1 whitespace-normal rounded-[6px] p-1.5 text-[10px] font-normal",
          preset === item.id ? "border-primary bg-primary text-white data-[state=on]:bg-primary data-[state=on]:text-white" : "border-border bg-bg-2 text-fg-2 hover:bg-bg-3")}>
        {item.icon}<span>{item.label}</span>
      </ToggleGroupItem>)}
    </ToggleGroup>
    {preset !== "none" && <div className="grid min-w-0 grid-cols-2 gap-2">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={durationId} className="text-[11px] font-normal text-fg-2">Duration</Label>
        <div className="relative min-w-0">
          <Input {...input} id={durationId} aria-label={`${title} animation duration`} type="number" inputMode="decimal"
            disabled={disabled} min={Math.min(0.1, maxDuration)} max={maxDuration} step={Math.min(0.1, maxDuration) || 0.1}
            className="h-7 w-full min-w-0 rounded-[6px] border-border bg-bg-1 pl-2 pr-6 text-[12px] font-mono md:text-[12px]" />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-fg-muted">s</span>
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={easingId} className="text-[11px] font-normal text-fg-2">Easing</Label>
        <Select value={easing} onValueChange={(value) => onEasing(value as EasingType)} disabled={disabled}>
          <SelectTrigger id={easingId} aria-label={`${title} animation easing`} className="h-7 w-full min-w-0 rounded-[6px] border-border bg-bg-1 px-2 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>{easings.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>}
  </div>;
}

export const ClipTransitionSection: React.FC<ClipTransitionSectionProps> = ({
  clipId,
}) => {
  const {
    project,
    updateClipKeyframes,
    updateOverlayClipTiming,
    actionExecutor,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    addClipTransition,
    updateClipTransition,
    removeClipTransition,
  } = useProjectStore();
  const { settings } = project;

  const mediaById = useMemo(() => new Map(project.mediaLibrary.items.map((item) => [item.id, item])), [project.mediaLibrary.items]);
  const timelineClipContext = useMemo(() => {
    const track = project.timeline.tracks.find((candidate) => candidate.clips.some((item) => item.id === clipId));
    if (!track) return null;
    const sortedClips = track.clips.filter((item) => getMediaItemCapabilities(mediaById.get(item.mediaId)).visual)
      .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    const clipIndex = sortedClips.findIndex((item) => item.id === clipId);
    if (clipIndex === -1) return null;
    const currentClip = sortedClips[clipIndex];
    const previousClip = sortedClips[clipIndex - 1];
    const nextClip = sortedClips[clipIndex + 1];
    return {
      currentClip, previousClip, nextClip,
      introTransition: track.transitions.find((item) => item.clipAId === clipId && !item.clipBId && (item.edge ?? "out") === "in"),
      outroTransition: track.transitions.find((item) => item.clipAId === clipId && !item.clipBId && (item.edge ?? "out") === "out"),
      incomingTransition: previousClip ? track.transitions.find((item) => item.clipAId === previousClip.id && item.clipBId === clipId) : undefined,
      outgoingTransition: nextClip ? track.transitions.find((item) => item.clipAId === clipId && item.clipBId === nextClip.id) : undefined,
    };
  }, [project.timeline.tracks, mediaById, clipId]);

  const clip = useMemo(() => {
    const regularClip = timelineClipContext?.currentClip;
    if (regularClip)
      return { type: "regular" as const, data: regularClip as ClipLike };

    const textClip = project.textClips?.find((item) => item.id === clipId) ?? getTextClip(clipId);
    if (textClip) return { type: "text" as const, data: textClip as ClipLike };

    const shapeClip = project.shapeClips?.find((item) => item.id === clipId) ?? getShapeClip(clipId);
    if (shapeClip)
      return { type: "shape" as const, data: shapeClip as ClipLike };

    const svgClip = project.svgClips?.find((item) => item.id === clipId) ?? getSVGClip(clipId);
    if (svgClip) return { type: "svg" as const, data: svgClip as ClipLike };

    const stickerClip = project.stickerClips?.find((item) => item.id === clipId) ?? getStickerClip(clipId);
    if (stickerClip)
      return { type: "sticker" as const, data: stickerClip as ClipLike };

    return null;
  }, [
    timelineClipContext,
    clipId,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    project.textClips,
    project.shapeClips,
    project.svgClips,
    project.stickerClips,
  ]);

  const adjacentTransitions = useMemo<AdjacentTransitionConfig[]>(() => {
    if (!timelineClipContext) {
      return [];
    }

    const transitions: AdjacentTransitionConfig[] = [];

    if (timelineClipContext.previousClip) {
      transitions.push({
        key: "incoming",
        title: "Incoming Transition",
        description: "From the previous clip into this clip",
        clipA: timelineClipContext.previousClip,
        clipB: timelineClipContext.currentClip,
        transition: timelineClipContext.incomingTransition,
      });
    }

    if (timelineClipContext.nextClip) {
      transitions.push({
        key: "outgoing",
        title: "Outgoing Transition",
        description: "From this clip into the next clip",
        clipA: timelineClipContext.currentClip,
        clipB: timelineClipContext.nextClip,
        transition: timelineClipContext.outgoingTransition,
      });
    }

    return transitions;
  }, [timelineClipContext]);

  const edgeTransitions = useMemo<EdgeTransitionConfig[]>(() => {
    if (!timelineClipContext) {
      return [];
    }

    return [
      {
        key: "intro",
        title: "Intro Transition",
        description: "From the project background into this clip",
        edge: "in",
        transition: timelineClipContext.introTransition,
      },
      {
        key: "outro",
        title: "Outro Transition",
        description: "From this clip into the project background",
        edge: "out",
        transition: timelineClipContext.outroTransition,
      },
    ];
  }, [timelineClipContext]);

  const handleTransitionCreate = useCallback(
    (transition: Transition) => {
      addClipTransition(transition);
    },
    [addClipTransition],
  );

  const handleTransitionUpdate = useCallback(
    (transitionId: string, updates: Partial<Transition>) => {
      updateClipTransition(transitionId, updates);
    },
    [updateClipTransition],
  );

  const handleTransitionRemove = useCallback(
    (transitionId: string) => {
      removeClipTransition(transitionId);
    },
    [removeClipTransition],
  );

  const locked = project.timeline.tracks.find((track) => track.id === clip?.data.trackId)?.locked ?? false;
  const clipData = clip?.data;
  const detected = useMemo(() => clipData ? detectCurrentTransitions(clipData) : {
    entry: { preset: "none" as TransitionPreset, duration: 0.5, easing: "ease-out" as EasingType },
    exit: { preset: "none" as TransitionPreset, duration: 0.5, easing: "ease-in" as EasingType },
  }, [clipData]);

  const [entryPreset, setEntryPreset] = useState<TransitionPreset>(
    detected.entry.preset,
  );
  const [entryDuration, setEntryDuration] = useState(detected.entry.duration);
  const [entryEasing, setEntryEasing] = useState<EasingType>(
    detected.entry.easing,
  );

  const [exitPreset, setExitPreset] = useState<TransitionPreset>(
    detected.exit.preset,
  );
  const [exitDuration, setExitDuration] = useState(detected.exit.duration);
  const [exitEasing, setExitEasing] = useState<EasingType>(
    detected.exit.easing,
  );

  useEffect(() => {
    setEntryPreset(detected.entry.preset);
    setEntryDuration(detected.entry.duration);
    setEntryEasing(detected.entry.easing);
    setExitPreset(detected.exit.preset);
    setExitDuration(detected.exit.duration);
    setExitEasing(detected.exit.easing);
  }, [detected, clipId, project.id, actionExecutor]);

  const applyTransitions = useCallback(() => {
    const current = useProjectStore.getState();
    if (!clip || current.project.id !== project.id || current.actionExecutor !== actionExecutor) return;
    const currentClip = clip.type === "regular" ? current.getClip(clipId) :
      clip.type === "text" ? current.getTextClip(clipId) :
      clip.type === "shape" ? current.getShapeClip(clipId) :
      clip.type === "svg" ? current.getSVGClip(clipId) : current.getStickerClip(clipId);
    if (!currentClip || currentClip.duration <= 0 || current.project.timeline.tracks.find((track) => track.id === currentClip.trackId)?.locked) return;

    const existingKeyframes = (currentClip.keyframes || []).filter(
      (kf) => !kf.id.startsWith("kf-entry-") && !kf.id.startsWith("kf-exit-"),
    );

    const canvas = { width: settings.width, height: settings.height };
    const clipTypeForKeyframes: ClipType =
      clip.type === "regular" || clip.type === "text" ? clip.type : "graphic";
    const newKeyframes = generateKeyframes(
      currentClip,
      { preset: entryPreset, duration: entryDuration, easing: entryEasing },
      { preset: exitPreset, duration: exitDuration, easing: exitEasing },
      clipTypeForKeyframes,
      canvas,
    );

    const allKeyframes = [...existingKeyframes, ...newKeyframes];

    const updated = clip.type === "regular" ? updateClipKeyframes(clipId, allKeyframes) :
      updateOverlayClipTiming(clipId, { keyframes: allKeyframes });
    if (!updated) {
      toast.error("Animation could not be applied");
      return;
    }

    const parts: string[] = [];
    if (entryPreset !== "none") {
      parts.push(`Entry: ${entryPreset}`);
    }
    if (exitPreset !== "none") {
      parts.push(`Exit: ${exitPreset}`);
    }
    if (parts.length > 0) {
      toast.success("Clip Animation Applied", parts.join(", "));
    } else {
      toast.info("Animations Cleared");
    }
  }, [
    clip,
    clipId,
    entryPreset,
    entryDuration,
    entryEasing,
    exitPreset,
    exitDuration,
    exitEasing,
    updateClipKeyframes,
    updateOverlayClipTiming,
    actionExecutor,
    settings,
    project.id,
  ]);

  if (!clip) return null;

  return (
    <fieldset disabled={locked} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <AnimationPhaseControls key={`${project.id}-${clipId}-entry`} side="entry" preset={entryPreset} duration={entryDuration}
        easing={entryEasing} maxDuration={clip.data.duration / 2} disabled={locked || clip.data.duration <= 0}
        onPreset={setEntryPreset} onDuration={setEntryDuration} onEasing={setEntryEasing} />
      <AnimationPhaseControls key={`${project.id}-${clipId}-exit`} side="exit" preset={exitPreset} duration={exitDuration}
        easing={exitEasing} maxDuration={clip.data.duration / 2} disabled={locked || clip.data.duration <= 0}
        onPreset={setExitPreset} onDuration={setExitDuration} onEasing={setExitEasing} />

      {/* Apply Button */}
      <Button disabled={locked || clip.data.duration <= 0} onClick={applyTransitions} type="button" aria-label="Apply Entry/Exit Animations" className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full justify-center">
        <span className="truncate">{"Apply Entry/Exit Animations"}</span>
      </Button>

      <div className="space-y-3 border-t border-border pt-3">
        <span className="block text-fg-2 text-[10px] font-medium uppercase tracking-wider"
        >
          Single-Clip Transitions
        </span>

        {edgeTransitions.length > 0 ? (
          edgeTransitions.map((edgeTransition) => (
            <Card key={edgeTransition.key} className="min-w-0 rounded-[7px] shadow-none text-fg p-3 space-y-2 border border-border bg-bg-1"
            >
              <div className="space-y-1">
                <span className="text-fg text-[10px] font-medium"
                >
                  {edgeTransition.title}
                </span>
                <span className="block text-fg-2 font-normal text-[9px]"
                >
                  {edgeTransition.description}
                </span>
              </div>

              {timelineClipContext && (
                <TransitionInspector
                  clipA={timelineClipContext.currentClip}
                  edge={edgeTransition.edge}
                  transition={edgeTransition.transition}
                  onTransitionCreate={handleTransitionCreate}
                  onTransitionUpdate={handleTransitionUpdate}
                  onTransitionRemove={handleTransitionRemove}
                />
              )}
            </Card>
          ))
        ) : (
          <span className="block text-fg-2 font-normal text-[10px]">
            Single-clip transitions are available for video and image clips.
          </span>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <span className="block text-fg-2 text-[10px] font-medium uppercase tracking-wider"
        >
          Clip-to-Clip Transitions
        </span>

        {timelineClipContext ? (
          adjacentTransitions.length > 0 ? (
            adjacentTransitions.map((adjacentTransition) => (
              <Card key={adjacentTransition.key} className="min-w-0 rounded-[7px] shadow-none text-fg p-3 space-y-2 border border-border bg-bg-1"
              >
                <div className="space-y-1">
                  <span className="text-fg text-[10px] font-medium"
                  >
                    {adjacentTransition.title}
                  </span>
                  <span className="block text-fg-2 font-normal text-[9px]"
                  >
                    {adjacentTransition.description}
                  </span>
                </div>

                <TransitionInspector
                  clipA={adjacentTransition.clipA}
                  clipB={adjacentTransition.clipB}
                  transition={adjacentTransition.transition}
                  onTransitionCreate={handleTransitionCreate}
                  onTransitionUpdate={handleTransitionUpdate}
                  onTransitionRemove={handleTransitionRemove}
                />
              </Card>
            ))
          ) : (
            <span className="block text-fg-2 font-normal text-[10px]">
              No adjacent clips are available on this track.
            </span>
          )
        ) : (
          <span className="block text-fg-2 font-normal text-[10px]">
            Clip-to-clip transitions are available for timeline media clips.
          </span>
        )}
      </div>
    </fieldset>
  );
};


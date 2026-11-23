import {
  Input as ShadcnNumericInput,
  cn as numericCn,
  Button as ShadcnButton,
  Button,
  Card,
} from "@openreel/ui";
import { useNumericDraft } from "./shell/useNumericDraft";
import { PropertySlider } from "./shell/PropertySlider";

import { useMemo, useRef, useState, type JSX } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Copy,
  Layers,
  RotateCcw,
  Trash2,
} from "@/icons/lucide-compat";
import type { Transform } from "@openreel/core";

import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineSelectionItem } from "../../../utils/timeline-item-actions";
import { buildClipIndex } from "../../../utils/clip-index";
import { getEffectsBridge } from "../../../bridges/effects-bridge";
import { InspectorSection } from "./shell/InspectorSection";
import { NestedSequenceSection } from "./NestedSequenceSection";
import { EssentialSoundSection } from "./EssentialSoundSection";
import { AudioChannelsSection } from "./AudioChannelsSection";
import { TextSection } from "./TextSection";
import {
  cloneVideoEffectStackWithFreshIds,
  copyVideoEffectStack,
  hasVideoEffectStackClipboard,
} from "../../../utils/video-effect-stack-clipboard";

interface MultiClipInspectorProps {
  clipIds: readonly string[];
}

type SelectedClipKind = "timeline" | "text" | "shape" | "svg" | "sticker";

interface SelectedClipEntry {
  readonly id: string;
  readonly kind: SelectedClipKind;
  readonly transform: Transform;
  readonly visual: boolean;
  /** Timeline clips: the audio-bearing and effect facts the panels need, resolved once per project. */
  readonly hasAudio?: boolean;
  readonly hasTimelineEffects?: boolean;
}

const DEFAULT_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

/**
 * The paste button shows the playhead time, so it alone subscribes to it. Subscribing in the inspector made a
 * select-all (1000 clips) re-render the whole multi-clip inspector on every scrub frame.
 */
function PasteClipboardButton({ onPaste, disabled, className }: { onPaste: () => void; disabled: boolean; className: string }): JSX.Element {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const label = `Paste clipboard at ${playheadPosition.toFixed(2)}s`;
  return (
    <Button onClick={onPaste} type="button" aria-label={label} disabled={disabled} className={className}>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ClipboardPaste size={14} aria-hidden />}</span>
      <span className="truncate">{label}</span>
    </Button>
  );
}

export function MultiClipInspector({ clipIds }: MultiClipInspectorProps): JSX.Element {
  const project = useProjectStore((state) => state.project);
  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );
  const updateTextTransform = useProjectStore(
    (state) => state.updateTextTransform,
  );
  const updateShapeTransform = useProjectStore(
    (state) => state.updateShapeTransform,
  );
  const duplicateClip = useProjectStore((state) => state.duplicateClip);
  const getVideoEffects = useProjectStore((state) => state.getVideoEffects);
  const replaceVideoEffects = useProjectStore(
    (state) => state.replaceVideoEffects,
  );
  const duplicateOverlayClip = useProjectStore(
    (state) => state.duplicateOverlayClip,
  );
  const copyClips = useProjectStore((state) => state.copyClips);
  const pasteClips = useProjectStore((state) => state.pasteClips);
  const clipboardSize = useProjectStore((state) => state.clipboard.length);
  const clipboardTrackId = useProjectStore(
    (state) => state.clipboard[0]?.clip.trackId ?? "",
  );
  const removeClip = useProjectStore((state) => state.removeClip);
  const deleteTextClip = useProjectStore((state) => state.deleteTextClip);
  const deleteShapeClip = useProjectStore((state) => state.deleteShapeClip);
  const deleteSVGClip = useProjectStore((state) => state.deleteSVGClip);
  const deleteStickerClip = useProjectStore((state) => state.deleteStickerClip);
  const beginHistoryGroup = useProjectStore((state) => state.beginHistoryGroup);
  const endHistoryGroup = useProjectStore((state) => state.endHistoryGroup);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const selectMultiple = useUIStore((state) => state.selectMultiple);
  const [isBusy, setIsBusy] = useState(false);
  const [hasEffectClipboard, setHasEffectClipboard] = useState(
    hasVideoEffectStackClipboard(),
  );
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingOperationCountRef = useRef(0);

  // Resolved against one id index per project: a select-all otherwise did an O(clips) lookup per selected clip.
  const selectedEntries = useMemo(() => {
    const titleEngine = getTitleEngine();
    const graphicsEngine = getGraphicsEngine();
    const index = buildClipIndex(project.timeline.tracks);
    const media = new Map(project.mediaLibrary.items.map((item) => [item.id, item] as const));
    return clipIds.flatMap<SelectedClipEntry>((id) => {
      const textClip = titleEngine?.getTextClip(id);
      if (textClip) {
        return [
          {
            id,
            kind: "text",
            transform: textClip.transform ?? DEFAULT_TRANSFORM,
            visual: true,
          },
        ];
      }
      const shapeClip = graphicsEngine?.getShapeClip(id);
      if (shapeClip) {
        return [
          {
            id,
            kind: "shape",
            transform: shapeClip.transform ?? DEFAULT_TRANSFORM,
            visual: true,
          },
        ];
      }
      const svgClip = graphicsEngine?.getSVGClip(id);
      if (svgClip) {
        return [
          {
            id,
            kind: "svg",
            transform: svgClip.transform ?? DEFAULT_TRANSFORM,
            visual: true,
          },
        ];
      }
      const stickerClip = graphicsEngine?.getStickerClip(id);
      if (stickerClip) {
        return [
          {
            id,
            kind: "sticker",
            transform: stickerClip.transform ?? DEFAULT_TRANSFORM,
            visual: true,
          },
        ];
      }
      const timelineClip = index.clips.get(id);
      if (timelineClip) {
        const track = index.tracks.get(timelineClip.trackId);
        const source = media.get(timelineClip.mediaId);
        return [
          {
            id,
            kind: "timeline",
            transform: timelineClip.transform ?? DEFAULT_TRANSFORM,
            visual: track?.type !== "audio",
            hasAudio:
              track?.type === "audio" ||
              source?.type === "audio" ||
              (source?.type === "video" && (source.metadata?.channels ?? 0) > 0),
            hasTimelineEffects: (timelineClip.effects?.length ?? 0) > 0,
          },
        ];
      }
      return [];
    });
  }, [clipIds, getGraphicsEngine, getTitleEngine, project]);

  const visualEntries = selectedEntries.filter((entry) => entry.visual);
  // Essential Sound applies to every selected timeline clip that has audio.
  const audioClipIds = selectedEntries
    .filter((entry) => entry.kind === "timeline" && entry.hasAudio)
    .map((entry) => entry.id);
  const timelineEntryCount = selectedEntries.filter(
    (entry) => entry.kind === "timeline",
  ).length;
  const selectedTextClipIds = selectedEntries
    .filter((entry) => entry.kind === "text")
    .map((entry) => entry.id);
  const averageScale = average(
    visualEntries.map((entry) => (entry.transform.scale.x + entry.transform.scale.y) / 2),
    1,
  );
  const averageOpacity = average(
    visualEntries.map((entry) => entry.transform.opacity),
    1,
  );
  const averageRotation = average(
    visualEntries.map((entry) => entry.transform.rotation),
    0,
  );
  const mixedScale = hasMixedValues(
    visualEntries.map((entry) => entry.transform.scale.x),
  );
  const mixedOpacity = hasMixedValues(
    visualEntries.map((entry) => entry.transform.opacity),
  );
  const mixedRotation = hasMixedValues(
    visualEntries.map((entry) => entry.transform.rotation),
  );

  const runHistoryGroup = async (label: string, operation: () => Promise<void>) => {
    pendingOperationCountRef.current += 1;
    setIsBusy(true);
    const queued = operationQueueRef.current.then(async () => {
      beginHistoryGroup(label);
      try {
        await operation();
      } finally {
        endHistoryGroup();
      }
    });
    const settled = queued.catch((error) => {
      console.error(`[Batch inspector] ${label} failed`, error);
    });
    operationQueueRef.current = settled;
    await settled;
    pendingOperationCountRef.current = Math.max(
      0,
      pendingOperationCountRef.current - 1,
    );
    if (pendingOperationCountRef.current === 0) setIsBusy(false);
  };

  const updateVisualEntries = (
    label: string,
    updates: (entry: SelectedClipEntry) => Partial<Transform>,
  ) =>
    runHistoryGroup(label, async () => {
      for (const entry of visualEntries) {
        const transform = updates(entry);
        if (entry.kind === "text") updateTextTransform(entry.id, transform);
        else if (
          entry.kind === "shape" ||
          entry.kind === "svg" ||
          entry.kind === "sticker"
        ) {
          updateShapeTransform(entry.id, transform);
        } else {
          await updateClipTransform(entry.id, transform);
        }
      }
    });

  const nudgeSelection = (x: number, y: number) =>
    updateVisualEntries("Nudge selected clips", (entry) => {
      const usesNormalizedPosition = entry.kind !== "timeline";
      const deltaX = usesNormalizedPosition
        ? x / Math.max(1, project.settings.width)
        : x;
      const deltaY = usesNormalizedPosition
        ? y / Math.max(1, project.settings.height)
        : y;
      return {
        position: {
          x: entry.transform.position.x + deltaX,
          y: entry.transform.position.y + deltaY,
        },
      };
    });

  const canvasPosition = (entry: SelectedClipEntry) => ({
    x:
      entry.kind === "timeline"
        ? entry.transform.position.x + project.settings.width / 2
        : entry.transform.position.x * project.settings.width,
    y:
      entry.kind === "timeline"
        ? entry.transform.position.y + project.settings.height / 2
        : entry.transform.position.y * project.settings.height,
  });

  const positionForEntry = (
    entry: SelectedClipEntry,
    position: { x: number; y: number },
  ) => ({
    x:
      entry.kind === "timeline"
        ? position.x - project.settings.width / 2
        : position.x / Math.max(1, project.settings.width),
    y:
      entry.kind === "timeline"
        ? position.y - project.settings.height / 2
        : position.y / Math.max(1, project.settings.height),
  });

  const alignSelection = (axis: "x" | "y", value: number, label: string) =>
    updateVisualEntries(label, (entry) => {
      const current = canvasPosition(entry);
      return {
        position: positionForEntry(entry, { ...current, [axis]: value }),
      };
    });

  const distributeSelection = (axis: "x" | "y") => {
    if (visualEntries.length < 3) return Promise.resolve();
    const sorted = [...visualEntries].sort(
      (left, right) => canvasPosition(left)[axis] - canvasPosition(right)[axis],
    );
    const first = canvasPosition(sorted[0])[axis];
    const last = canvasPosition(sorted[sorted.length - 1])[axis];
    const spacing = (last - first) / (sorted.length - 1);
    const positions = new Map(
      sorted.map((entry, index) => [entry.id, first + spacing * index]),
    );
    return updateVisualEntries(
      axis === "x" ? "Distribute clips horizontally" : "Distribute clips vertically",
      (entry) => {
        const current = canvasPosition(entry);
        return {
          position: positionForEntry(entry, {
            ...current,
            [axis]: positions.get(entry.id) ?? current[axis],
          }),
        };
      },
    );
  };

  const duplicateSelection = () =>
    runHistoryGroup("Duplicate selected clips", async () => {
      for (const entry of selectedEntries) {
        if (entry.kind === "timeline") await duplicateClip(entry.id);
        else duplicateOverlayClip(entry.id);
      }
    });

  const copySelection = () => {
    copyClips(selectedEntries.map((entry) => entry.id));
  };

  const pasteClipboard = async () => {
    await pasteClips(clipboardTrackId, useTimelineStore.getState().playheadPosition);
    const pastedSelection = useProjectStore
      .getState()
      .lastPastedClipIds.flatMap((id) => {
        const item = getTimelineSelectionItem(useProjectStore.getState(), id);
        return item ? [item] : [];
      });
    if (pastedSelection.length > 0) selectMultiple(pastedSelection);
  };

  const deleteSelection = () =>
    runHistoryGroup("Delete selected clips", async () => {
      for (const entry of selectedEntries) {
        if (entry.kind === "timeline") await removeClip(entry.id);
        else if (entry.kind === "text") deleteTextClip(entry.id);
        else if (entry.kind === "shape") deleteShapeClip(entry.id);
        else if (entry.kind === "svg") deleteSVGClip(entry.id);
        else deleteStickerClip(entry.id);
      }
      clearSelection();
    });

  // Timeline clips answer from the resolved entry (their effects live on the clip) and the effects bridge;
  // only overlay items fall back to the per-id store lookup.
  const hasAnyVideoEffects = visualEntries.some((entry) => {
    if (entry.kind !== "timeline") return getVideoEffects(entry.id).length > 0;
    if (entry.hasTimelineEffects) return true;
    const bridge = getEffectsBridge();
    return bridge.isInitialized() && bridge.getEffects(entry.id).length > 0;
  });

  const sourceEffects = visualEntries[0]
    ? getVideoEffects(visualEntries[0].id)
    : [];

  const copyFirstEffectStack = () => {
    copyVideoEffectStack(sourceEffects);
    setHasEffectClipboard(true);
  };

  const pasteEffectsToSelection = (mode: "append" | "replace") =>
    runHistoryGroup(
      mode === "append"
        ? "Append effects to selected clips"
        : "Replace effects on selected clips",
      async () => {
        for (const entry of visualEntries) {
          const copies = cloneVideoEffectStackWithFreshIds();
          if (!copies) return;
          const next =
            mode === "replace"
              ? copies
              : [...getVideoEffects(entry.id), ...copies];
          await replaceVideoEffects(entry.id, next);
        }
      },
    );

  const clearSelectedEffectStacks = () =>
    runHistoryGroup("Clear effects from selected clips", async () => {
      for (const entry of visualEntries) {
        await replaceVideoEffects(entry.id, []);
      }
    });

  const numericField0 = useNumericDraft({value: averageRotation, onChange: (value) =>
                    void updateVisualEntries("Rotate selected clips", () => ({
                      rotation: value,
                    })), min: -180, max: 180, step: 1});
  return (
    <div className="space-y-4">
      <Card className="min-w-0 shadow-none text-fg p-3 rounded-lg border border-accent/30 bg-accent-soft"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Layers size={16} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="text-[13px] leading-5 font-bold block text-fg">
              {clipIds.length} clip{clipIds.length === 1 ? "" : "s"} selected
            </span>
            <span className="font-normal block text-[10px] text-fg-3">
              Batch changes stay synchronized with the timeline
            </span>
          </span>
        </div>
      </Card>

      {audioClipIds.length > 0 && (
        <InspectorSection title="Essential Sound" sectionId="essential-sound" defaultOpen>
          <EssentialSoundSection clipIds={audioClipIds} />
        </InspectorSection>
      )}
      {audioClipIds.length > 0 && (
        <InspectorSection title="Audio channels" sectionId="audio-channels" defaultOpen>
          <AudioChannelsSection clipIds={audioClipIds} />
        </InspectorSection>
      )}

      {visualEntries.length > 0 ? (
        <InspectorSection
          title="Batch Transform"
          sectionId="batch-transform"
          defaultOpen
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-[74px] text-[12px] font-medium text-fg-3">
                Nudge
              </span>
              <div className="grid flex-1 grid-cols-4 gap-1.5">
                <BatchIconButton label="Nudge clips left" icon={ArrowLeft} onClick={() => nudgeSelection(-10, 0)} disabled={isBusy} />
                <BatchIconButton label="Nudge clips up" icon={ArrowUp} onClick={() => nudgeSelection(0, -10)} disabled={isBusy} />
                <BatchIconButton label="Nudge clips down" icon={ArrowDown} onClick={() => nudgeSelection(0, 10)} disabled={isBusy} />
                <BatchIconButton label="Nudge clips right" icon={ArrowRight} onClick={() => nudgeSelection(10, 0)} disabled={isBusy} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-[74px] text-[12px] font-medium text-fg-3">
                Align
              </span>
              <div className="grid flex-1 grid-cols-3 gap-1.5">
                <BatchIconButton label="Align positions left" icon={ArrowLeft} onClick={() => alignSelection("x", 0, "Align clips left")} disabled={isBusy} />
                <BatchIconButton label="Align positions center" icon={Layers} onClick={() => alignSelection("x", project.settings.width / 2, "Align clips horizontally")} disabled={isBusy} />
                <BatchIconButton label="Align positions right" icon={ArrowRight} onClick={() => alignSelection("x", project.settings.width, "Align clips right")} disabled={isBusy} />
                <BatchIconButton label="Align positions top" icon={ArrowUp} onClick={() => alignSelection("y", 0, "Align clips top")} disabled={isBusy} />
                <BatchIconButton label="Align positions middle" icon={Layers} onClick={() => alignSelection("y", project.settings.height / 2, "Align clips vertically")} disabled={isBusy} />
                <BatchIconButton label="Align positions bottom" icon={ArrowDown} onClick={() => alignSelection("y", project.settings.height, "Align clips bottom")} disabled={isBusy} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => void distributeSelection("x")} type="button" aria-label="Distribute horizontally" disabled={(isBusy || visualEntries.length < 3)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                <span className="truncate">{"Distribute horizontally"}</span>
              </Button>
              <Button onClick={() => void distributeSelection("y")} type="button" aria-label="Distribute vertically" disabled={(isBusy || visualEntries.length < 3)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                <span className="truncate">{"Distribute vertically"}</span>
              </Button>
            </div>

            <BatchSlider
              label="Scale"
              mixed={mixedScale}
              value={averageScale * 100}
              max={300}
              formatValue={(value) => `${Math.round(value)}%`}
              disabled={false}
              onChange={(value) =>
                void updateVisualEntries("Scale selected clips", () => ({
                  scale: { x: value / 100, y: value / 100 },
                }))
              }
            />
            <div className="flex items-center gap-3">
              <span className="w-[74px] text-[12px] font-medium text-fg-3">
                Rotation
              </span>
              <div className="min-w-0 flex-1">
                <ShadcnNumericInput
                  {...numericField0}
                  type="number"
                  inputMode="decimal"
                  aria-label={"Selected clips rotation"}
                  min={-180}
                  max={180}
                  step={1}
                  disabled={false}
                  style={{ width: "100%" }}
                  className={numericCn(
                    "h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 font-mono text-[13px] font-medium tabular-nums text-fg-2 md:text-[13px]",
                  )}
                />
              </div>
              {mixedRotation ? <MixedBadge /> : null}
            </div>
            <BatchSlider
              label="Opacity"
              mixed={mixedOpacity}
              value={averageOpacity * 100}
              max={100}
              formatValue={(value) => `${Math.round(value)}%`}
              disabled={false}
              onChange={(value) =>
                void updateVisualEntries("Set selected clip opacity", () => ({
                  opacity: value / 100,
                }))
              }
            />
          </div>
        </InspectorSection>
      ) : null}

      {selectedTextClipIds.length > 0 ? (
        <InspectorSection
          title="Batch Text"
          sectionId="batch-text"
          defaultOpen
        >
          <TextSection
            clipId={selectedTextClipIds[0]}
            clipIds={selectedTextClipIds}
          />
        </InspectorSection>
      ) : null}

      {visualEntries.length > 0 ? (
        <InspectorSection
          title="Batch Effects"
          sectionId="batch-effects"
          defaultOpen
        >
          <div className="space-y-2">
            <span className="font-normal block text-[10px] text-fg-3"
            >
              Copy from the first selected visual layer, then apply the stack to
              all {visualEntries.length} selected visual layers.
            </span>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={copyFirstEffectStack} type="button" aria-label="Copy first effect stack" disabled={(isBusy || sourceEffects.length === 0)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Copy size={14} aria-hidden />}</span>
                <span className="truncate">{"Copy first effect stack"}</span>
              </Button>
              <Button onClick={() => void pasteEffectsToSelection("append")} type="button" aria-label="Append effects to selection" disabled={(isBusy || !hasEffectClipboard)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ClipboardPaste size={14} aria-hidden />}</span>
                <span className="truncate">{"Append effects to selection"}</span>
              </Button>
              <Button onClick={() => void pasteEffectsToSelection("replace")} type="button" aria-label="Replace effects on selection" disabled={(isBusy || !hasEffectClipboard)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ClipboardPaste size={14} aria-hidden />}</span>
                <span className="truncate">{"Replace effects on selection"}</span>
              </Button>
              <Button onClick={() => void clearSelectedEffectStacks()} type="button" aria-label="Clear effects from selection" disabled={(isBusy ||
                  !hasAnyVideoEffects)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Trash2 size={14} aria-hidden />}</span>
                <span className="truncate">{"Clear effects from selection"}</span>
              </Button>
            </div>
          </div>
        </InspectorSection>
      ) : null}

      <InspectorSection
        title="Selection Actions"
        sectionId="batch-actions"
        defaultOpen
      >
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() =>
              void updateVisualEntries("Reset selected clip transforms", (entry) => ({
                position:
                  entry.kind === "timeline"
                    ? { x: 0, y: 0 }
                    : { x: 0.5, y: 0.5 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                opacity: 1,
              }))
            } type="button" aria-label="Reset transforms" disabled={(isBusy || visualEntries.length === 0)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<RotateCcw size={14} aria-hidden />}</span>
            <span className="truncate">{"Reset transforms"}</span>
          </Button>
          <Button onClick={copySelection} type="button" aria-label={(`Copy ${selectedEntries.length} selected clips`).trim() || undefined} disabled={(isBusy || selectedEntries.length === 0)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Copy size={14} aria-hidden />}</span>
            <span className="truncate">{`Copy ${selectedEntries.length} selected clips`}</span>
          </Button>
          <PasteClipboardButton onPaste={() => void pasteClipboard()} disabled={isBusy || clipboardSize === 0} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg" />
          <Button onClick={() => void duplicateSelection()} type="button" aria-label={(`Duplicate ${selectedEntries.length} selected clips`).trim() || undefined} disabled={(isBusy || selectedEntries.length === 0)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Copy size={14} aria-hidden />}</span>
            <span className="truncate">{`Duplicate ${selectedEntries.length} selected clips`}</span>
          </Button>
          <Button onClick={() => void deleteSelection()} type="button" aria-label="Delete selected clips" disabled={(false)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-status-error text-white hover:bg-status-error/90 col-span-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Trash2 size={14} aria-hidden />}</span>
            <span className="truncate">{"Delete selected clips"}</span>
          </Button>
        </div>
      </InspectorSection>

      {timelineEntryCount >= 2 ? (
        <InspectorSection
          title="Compound Clip"
          sectionId="batch-compound"
          defaultOpen
        >
          <NestedSequenceSection clipId={clipIds[0] ?? ""} />
        </InspectorSection>
      ) : null}
    </div>
  );
}

function BatchSlider({
  label,
  mixed,
  value,
  max,
  formatValue,
  disabled,
  onChange,
}: {
  label: string;
  mixed: boolean;
  value: number;
  max: number;
  formatValue: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[74px] text-[12px] font-medium text-fg-3">{label}</span>
      <PropertySlider ariaLabel={label}
value={value}
min={0}
max={max}
step={1}
onChange={onChange}
isDisabled={disabled}
label={label}
showValueLabel
className="min-w-0 flex-1"
formatValue={formatValue} />
      {mixed ? <MixedBadge /> : null}
    </div>
  );
}

function MixedBadge(): JSX.Element {
  return (
    <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fg-muted">
      Mixed
    </span>
  );
}

function BatchIconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof ArrowLeft;
  onClick: () => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <ShadcnButton
      variant="ghost"
      size="sm"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center justify-center rounded-[7px] border p-0 [&_svg]:size-3.5 border-border bg-bg-2 text-fg-3 transition-colors hover:border-accent/50 hover:text-accent disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon size={14} aria-hidden />
    </ShadcnButton>
  );
}

function average(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function hasMixedValues(values: readonly number[]): boolean {
  if (values.length < 2) return false;
  return values.some((value) => Math.abs(value - values[0]) > 1 / 1000);
}

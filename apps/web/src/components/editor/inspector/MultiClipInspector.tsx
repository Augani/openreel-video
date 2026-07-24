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
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftNumberInputControl,
  ToolcraftSliderControl,
  ToolcraftText as Text,
} from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineSelectionItem } from "../../../utils/timeline-item-actions";
import { InspectorSection } from "./shell/InspectorSection";
import { NestedSequenceSection } from "./NestedSequenceSection";
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
}

const DEFAULT_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

export function MultiClipInspector({ clipIds }: MultiClipInspectorProps): JSX.Element {
  const project = useProjectStore((state) => state.project);
  const getClip = useProjectStore((state) => state.getClip);
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
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const [isBusy, setIsBusy] = useState(false);
  const [hasEffectClipboard, setHasEffectClipboard] = useState(
    hasVideoEffectStackClipboard(),
  );
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingOperationCountRef = useRef(0);

  const selectedEntries = useMemo(() => {
    const titleEngine = getTitleEngine();
    const graphicsEngine = getGraphicsEngine();
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
      const timelineClip = getClip(id);
      if (timelineClip) {
        const track = project.timeline.tracks.find((candidate) =>
          candidate.clips.some((clip) => clip.id === id),
        );
        return [
          {
            id,
            kind: "timeline",
            transform: timelineClip.transform ?? DEFAULT_TRANSFORM,
            visual: track?.type !== "audio",
          },
        ];
      }
      return [];
    });
  }, [clipIds, getClip, getGraphicsEngine, getTitleEngine, project]);

  const visualEntries = selectedEntries.filter((entry) => entry.visual);
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
    await pasteClips(clipboardTrackId, playheadPosition);
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

  return (
    <div className="space-y-4">
      <Card
        variant="green"
        padding={3}
        className="rounded-lg border border-accent/30 bg-accent-soft"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Layers size={16} aria-hidden />
          </span>
          <span className="min-w-0">
            <Text type="body" weight="bold" display="block" className="text-fg">
              {clipIds.length} clip{clipIds.length === 1 ? "" : "s"} selected
            </Text>
            <Text type="supporting" display="block" className="text-[10px] text-fg-3">
              Batch changes stay synchronized with the timeline
            </Text>
          </span>
        </div>
      </Card>

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
              <Button
                label="Distribute horizontally"
                variant="outline"
                disabled={isBusy || visualEntries.length < 3}
                onClick={() => void distributeSelection("x")}
              />
              <Button
                label="Distribute vertically"
                variant="outline"
                disabled={isBusy || visualEntries.length < 3}
                onClick={() => void distributeSelection("y")}
              />
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
                <ToolcraftNumberInputControl
                  label="Selected clips rotation"
                  isLabelHidden
                  value={averageRotation}
                  min={-180}
                  max={180}
                  step={1}
                  disabled={false}
                  onChange={(value) =>
                    void updateVisualEntries("Rotate selected clips", () => ({
                      rotation: value,
                    }))
                  }
                  width="100%"
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
            <Text
              type="supporting"
              display="block"
              className="text-[10px] text-fg-3"
            >
              Copy from the first selected visual layer, then apply the stack to
              all {visualEntries.length} selected visual layers.
            </Text>
            <div className="grid grid-cols-2 gap-2">
              <Button
                label="Copy first effect stack"
                icon={<Copy size={14} aria-hidden />}
                variant="outline"
                disabled={isBusy || sourceEffects.length === 0}
                onClick={copyFirstEffectStack}
              />
              <Button
                label="Append effects to selection"
                icon={<ClipboardPaste size={14} aria-hidden />}
                variant="outline"
                disabled={isBusy || !hasEffectClipboard}
                onClick={() => void pasteEffectsToSelection("append")}
              />
              <Button
                label="Replace effects on selection"
                icon={<ClipboardPaste size={14} aria-hidden />}
                variant="outline"
                disabled={isBusy || !hasEffectClipboard}
                onClick={() => void pasteEffectsToSelection("replace")}
              />
              <Button
                label="Clear effects from selection"
                icon={<Trash2 size={14} aria-hidden />}
                variant="outline"
                disabled={
                  isBusy ||
                  !visualEntries.some(
                    (entry) => getVideoEffects(entry.id).length > 0,
                  )
                }
                onClick={() => void clearSelectedEffectStacks()}
              />
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
          <Button
            label="Reset transforms"
            icon={<RotateCcw size={14} aria-hidden />}
            variant="outline"
            disabled={isBusy || visualEntries.length === 0}
            onClick={() =>
              void updateVisualEntries("Reset selected clip transforms", (entry) => ({
                position:
                  entry.kind === "timeline"
                    ? { x: 0, y: 0 }
                    : { x: 0.5, y: 0.5 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                opacity: 1,
              }))
            }
          />
          <Button
            label={`Copy ${selectedEntries.length} selected clips`}
            icon={<Copy size={14} aria-hidden />}
            variant="outline"
            disabled={isBusy || selectedEntries.length === 0}
            onClick={copySelection}
          />
          <Button
            label={`Paste clipboard at ${playheadPosition.toFixed(2)}s`}
            icon={<ClipboardPaste size={14} aria-hidden />}
            variant="outline"
            disabled={isBusy || clipboardSize === 0}
            onClick={() => void pasteClipboard()}
          />
          <Button
            label={`Duplicate ${selectedEntries.length} selected clips`}
            icon={<Copy size={14} aria-hidden />}
            variant="outline"
            disabled={isBusy || selectedEntries.length === 0}
            onClick={() => void duplicateSelection()}
          />
          <Button
            label="Delete selected clips"
            icon={<Trash2 size={14} aria-hidden />}
            variant="destructive"
            disabled={false}
            onClick={() => void deleteSelection()}
            className="col-span-2"
          />
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
      <ToolcraftSliderControl
        label={label}
        value={value}
        min={0}
        max={max}
        step={1}
        disabled={disabled}
        showValueLabel
        formatValue={formatValue}
        onChange={onChange}
        className="min-w-0 flex-1"
      />
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
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center justify-center rounded-[7px] border border-border bg-bg-2 text-fg-3 transition-colors hover:border-accent/50 hover:text-accent disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon size={14} aria-hidden />
    </button>
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

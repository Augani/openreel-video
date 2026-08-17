import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Square,
  Circle,
  Pentagon,
  Pen,
  Layers,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCw,
  Plus,
  Minus,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftNumberInputControl as NumberInput } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import type { BezierPath, Mask, MaskShape } from "@openreel/core";
import { boundsPathFromTransform } from "@openreel/core";
import { useTranslation } from "react-i18next";

interface MaskSectionProps {
  clipId: string;
}

type MaskShapeType = "rectangle" | "ellipse" | "polygon";

const MASK_SHAPES: { id: MaskShapeType; name: string; icon: LucideIcon }[] = [
  { id: "rectangle", name: "Rectangle", icon: Square },
  { id: "ellipse", name: "Ellipse", icon: Circle },
  { id: "polygon", name: "Polygon", icon: Pentagon },
];

interface MatteSourceOption {
  id: string;
  label: string;
}

const MaskItem: React.FC<{
  mask: Mask;
  isSelected: boolean;
  isExpanded: boolean;
  matteSourceOptions: MatteSourceOption[];
  ownClipId: string;
  onSelect: () => void;
  onToggleExpand: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateFeathering: (value: number) => void;
  onUpdateExpansion: (value: number) => void;
  onUpdateOpacity: (value: number) => void;
  onToggleInvert: () => void;
  onUpdatePath: (path: BezierPath) => void;
  onSetMatteSource: (
    sourceClipId: string,
    matteSource: "alpha" | "luminance" | "bounds",
  ) => void;
}> = ({
  mask,
  isSelected,
  isExpanded,
  matteSourceOptions,
  ownClipId,
  onSelect,
  onToggleExpand,
  onDelete,
  onDuplicate,
  onUpdateFeathering,
  onUpdateExpansion,
  onUpdateOpacity,
  onToggleInvert,
  onUpdatePath,
  onSetMatteSource,
}) => {
  const { t: tr } = useTranslation();
  const maskTypeIcon =
    mask.type === "shape"
      ? Square
      : mask.type === "track-matte"
        ? Layers
        : Pen;
  const MaskIcon = maskTypeIcon;
  const maskLabel =
    mask.type === "shape"
      ? "Shape Mask"
      : mask.type === "track-matte"
        ? "Track Matte"
        : "Drawn Mask";
  // Avoid self-referential mattes
  const availableSources = matteSourceOptions.filter(
    (opt) => opt.id !== ownClipId,
  );

  return (
    <Card
      variant={isSelected ? "green" : "muted"}
      padding={0}
      className={`overflow-hidden border transition-colors ${
        isSelected ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <div
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center gap-2 p-2 hover:bg-bg-2"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <IconButton
          label={isExpanded ? tr("Collapse mask") : tr("Expand mask")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          variant="ghost"
          size="sm"
          icon={
            isExpanded ? (
              <ChevronDown size={12} className="text-fg-3" aria-hidden />
            ) : (
              <ChevronRight size={12} className="text-fg-3" aria-hidden />
            )
          }
        />
        <MaskIcon size={12} className="text-primary" />
        <Text
          type="supporting"
          color="primary"
          className="flex-1 text-left text-[10px] font-medium"
        >
          {maskLabel}
        </Text>
        <IconButton
          label={mask.inverted ? tr("Mask Inverted") : tr("Mask Normal")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleInvert();
          }}
          variant="ghost"
          size="sm"
          icon={mask.inverted ? <EyeOff size={10} aria-hidden /> : <Eye size={10} aria-hidden />}
          className={
            mask.inverted
              ? "bg-amber-500/20 text-amber-400"
              : "text-fg-3 hover:text-fg"
          }
        />
        <IconButton
          label={tr("Duplicate Mask")}
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          variant="ghost"
          size="sm"
          icon={<Copy size={10} aria-hidden />}
          className="text-fg-3 hover:text-fg"
        />
        <IconButton
          label={tr("Delete Mask")}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          variant="ghost"
          size="sm"
          icon={<Trash2 size={10} aria-hidden />}
          className="text-fg-3 hover:text-red-400"
        />
      </div>

      {isExpanded && (
        <div className="p-2 space-y-3 border-t border-border bg-bg-2/50">
          {mask.type === "drawn" && (
            <div className="space-y-2 rounded border border-border bg-bg-1 p-2">
              <div className="flex items-center justify-between gap-2">
                <Text type="supporting" color="primary" className="text-[9.5px] font-medium">
                  {tr("Path points")}</Text>
                <Button
                  label={tr("Add path point")}
                  onClick={() => {
                    const last = mask.path.points.at(-1) ?? { x: 0.5, y: 0.5 };
                    onUpdatePath({
                      ...mask.path,
                      points: [
                        ...mask.path.points,
                        {
                          x: Math.min(1, last.x + 0.05),
                          y: Math.min(1, last.y + 0.05),
                        },
                      ],
                    });
                  }}
                  icon={<Plus size={10} aria-hidden />}
                  variant="ghost"
                  size="sm"
                />
              </div>
              <div className="max-h-44 space-y-1.5 overflow-auto pr-0.5">
                {mask.path.points.map((point, index) => (
                  <div key={`${mask.id}-point-${index}`} className="grid grid-cols-[22px_1fr_1fr_24px] items-center gap-1">
                    <Text type="supporting" color="secondary" className="text-[8.5px]">
                      {index + 1}
                    </Text>
                    <NumberInput
                      ariaLabel={`Point ${index + 1} X percent`}
                      size="sm"
                      value={point.x * 100}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(value) => {
                        const points = mask.path.points.map((candidate, pointIndex) =>
                          pointIndex === index
                            ? { ...candidate, x: value / 100 }
                            : candidate,
                        );
                        onUpdatePath({ ...mask.path, points });
                      }}
                    />
                    <NumberInput
                      ariaLabel={`Point ${index + 1} Y percent`}
                      size="sm"
                      value={point.y * 100}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(value) => {
                        const points = mask.path.points.map((candidate, pointIndex) =>
                          pointIndex === index
                            ? { ...candidate, y: value / 100 }
                            : candidate,
                        );
                        onUpdatePath({ ...mask.path, points });
                      }}
                    />
                    <IconButton
                      label={`Remove path point ${index + 1}`}
                      onClick={() =>
                        onUpdatePath({
                          ...mask.path,
                          points: mask.path.points.filter(
                            (_, pointIndex) => pointIndex !== index,
                          ),
                        })
                      }
                      isDisabled={mask.path.points.length <= 3}
                      variant="ghost"
                      size="sm"
                      icon={<Minus size={10} aria-hidden />}
                    />
                  </div>
                ))}
              </div>
              <Text type="supporting" color="secondary" className="text-[8px] leading-tight">
                {tr("X and Y are composition percentages. Adjust points for precise custom cutouts.")}</Text>
            </div>
          )}
          {mask.type === "track-matte" && (
            <div className="space-y-2 p-2 bg-primary/5 border border-primary/20 rounded">
              <div className="flex items-center gap-1.5">
                <Layers size={11} className="text-primary" />
                <Text type="supporting" color="primary" className="text-[9.5px] font-medium">
                  {tr("Matte source")}</Text>
              </div>
              <Selector
                label={tr("Matte source")}
                isLabelHidden
                size="sm"
                width="100%"
                value={mask.sourceClipId ?? ""}
                onChange={(v) =>
                  onSetMatteSource(v, mask.matteSource ?? "bounds")
                }
                placeholder={tr("Pick a clip...")}
                isDisabled={availableSources.length === 0}
                options={availableSources.map((opt) => ({
                  label: tr(opt.label),
                  value: opt.id,
                }))}
              />
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[9px]">
                  {tr("Channel")}</Text>
                <div className="flex gap-1">
                  {(["bounds", "alpha", "luminance"] as const).map((m) => (
                    <Button
                      key={m}
                      label={m}
                      onClick={() =>
                        onSetMatteSource(mask.sourceClipId ?? "", m)
                      }
                      isDisabled={!mask.sourceClipId}
                      variant={(mask.matteSource ?? "bounds") === m ? "secondary" : "ghost"}
                      size="sm"
                      className={`border text-[9px] ${
                        (mask.matteSource ?? "bounds") === m
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-bg-1 border-border text-fg-2 hover:border-primary/50"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <Text type="supporting" color="secondary" className="text-[8.5px] leading-tight">
                {tr("The chosen clip's ")}{mask.matteSource ?? "bounds"}{" "}
                {tr("drive the visible region of this clip. Animate the source clip's transform to animate the mask.")}</Text>
            </div>
          )}

          <PropertySlider
            label={tr("Feathering")}
            min={0}
            max={100}
            step={1}
            value={mask.feathering}
            onChange={(value: number) => onUpdateFeathering(value)}
            formatValue={(value) => `${Math.round(value)}px`}
          />

          <PropertySlider
            label={tr("Expansion")}
            min={-100}
            max={100}
            step={1}
            value={mask.expansion}
            onChange={(value: number) => onUpdateExpansion(value)}
            formatValue={(value) => `${Math.round(value)}px`}
          />

          <PropertySlider
            label={tr("Opacity")}
            min={0}
            max={100}
            step={1}
            value={mask.opacity * 100}
            onChange={(value: number) => onUpdateOpacity(value / 100)}
            formatValue={(value) => `${Math.round(value)}%`}
          />

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button
              label={mask.inverted ? tr("Inverted") : tr("Invert")}
              onClick={onToggleInvert}
              variant="secondary"
              size="sm"
              icon={mask.inverted ? <EyeOff size={10} aria-hidden /> : <Eye size={10} aria-hidden />}
              className={`flex-1 justify-center ${
                mask.inverted
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-bg-1 text-fg-2 hover:text-fg"
              }`}
            />
            <Text type="supporting" color="secondary" className="text-[8px]">
              {mask.keyframes.length > 0
                ? `${mask.keyframes.length} keyframes`
                : "No keyframes"}
            </Text>
          </div>
        </div>
      )}
    </Card>
  );
};

export const MaskSection: React.FC<MaskSectionProps> = ({ clipId }) => {
  const { t: tr } = useTranslation();
  const getMaskEngine = useEngineStore((state) => state.getMaskEngine);
  const project = useProjectStore((s) => s.project);
  const getAllTextClips = useProjectStore((s) => s.getAllTextClips);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [expandedMasks, setExpandedMasks] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [maskEngine, setMaskEngine] =
    useState<import("@openreel/core").MaskEngine | null>(null);

  // Gather all clips on the timeline as potential matte sources.
  // We collect from regular tracks (video/audio/image/graphics) and
  // also the text clip pool. The audio tracks aren't visually useful
  // as a matte source but we leave them in the list so the user isn't
  // surprised by silent filtering — they can pick whatever they want.
  const matteSourceOptions = useMemo(() => {
    const opts: MatteSourceOption[] = [];
    for (const track of project.timeline.tracks) {
      for (const c of track.clips) {
        const mediaName =
          project.mediaLibrary.items.find((m) => m.id === c.mediaId)?.name ??
          c.mediaId.slice(0, 8);
        opts.push({
          id: c.id,
          label: `${track.name} • ${mediaName}`,
        });
      }
    }
    try {
      for (const t of getAllTextClips()) {
        opts.push({
          id: t.id,
          label: `Text • "${t.text.slice(0, 20)}${t.text.length > 20 ? "…" : ""}"`,
        });
      }
    } catch {
      /* getAllTextClips may not be available for some clip contexts */
    }
    return opts;
  }, [project, getAllTextClips]);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getMaskEngine();
      if (!cancelled) {
        setMaskEngine(engine);
      }
    };
    loadEngine();
    return () => {
      cancelled = true;
    };
  }, [getMaskEngine]);

  const masks = useMemo(() => {
    if (!maskEngine) return [];
    return maskEngine.getMasksForClip(clipId);
  }, [maskEngine, clipId, refreshKey]);

  // Keep track-matte mask paths in sync with their source clip's
  // transform. We re-derive the path whenever the project changes —
  // simple "bounds" mode only for now; alpha/luminance modes require
  // a deeper render-pipeline integration that's tracked separately.
  useEffect(() => {
    if (!maskEngine) return;
    const trackMattes = masks.filter((m) => m.type === "track-matte");
    if (trackMattes.length === 0) return;
    let didChange = false;
    for (const mask of trackMattes) {
      if (!mask.sourceClipId) continue;
      // Find source clip's transform across regular and text clips.
      let transform:
        | { position: { x: number; y: number }; scale: { x: number; y: number } }
        | null = null;
      for (const track of project.timeline.tracks) {
        const c = track.clips.find((cc) => cc.id === mask.sourceClipId);
        if (c) {
          transform = {
            position: c.transform.position,
            scale: c.transform.scale,
          };
          break;
        }
      }
      if (!transform) {
        try {
          const texts = getAllTextClips();
          const tc = texts.find((t) => t.id === mask.sourceClipId);
          if (tc) {
            transform = {
              position: tc.transform.position,
              scale: tc.transform.scale,
            };
          }
        } catch {
          /* ignore */
        }
      }
      if (!transform) continue;
      const nextPath = boundsPathFromTransform(transform);
      const prev = mask.path;
      // Cheap stringify-equality check — paths are tiny.
      if (JSON.stringify(prev) !== JSON.stringify(nextPath)) {
        maskEngine.updateMaskPath(mask.id, nextPath);
        didChange = true;
      }
    }
    if (didChange) {
      // Don't tick the project modifiedAt here — this is a derived
      // refresh, not a user edit. We only bump refreshKey locally so
      // the inspector re-renders.
      setRefreshKey((k) => k + 1);
    }
  }, [maskEngine, masks, project, getAllTextClips]);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    if (maskEngine) {
      void useProjectStore.getState().executeAction({
        type: "mask/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { masks: maskEngine.getAllMasks() },
      });
    }
  }, [maskEngine]);

  const handleAddShapeMask = useCallback(
    (shapeType: MaskShapeType) => {
      if (!maskEngine) return;

      const shapes: Record<MaskShapeType, MaskShape> = {
        rectangle: {
          type: "rectangle",
          x: 0.25,
          y: 0.25,
          width: 0.5,
          height: 0.5,
        },
        ellipse: { type: "ellipse", cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25 },
        polygon: {
          type: "polygon",
          points: [
            { x: 0.5, y: 0.2 },
            { x: 0.8, y: 0.5 },
            { x: 0.5, y: 0.8 },
            { x: 0.2, y: 0.5 },
          ],
        },
      };

      const mask = maskEngine.createShapeMask(clipId, shapes[shapeType]);
      setSelectedMaskId(mask.id);
      setExpandedMasks((prev) => new Set([...prev, mask.id]));
      triggerRefresh();
    },
    [maskEngine, clipId, triggerRefresh],
  );

  const handleDeleteMask = useCallback(
    (maskId: string) => {
      if (!maskEngine) return;
      maskEngine.deleteMask(maskId);
      if (selectedMaskId === maskId) {
        setSelectedMaskId(null);
      }
      setExpandedMasks((prev) => {
        const next = new Set(prev);
        next.delete(maskId);
        return next;
      });
      triggerRefresh();
    },
    [maskEngine, selectedMaskId, triggerRefresh],
  );

  const handleDuplicateMask = useCallback(
    (mask: Mask) => {
      if (!maskEngine) return;
      const newMask = maskEngine.duplicateMask(mask.id, clipId);
      if (!newMask) return;
      setSelectedMaskId(newMask.id);
      setExpandedMasks((prev) => new Set([...prev, newMask.id]));
      triggerRefresh();
    },
    [maskEngine, clipId, triggerRefresh],
  );

  const handleUpdateFeathering = useCallback(
    (maskId: string, value: number) => {
      if (!maskEngine) return;
      maskEngine.setFeathering(maskId, value);
      triggerRefresh();
    },
    [maskEngine, triggerRefresh],
  );

  const handleUpdateExpansion = useCallback(
    (maskId: string, value: number) => {
      if (!maskEngine) return;
      maskEngine.setExpansion(maskId, value);
      triggerRefresh();
    },
    [maskEngine, triggerRefresh],
  );

  const handleUpdateOpacity = useCallback(
    (maskId: string, value: number) => {
      if (!maskEngine) return;
      maskEngine.setOpacity(maskId, value);
      triggerRefresh();
    },
    [maskEngine, triggerRefresh],
  );

  const handleUpdatePath = useCallback(
    (maskId: string, path: BezierPath) => {
      if (!maskEngine || path.points.length < 3) return;
      maskEngine.updateMaskPath(maskId, path);
      triggerRefresh();
    },
    [maskEngine, triggerRefresh],
  );

  const handleAddDrawnMask = useCallback(() => {
    if (!maskEngine) return;
    const mask = maskEngine.createDrawnMask(clipId, {
      closed: true,
      points: [
        { x: 0.5, y: 0.16 },
        { x: 0.78, y: 0.28 },
        { x: 0.84, y: 0.58 },
        { x: 0.62, y: 0.82 },
        { x: 0.28, y: 0.76 },
        { x: 0.16, y: 0.42 },
      ],
    });
    setSelectedMaskId(mask.id);
    setExpandedMasks((prev) => new Set([...prev, mask.id]));
    triggerRefresh();
  }, [clipId, maskEngine, triggerRefresh]);

  const handleToggleInvert = useCallback(
    (maskId: string) => {
      if (!maskEngine) return;
      const mask = maskEngine.getMask(maskId);
      if (mask) {
        maskEngine.setInverted(maskId, !mask.inverted);
        triggerRefresh();
      }
    },
    [maskEngine, triggerRefresh],
  );

  const handleAddTrackMatte = useCallback(() => {
    if (!maskEngine) return;
    // Default to the first available source clip that isn't ourselves.
    const firstAvailable = matteSourceOptions.find((o) => o.id !== clipId);
    const mask = maskEngine.createTrackMatteMask(
      clipId,
      firstAvailable?.id ?? "",
      "bounds",
    );
    setSelectedMaskId(mask.id);
    setExpandedMasks((prev) => new Set([...prev, mask.id]));
    triggerRefresh();
  }, [maskEngine, clipId, matteSourceOptions, triggerRefresh]);

  const handleSetMatteSource = useCallback(
    (
      maskId: string,
      sourceClipId: string,
      matteSource: "alpha" | "luminance" | "bounds",
    ) => {
      if (!maskEngine) return;
      maskEngine.setMatteSource(maskId, sourceClipId, matteSource);
      triggerRefresh();
    },
    [maskEngine, triggerRefresh],
  );

  const toggleMaskExpanded = (maskId: string) => {
    setExpandedMasks((prev) => {
      const next = new Set(prev);
      if (next.has(maskId)) {
        next.delete(maskId);
      } else {
        next.add(maskId);
      }
      return next;
    });
  };

  const handleResetMasks = useCallback(() => {
    if (!maskEngine) return;
    for (const mask of masks) {
      maskEngine.deleteMask(mask.id);
    }
    setSelectedMaskId(null);
    setExpandedMasks(new Set());
    triggerRefresh();
  }, [maskEngine, masks, triggerRefresh]);

  return (
    <div className="space-y-3">
      <Card
        variant="green"
        padding={2}
        className="flex items-center gap-2 border border-primary/30 bg-primary/10"
      >
        <Square size={16} className="text-primary" />
        <div className="flex flex-1 flex-col gap-0.5">
          <Text type="supporting" color="primary" className="text-[11px] font-medium">
            {tr("Masking")}</Text>
          <Text type="supporting" color="secondary" className="text-[9px]">
            {tr("Control visible regions of clip")}</Text>
        </div>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Text type="supporting" color="secondary" className="text-[10px] font-medium">
            {tr("Add Mask Shape")}</Text>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {MASK_SHAPES.map((shape) => {
            const Icon = shape.icon;
            return (
              <ClickableCard
                key={shape.id}
                label={tr(shape.name)}
                onClick={() => handleAddShapeMask(shape.id)}
                padding={2}
                variant="muted"
                className="flex flex-col items-center gap-1 border border-transparent bg-bg-2 hover:border-primary/30 hover:bg-primary/20"
              >
                <Icon size={14} className="text-fg-2" />
                <Text type="supporting" color="secondary" className="text-[8px]">
                  {shape.name}
                </Text>
              </ClickableCard>
            );
          })}
          <ClickableCard
            label={tr("Add custom path mask")}
            onClick={handleAddDrawnMask}
            padding={2}
            variant="muted"
            className="flex flex-col items-center gap-1 border border-transparent bg-bg-2 hover:border-primary/30 hover:bg-primary/20"
          >
            <Pen size={14} className="text-fg-2" />
            <Text type="supporting" color="secondary" className="text-[8px]">
              {tr("Custom")}</Text>
          </ClickableCard>
          <ClickableCard
            label={tr("Use another clip as a track matte")}
            onClick={handleAddTrackMatte}
            padding={2}
            variant="muted"
            className="flex flex-col items-center gap-1 border border-transparent bg-bg-2 hover:border-primary/30 hover:bg-primary/20"
          >
            <Layers size={14} className="text-fg-2" />
            <Text type="supporting" color="secondary" className="text-[8px]">
              {tr("Track Matte")}</Text>
          </ClickableCard>
        </div>
      </div>

      {masks.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-[10px] font-medium">
              {tr("Masks (")}{masks.length})
            </Text>
            <Button
              label={tr("Clear All")}
              onClick={handleResetMasks}
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={10} aria-hidden />}
              className="text-red-400 hover:bg-red-400/10"
            />
          </div>

          <div className="space-y-2">
            {masks.map((mask) => (
              <MaskItem
                key={mask.id}
                mask={mask}
                isSelected={selectedMaskId === mask.id}
                isExpanded={expandedMasks.has(mask.id)}
                matteSourceOptions={matteSourceOptions}
                ownClipId={clipId}
                onSelect={() => setSelectedMaskId(mask.id)}
                onToggleExpand={() => toggleMaskExpanded(mask.id)}
                onDelete={() => handleDeleteMask(mask.id)}
                onDuplicate={() => handleDuplicateMask(mask)}
                onUpdateFeathering={(v) => handleUpdateFeathering(mask.id, v)}
                onUpdateExpansion={(v) => handleUpdateExpansion(mask.id, v)}
                onUpdateOpacity={(v) => handleUpdateOpacity(mask.id, v)}
                onToggleInvert={() => handleToggleInvert(mask.id)}
                onUpdatePath={(path) => handleUpdatePath(mask.id, path)}
                onSetMatteSource={(srcId, channel) =>
                  handleSetMatteSource(mask.id, srcId, channel)
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <Square
            size={24}
            className="mx-auto mb-2 text-fg-3 opacity-50"
          />
          <Text type="supporting" color="secondary" className="block text-[10px]">
            {tr("No masks on this clip")}</Text>
          <Text type="supporting" color="secondary" className="mt-1 block text-[9px]">
            {tr("Click a shape above to add a mask")}</Text>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="text-center text-[9px]">
          {tr("Masks control which parts of the clip are visible")}</Text>
      </div>
    </div>
  );
};

export default MaskSection;

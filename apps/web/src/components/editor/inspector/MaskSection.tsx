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
  type LucideIcon,
} from "lucide-react";
import {
  Slider,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import type { Mask, MaskShape } from "@openreel/core";
import { boundsPathFromTransform } from "@openreel/core";

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
  onSetMatteSource,
}) => {
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
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${
        isSelected ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <button
        onClick={onSelect}
        className="w-full flex items-center gap-2 p-2 hover:bg-background-tertiary transition-colors"
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="p-0.5"
        >
          {isExpanded ? (
            <ChevronDown size={12} className="text-text-muted" />
          ) : (
            <ChevronRight size={12} className="text-text-muted" />
          )}
        </button>
        <MaskIcon size={12} className="text-primary" />
        <span className="flex-1 text-left text-[10px] font-medium text-text-primary">
          {maskLabel}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleInvert();
          }}
          className={`p-1 rounded transition-colors ${
            mask.inverted
              ? "bg-amber-500/20 text-amber-400"
              : "text-text-muted hover:text-text-primary"
          }`}
          title={mask.inverted ? "Mask Inverted" : "Mask Normal"}
        >
          {mask.inverted ? <EyeOff size={10} /> : <Eye size={10} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="p-1 text-text-muted hover:text-text-primary transition-colors"
          title="Duplicate Mask"
        >
          <Copy size={10} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 text-text-muted hover:text-red-400 transition-colors"
          title="Delete Mask"
        >
          <Trash2 size={10} />
        </button>
      </button>

      {isExpanded && (
        <div className="p-2 space-y-3 border-t border-border bg-background-tertiary/50">
          {mask.type === "track-matte" && (
            <div className="space-y-2 p-2 bg-primary/5 border border-primary/20 rounded">
              <div className="flex items-center gap-1.5">
                <Layers size={11} className="text-primary" />
                <span className="text-[9.5px] font-medium text-text-primary">
                  Matte source
                </span>
              </div>
              <Select
                value={mask.sourceClipId ?? ""}
                onValueChange={(v) =>
                  onSetMatteSource(v, mask.matteSource ?? "bounds")
                }
              >
                <SelectTrigger className="h-7 text-[10px]">
                  <SelectValue placeholder="Pick a clip…" />
                </SelectTrigger>
                <SelectContent>
                  {availableSources.length === 0 ? (
                    <div className="px-2 py-1 text-[10px] text-text-muted">
                      No other clips available
                    </div>
                  ) : (
                    availableSources.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-muted">Channel</span>
                <div className="flex gap-1">
                  {(["bounds", "alpha", "luminance"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() =>
                        onSetMatteSource(mask.sourceClipId ?? "", m)
                      }
                      disabled={!mask.sourceClipId}
                      className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        (mask.matteSource ?? "bounds") === m
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-background-secondary border-border text-text-secondary hover:border-primary/50"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[8.5px] text-text-muted leading-tight">
                The chosen clip&apos;s {mask.matteSource ?? "bounds"}{" "}
                drive the visible region of this clip. Animate the source
                clip&apos;s transform to animate the mask.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[9px] text-text-muted">Feathering</label>
              <span className="text-[9px] text-text-secondary">
                {mask.feathering}px
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[mask.feathering]}
              onValueChange={(value) => onUpdateFeathering(value[0])}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[9px] text-text-muted">Expansion</label>
              <span className="text-[9px] text-text-secondary">
                {mask.expansion}px
              </span>
            </div>
            <Slider
              min={-100}
              max={100}
              step={1}
              value={[mask.expansion]}
              onValueChange={(value) => onUpdateExpansion(value[0])}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[9px] text-text-muted">Opacity</label>
              <span className="text-[9px] text-text-secondary">
                {Math.round(mask.opacity * 100)}%
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[mask.opacity * 100]}
              onValueChange={(value) => onUpdateOpacity(value[0] / 100)}
            />
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <button
              onClick={onToggleInvert}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] rounded transition-colors ${
                mask.inverted
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-background-secondary text-text-secondary hover:text-text-primary"
              }`}
            >
              {mask.inverted ? <EyeOff size={10} /> : <Eye size={10} />}
              {mask.inverted ? "Inverted" : "Invert"}
            </button>
            <span className="text-[8px] text-text-muted">
              {mask.keyframes.length > 0
                ? `${mask.keyframes.length} keyframes`
                : "No keyframes"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export const MaskSection: React.FC<MaskSectionProps> = ({ clipId }) => {
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
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, []);

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
      const newMask = maskEngine.createDrawnMask(clipId, { ...mask.path });
      maskEngine.setFeathering(newMask.id, mask.feathering);
      maskEngine.setExpansion(newMask.id, mask.expansion);
      maskEngine.setInverted(newMask.id, mask.inverted);
      setSelectedMaskId(newMask.id);
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
    (maskId: string, _value: number) => {
      if (!maskEngine) return;
      const mask = maskEngine.getMask(maskId);
      if (mask) {
        maskEngine.updateMaskPath(maskId, mask.path);
        triggerRefresh();
      }
    },
    [maskEngine, triggerRefresh],
  );

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
      <div className="flex items-center gap-2 p-2 bg-gradient-to-r bg-primary/10 rounded-lg border border-primary/30">
        <Square size={16} className="text-primary" />
        <div className="flex-1">
          <span className="text-[11px] font-medium text-text-primary">
            Masking
          </span>
          <p className="text-[9px] text-text-muted">
            Control visible regions of clip
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-text-secondary">
            Add Mask Shape
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {MASK_SHAPES.map((shape) => {
            const Icon = shape.icon;
            return (
              <button
                key={shape.id}
                onClick={() => handleAddShapeMask(shape.id)}
                className="flex flex-col items-center gap-1 p-2 rounded-lg bg-background-tertiary hover:bg-primary/20 border border-transparent hover:border-primary/30 transition-colors"
                title={shape.name}
              >
                <Icon size={14} className="text-text-secondary" />
                <span className="text-[8px] text-text-muted">{shape.name}</span>
              </button>
            );
          })}
          <button
            onClick={() => {}}
            className="flex flex-col items-center gap-1 p-2 rounded-lg bg-background-tertiary hover:bg-primary/20 border border-transparent hover:border-primary/30 transition-colors"
            title="Draw Freehand"
          >
            <Pen size={14} className="text-text-secondary" />
            <span className="text-[8px] text-text-muted">Freehand</span>
          </button>
          <button
            onClick={handleAddTrackMatte}
            className="flex flex-col items-center gap-1 p-2 rounded-lg bg-background-tertiary hover:bg-primary/20 border border-transparent hover:border-primary/30 transition-colors"
            title="Use another clip as a track matte (Premiere-style object masking)"
          >
            <Layers size={14} className="text-text-secondary" />
            <span className="text-[8px] text-text-muted">Track Matte</span>
          </button>
        </div>
      </div>

      {masks.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-text-secondary">
              Masks ({masks.length})
            </span>
            <button
              onClick={handleResetMasks}
              className="flex items-center gap-1 px-2 py-1 text-[9px] text-red-400 hover:bg-red-400/10 rounded transition-colors"
            >
              <RefreshCw size={10} />
              Clear All
            </button>
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
            className="mx-auto mb-2 text-text-muted opacity-50"
          />
          <p className="text-[10px] text-text-muted">No masks on this clip</p>
          <p className="text-[9px] text-text-muted mt-1">
            Click a shape above to add a mask
          </p>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <p className="text-[9px] text-text-muted text-center">
          Masks control which parts of the clip are visible
        </p>
      </div>
    </div>
  );
};

export default MaskSection;

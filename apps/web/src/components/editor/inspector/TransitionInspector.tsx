import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Label,
  RadioGroup,
  RadioGroupItem,
  Switch,
} from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { formatFrameTimecode } from "../../../utils/frame-timecode";

import { PropertySlider } from "./shell/PropertySlider";
import { getTrackBadge } from "../timeline/track-badge";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
} from "@/icons/lucide-compat";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { TRANSITION_CARDS } from "../../../bridges/transition-cards";
import type { Transition, Clip, TransitionEdge } from "@openreel/core";
import type { TransitionType } from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { MorphCutControls } from "./MorphCutControls";
import { encodeLumaBase64, isMaskTransition } from "@openreel/core/video/transition-masks";

const LUMA_MAP_WIDTH = 64;
const LUMA_MAP_HEIGHT = 36;

/** Downsamples an image file to a small luma map the gradient wipe stores on the transition. */
async function readLumaImage(file: File): Promise<{ lumaData: string; lumaWidth: number; lumaHeight: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = LUMA_MAP_WIDTH;
    canvas.height = LUMA_MAP_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is not available");
    ctx.drawImage(bitmap, 0, 0, LUMA_MAP_WIDTH, LUMA_MAP_HEIGHT);
    const rgba = ctx.getImageData(0, 0, LUMA_MAP_WIDTH, LUMA_MAP_HEIGHT).data;
    const luma = new Uint8Array(LUMA_MAP_WIDTH * LUMA_MAP_HEIGHT);
    for (let i = 0; i < luma.length; i += 1) {
      luma[i] = Math.round(0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!);
    }
    return { lumaData: encodeLumaBase64(luma), lumaWidth: LUMA_MAP_WIDTH, lumaHeight: LUMA_MAP_HEIGHT };
  } finally {
    bitmap.close();
  }
}

const EASING_CURVES: Record<string, { label: string; path: string }> = {
  linear: { label: "Linear", path: "M10 70 L190 10" },
  ease: { label: "Ease in-out", path: "M10 70 C80 70 120 10 190 10" },
  "ease-in": { label: "Ease in", path: "M10 70 Q100 70 190 10" },
  "ease-out": { label: "Ease out", path: "M10 70 Q100 10 190 10" },
  "ease-in-out": { label: "Quadratic in-out", path: "M10 70 Q55 70 100 40 Q145 10 190 10" },
};

const TransitionSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min, max, step = 1, unit = "" }) => (
  <PropertySlider
    label={label}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    formatValue={(nextValue) =>
      `${step < 1 ? Number(nextValue.toFixed(2)) : Math.round(nextValue)}${unit}`
    }
  />
);

/**
 * Direction Selector Component
 */
const DirectionSelector: React.FC<{
  value: string;
  onChange: (direction: string) => void;
  options?: string[];
}> = ({ value, onChange, options = ["left", "right", "up", "down"] }) => {
  const directionIcons: Record<string, React.ReactNode> = {
    left: <ArrowLeft size={14} />,
    right: <ArrowRight size={14} />,
    up: <ArrowUp size={14} />,
    down: <ArrowDown size={14} />,
    diagonal: <ArrowUpRight size={14} />,
  };
  const choices = options.includes(value) ? options : [...options, value];

  return (
    <div className="space-y-1">
      <span className="text-fg-2 font-normal text-[10px]">
        Direction
      </span>
      <div className="workspace-transition-directions" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map((dir) => (
          <Button variant="outline" size="icon-sm" key={dir} onClick={() => onChange(dir)} type="button" aria-pressed={value === dir} aria-label={dir.charAt(0).toUpperCase() + dir.slice(1)} title={dir.charAt(0).toUpperCase() + dir.slice(1)}>
            {directionIcons[dir] || dir}
          </Button>
        ))}
      </div>
    </div>
  );
};

const CORNERS = [
  { value: "topLeft", glyph: "↖", label: "Top left" },
  { value: "topRight", glyph: "↗", label: "Top right" },
  { value: "bottomLeft", glyph: "↙", label: "Bottom left" },
  { value: "bottomRight", glyph: "↘", label: "Bottom right" },
] as const;

/** Picks the corner a transition starts from (inset, page peel). */
const CornerSelector: React.FC<{ value: string; onChange: (corner: string) => void }> = ({ value, onChange }) => (
  <div className="space-y-1">
    <span className="text-fg-2 font-normal text-[10px]">Corner</span>
    <div className="workspace-transition-directions" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
      {CORNERS.map((corner) => (
        <Button variant="outline" size="icon-sm" key={corner.value} onClick={() => onChange(corner.value)} type="button" aria-pressed={value === corner.value} aria-label={corner.label} title={corner.label}>
          {corner.glyph}
        </Button>
      ))}
    </div>
  </div>
);

const Toggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, value, onChange }) => (
  <label className="workspace-transition-toggle">
    <span>{label}</span>
    <Switch aria-label={label} checked={value} onCheckedChange={onChange} />
  </label>
);

/**
 * TransitionInspector Props
 */
interface TransitionInspectorProps {
  clipA: Clip;
  clipB?: Clip;
  edge?: TransitionEdge;
  transition?: Transition;
  onTransitionCreate?: (transition: Transition) => void;
  onTransitionUpdate?: (
    transitionId: string,
    updates: Partial<Transition>,
  ) => void;
  onTransitionRemove?: (transitionId: string) => void;
}

/**
 * TransitionInspector Component
 *
 * - 12.1: Display available transition types
 * - 12.2: Apply transition with specified duration
 * - 12.3: Update blend timing when duration is adjusted
 */
export const TransitionInspector: React.FC<TransitionInspectorProps> = ({
  clipA,
  clipB,
  edge,
  transition,
  onTransitionCreate,
  onTransitionUpdate,
  onTransitionRemove,
}) => {
  const project = useProjectStore((state) => state.project);
  const actionExecutor = useProjectStore((state) => state.actionExecutor);
  const canEdit = useCallback(() => {
    const current = useProjectStore.getState();
    return current.project.id === project.id && current.actionExecutor === actionExecutor &&
      !current.project.timeline.tracks.some((item) => item.locked && (item.id === clipA.trackId || item.id === clipB?.trackId));
  }, [project.id, actionExecutor, clipA.trackId, clipB?.trackId]);
  const locked = project.timeline.tracks.some((item) => item.locked && (item.id === clipA.trackId || item.id === clipB?.trackId));
  const mediaA = project.mediaLibrary.items.find(
    (item) => item.id === clipA.mediaId,
  );
  const mediaB = clipB
    ? project.mediaLibrary.items.find((item) => item.id === clipB.mediaId)
    : undefined;
  const track = project.timeline.tracks.find(
    (item) => item.id === clipA.trackId,
  );
  const frameRate = project.settings.frameRate;
  const bridge = getTransitionBridge();
  const alignmentId = useId();
  const [applyingAll, setApplyingAll] = useState(false);
  const [presetNaming, setPresetNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  // Morph Cut needs a cut between two clips: a clip's own fade in / out has no second shot to match.
  const transitionTypes = edge ? TRANSITION_CARDS.filter((card) => card.type !== "morphCut") : TRANSITION_CARDS;

  // Local state for creating new transitions
  const [selectedType, setSelectedType] = useState<TransitionType>(
    transition?.type || "crossfade",
  );
  const [duration, setDuration] = useState<number>(transition?.duration || 1.0);
  const [params, setParams] = useState<Record<string, unknown>>(
    transition?.params || bridge.getDefaultParams(selectedType),
  );

  useEffect(() => {
    const nextType = transition?.type || "crossfade";
    setSelectedType(nextType);
    setDuration(transition?.duration || 1.0);
    setParams(transition?.params || bridge.getDefaultParams(nextType));
  }, [bridge, clipA.id, clipB?.id, edge, transition]);

  const alignment = typeof params.alignment === "string" ? params.alignment : "center";

  // Validate transition
  const validation = useMemo(() => {
    if (!bridge.isInitialized()) {
      bridge.initialize();
    }
    if (edge) {
      return bridge.validateClipEdgeTransition(clipA, duration);
    }
    if (!clipB) {
      return {
        valid: false,
        error: "A second clip is required for clip-to-clip transitions",
      };
    }
    return bridge.validateTransition(clipA, clipB, duration, alignment);
  }, [bridge, clipA, clipB, duration, edge, alignment]);

  // Handle type change
  const handleTypeChange = useCallback(
    (type: TransitionType) => {
      if (!canEdit()) return;
      setSelectedType(type);
      const defaultParams = bridge.getDefaultParams(type);
      const nextParams = {
        ...defaultParams,
        ...(typeof params.alignment === "string"
          ? { alignment: params.alignment }
          : {}),
        ...(typeof params.curve === "string" ? { curve: params.curve } : {}),
        ...(typeof params.startPct === "number" ? { startPct: params.startPct } : {}),
        ...(typeof params.endPct === "number" ? { endPct: params.endPct } : {}),
        ...(typeof params.audioFade === "boolean"
          ? { audioFade: params.audioFade }
          : {}),
      };
      setParams(nextParams);

      if (transition) {
        onTransitionUpdate?.(transition.id, { type, params: nextParams });
      }
    },
    [
      canEdit,
      bridge,
      params.audioFade,
      params.alignment,
      params.curve,
      params.startPct,
      params.endPct,
      transition,
      onTransitionUpdate,
    ],
  );

  // Handle duration change
  const handleDurationChange = useCallback(
    (newDuration: number) => {
      if (!canEdit()) return;
      const clampedDuration = validation.maxDuration
        ? Math.min(newDuration, validation.maxDuration)
        : newDuration;
      setDuration(clampedDuration);

      if (transition) {
        onTransitionUpdate?.(transition.id, { duration: clampedDuration });
      }
    },
    [canEdit, transition, validation.maxDuration, onTransitionUpdate],
  );

  // Handle param change
  const handleParamChange = useCallback(
    (key: string, value: unknown) => {
      if (!canEdit()) return;
      const newParams = { ...params, [key]: value };
      setParams(newParams);

      if (transition) {
        onTransitionUpdate?.(transition.id, { params: newParams });
      }
    },
    [canEdit, params, transition, onTransitionUpdate],
  );

  // Handle create transition
  const handleCreate = useCallback(() => {
    if (!canEdit()) return;
    const result = edge
      ? bridge.createClipEdgeTransition(
          clipA,
          edge,
          selectedType,
          duration,
          params,
        )
      : clipB
        ? bridge.createTransition(clipA, clipB, selectedType, duration, params)
        : {
            success: false,
            error: "A second clip is required",
            transitionId: undefined,
          };

    if (result.success && result.transitionId) {
      const newTransition = bridge.getTransition(result.transitionId);
      if (newTransition) {
        onTransitionCreate?.(newTransition);
        toast.success(
          "Transition Applied",
          `${selectedType} transition added (${duration}s)`,
        );
      }
    } else {
      toast.error(
        "Transition Failed",
        result.error || "Could not apply transition",
      );
    }
  }, [
    canEdit,
    bridge,
    clipA,
    clipB,
    edge,
    selectedType,
    duration,
    params,
    onTransitionCreate,
  ]);

  // Handle remove transition
  const handleRemove = useCallback(() => {
    if (!canEdit()) return;
    if (transition) {
      bridge.removeTransition(transition.id);
      onTransitionRemove?.(transition.id);
      toast.success("Transition Removed");
    }
  }, [canEdit, bridge, transition, onTransitionRemove]);

  // Render type-specific parameters
  const renderTypeParams = () => {
    const center =
      params.center && typeof params.center === "object"
        ? (params.center as { x?: number; y?: number })
        : {};
    const centerX = typeof center.x === "number" ? center.x : 0.5;
    const centerY = typeof center.y === "number" ? center.y : 0.5;
    const renderCenterControls = () => (
      <div className="grid grid-cols-2 gap-2">
        <TransitionSlider
          label="Center X"
          value={centerX * 100}
          onChange={(value) =>
            handleParamChange("center", { x: value / 100, y: centerY })
          }
          min={0}
          max={100}
          unit="%"
        />
        <TransitionSlider
          label="Center Y"
          value={centerY * 100}
          onChange={(value) =>
            handleParamChange("center", { x: centerX, y: value / 100 })
          }
          min={0}
          max={100}
          unit="%"
        />
      </div>
    );
    const renderBorderControls = () => (
      <>
        <TransitionSlider
          label="Border width"
          value={(params.borderWidth as number) ?? 0}
          onChange={(value) => handleParamChange("borderWidth", Math.round(value))}
          min={0}
          max={50}
          unit="px"
        />
        <label className="workspace-transition-toggle">
          <span>Border colour</span>
          <input
            type="color"
            aria-label="Border colour"
            value={typeof params.borderColor === "string" && /^#[0-9a-f]{6}$/i.test(params.borderColor) ? params.borderColor : "#ffffff"}
            onChange={(event) => handleParamChange("borderColor", event.target.value)}
          />
        </label>
      </>
    );
    const renderTilesControl = (label: string) => (
      <TransitionSlider
        label={label}
        value={(params.tiles as number) ?? 8}
        onChange={(value) => handleParamChange("tiles", Math.round(value))}
        min={2}
        max={32}
        step={1}
      />
    );
    const renderSeedControl = () => (
      <div className="workspace-transition-seed">
        <TransitionSlider
          label="Seed"
          value={(params.seed as number) ?? 1}
          onChange={(value) => handleParamChange("seed", Math.round(value))}
          min={0}
          max={999}
          step={1}
        />
        <Button variant="secondary" type="button" onClick={() => handleParamChange("seed", Math.floor(Math.random() * 1000))}>
          New pattern
        </Button>
      </div>
    );
    switch (selectedType) {
      case "wipe":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(dir) => handleParamChange("direction", dir)}
              options={["left", "right", "up", "down"]}
            />
            <TransitionSlider
              label="Softness"
              value={((params.softness as number) || 0) * 100}
              onChange={(v) => handleParamChange("softness", v / 100)}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );

      case "slide":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(dir) => handleParamChange("direction", dir)}
            />
            <Toggle
              label="Push Out"
              value={(params.pushOut as boolean) || false}
              onChange={(v) => handleParamChange("pushOut", v)}
            />
          </>
        );

      case "push":
        return (
          <DirectionSelector
            value={(params.direction as string) || "left"}
            onChange={(dir) => handleParamChange("direction", dir)}
          />
        );

      case "blur":
        return (
          <TransitionSlider
            label="Blur Strength"
            value={((params.intensity as number) ?? 1) * 100}
            onChange={(value) => handleParamChange("intensity", value / 100)}
            min={0}
            max={200}
            step={5}
            unit="%"
          />
        );

      case "whipPan":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(direction) =>
                handleParamChange("direction", direction)
              }
            />
            <TransitionSlider
              label="Motion Blur"
              value={((params.blurIntensity as number) ?? 1) * 100}
              onChange={(value) =>
                handleParamChange("blurIntensity", value / 100)
              }
              min={0}
              max={200}
              step={5}
              unit="%"
            />
          </>
        );

      case "radialWipe":
        return (
          <>
            <TransitionSlider
              label="Start Angle"
              value={(params.startAngle as number) ?? -90}
              onChange={(value) => handleParamChange("startAngle", value)}
              min={-180}
              max={180}
              step={1}
              unit="°"
            />
            <Toggle
              label="Clockwise"
              value={(params.clockwise as boolean) ?? true}
              onChange={(value) => handleParamChange("clockwise", value)}
            />
          </>
        );

      case "zoom":
        return (
          <>
            <TransitionSlider
              label="Scale"
              value={(params.scale as number) || 2}
              onChange={(v) => handleParamChange("scale", v)}
              min={1.1}
              max={4}
              step={0.1}
              unit="x"
            />
            {renderCenterControls()}
          </>
        );

      case "circleReveal":
      case "diamondReveal":
        return renderCenterControls();

      case "dipToBlack":
      case "dipToWhite":
        return (
          <TransitionSlider
            label="Hold Duration"
            value={(params.holdDuration as number) ?? 0.1}
            onChange={(v) => handleParamChange("holdDuration", v)}
            min={0}
            max={1}
            step={0.05}
            unit="s"
          />
        );

      case "pixelate":
        return (
          <TransitionSlider
            label="Maximum Pixel Size"
            value={(params.maxPixelSize as number) || 48}
            onChange={(v) => handleParamChange("maxPixelSize", v)}
            min={4}
            max={128}
            step={2}
            unit="px"
          />
        );

      case "glitch":
        return (
          <>
            <TransitionSlider
              label="Intensity"
              value={((params.intensity as number) || 0.08) * 100}
              onChange={(v) => handleParamChange("intensity", v / 100)}
              min={1}
              max={25}
              unit="%"
            />
            <TransitionSlider
              label="Slices"
              value={(params.slices as number) || 12}
              onChange={(v) => handleParamChange("slices", v)}
              min={4}
              max={40}
              step={1}
            />
          </>
        );

      case "blinds":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "vertical"}
              onChange={(direction) =>
                handleParamChange("direction", direction)
              }
              options={["vertical", "horizontal"]}
            />
            <TransitionSlider
              label="Slats"
              value={(params.count as number) || 8}
              onChange={(v) => handleParamChange("count", v)}
              min={2}
              max={32}
              step={1}
            />
          </>
        );

      case "spin":
        return (
          <TransitionSlider
            label="Rotations"
            value={(params.rotations as number) ?? 1}
            onChange={(value) => handleParamChange("rotations", value)}
            min={-2}
            max={2}
            step={0.25}
          />
        );

      case "flip":
        return (
          <DirectionSelector
            value={(params.axis as string) || "horizontal"}
            onChange={(axis) => handleParamChange("axis", axis)}
            options={["horizontal", "vertical"]}
          />
        );

      case "splitReveal":
        return (
          <DirectionSelector
            value={(params.orientation as string) || "horizontal"}
            onChange={(orientation) =>
              handleParamChange("orientation", orientation)
            }
            options={["horizontal", "vertical"]}
          />
        );

      case "flash":
        return (
          <TransitionSlider
            label="Flash Intensity"
            value={((params.intensity as number) ?? 1) * 100}
            onChange={(value) => handleParamChange("intensity", value / 100)}
            min={0}
            max={150}
            step={5}
            unit="%"
          />
        );

      case "filmBurn":
        return (
          <>
            <TransitionSlider
              label="Burn Intensity"
              value={((params.intensity as number) ?? 1) * 100}
              onChange={(value) => handleParamChange("intensity", value / 100)}
              min={0}
              max={200}
              step={5}
              unit="%"
            />
            <TransitionSlider
              label="Warmth"
              value={((params.warmth as number) ?? 0.75) * 100}
              onChange={(value) => handleParamChange("warmth", value / 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </>
        );

      case "mosaic":
        return (
          <>
            <TransitionSlider
              label="Tile Columns"
              value={(params.tiles as number) ?? 8}
              onChange={(value) => handleParamChange("tiles", value)}
              min={2}
              max={24}
              step={1}
            />
            <TransitionSlider
              label="Randomness"
              value={((params.randomness as number) ?? 0.85) * 100}
              onChange={(value) => handleParamChange("randomness", value / 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </>
        );

      case "ripple":
        return (
          <>
            <TransitionSlider
              label="Amplitude"
              value={((params.amplitude as number) ?? 0.04) * 100}
              onChange={(value) => handleParamChange("amplitude", value / 100)}
              min={0}
              max={20}
              step={0.5}
              unit="%"
            />
            <TransitionSlider
              label="Waves"
              value={(params.waves as number) ?? 3}
              onChange={(value) => handleParamChange("waves", value)}
              min={0.5}
              max={12}
              step={0.5}
            />
          </>
        );

      case "pageTurn":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(direction) =>
                handleParamChange("direction", direction)
              }
              options={["left", "right"]}
            />
            <TransitionSlider
              label="Fold Shadow"
              value={((params.shadow as number) ?? 0.55) * 100}
              onChange={(value) => handleParamChange("shadow", value / 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </>
        );

      case "colorSplit":
        return (
          <>
            <TransitionSlider
              label="Maximum Offset"
              value={(params.maxOffset as number) ?? 18}
              onChange={(value) => handleParamChange("maxOffset", value)}
              min={0}
              max={80}
              step={1}
              unit="px"
            />
            <TransitionSlider
              label="Angle"
              value={(params.angle as number) ?? 0}
              onChange={(value) => handleParamChange("angle", value)}
              min={0}
              max={360}
              step={5}
              unit="°"
            />
          </>
        );

      case "irisRound":
      case "irisBox":
      case "irisCross":
      case "irisDiamond":
        return renderCenterControls();

      case "bandWipe":
        return (
          <>
            <DirectionSelector
              value={(params.orientation as string) || "horizontal"}
              onChange={(orientation) => handleParamChange("orientation", orientation)}
              options={["horizontal", "vertical"]}
            />
            <TransitionSlider
              label="Bands"
              value={(params.bands as number) || 5}
              onChange={(v) => handleParamChange("bands", Math.round(v))}
              min={2}
              max={32}
              step={1}
            />
          </>
        );

      case "barnDoor":
        return (
          <DirectionSelector
            value={(params.orientation as string) || "horizontal"}
            onChange={(orientation) => handleParamChange("orientation", orientation)}
            options={["horizontal", "vertical"]}
          />
        );

      case "clockWipe":
        return (
          <>
            <TransitionSlider
              label="Start Angle"
              value={(params.startAngle as number) ?? 0}
              onChange={(value) => handleParamChange("startAngle", value)}
              min={-180}
              max={180}
              step={1}
              unit="°"
            />
            <Toggle
              label="Clockwise"
              value={(params.clockwise as boolean) ?? true}
              onChange={(value) => handleParamChange("clockwise", value)}
            />
            {renderCenterControls()}
          </>
        );

      case "gradientWipe": {
        const hasImage = typeof params.lumaData === "string";
        return (
          <>
            <Select
              value={hasImage ? "custom" : ((params.gradient as string) ?? "linear")}
              onValueChange={(value) => {
                if (value === "custom") return;
                if (!canEdit()) return;
                const { lumaData: _d, lumaWidth: _w, lumaHeight: _h, ...rest } = params;
                const next = { ...rest, gradient: value };
                setParams(next);
                if (transition) onTransitionUpdate?.(transition.id, { params: next });
              }}
            >
              <SelectTrigger aria-label="Gradient" icon={<span aria-hidden="true">▾</span>}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["linear", "radial", "diagonal", "checker", "noise", "spiral"].map((value) => (
                  <SelectItem key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</SelectItem>
                ))}
                {hasImage && <SelectItem value="custom">Custom image</SelectItem>}
              </SelectContent>
            </Select>
            <label className="workspace-transition-toggle">
              <span>{hasImage ? "Replace gradient image" : "Gradient image"}</span>
              <input
                type="file"
                accept="image/*"
                aria-label="Gradient image"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || !canEdit()) return;
                  try {
                    const luma = await readLumaImage(file);
                    handleParamChange("lumaData", luma.lumaData);
                    handleParamChange("lumaWidth", luma.lumaWidth);
                    handleParamChange("lumaHeight", luma.lumaHeight);
                  } catch (error) {
                    toast.error("Gradient image", error instanceof Error ? error.message : "Could not read that image");
                  }
                }}
              />
            </label>
          </>
        );
      }

      case "cubeSpin":
      case "flipOver":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(direction) => handleParamChange("direction", direction)}
              options={["left", "right", "up", "down"]}
            />
            {renderBorderControls()}
          </>
        );

      case "split":
        return (
          <>
            <DirectionSelector
              value={(params.orientation as string) || "horizontal"}
              onChange={(orientation) => handleParamChange("orientation", orientation)}
              options={["horizontal", "vertical"]}
            />
            <Toggle label="Reverse" value={(params.reverse as boolean) ?? false} onChange={(value) => handleParamChange("reverse", value)} />
            {renderBorderControls()}
          </>
        );

      case "crossZoom":
        return (
          <>
            <TransitionSlider
              label="Intensity"
              value={((params.intensity as number) ?? 1) * 100}
              onChange={(value) => handleParamChange("intensity", value / 100)}
              min={0}
              max={300}
              step={5}
              unit="%"
            />
            {renderCenterControls()}
          </>
        );

      case "pagePeel":
        return (
          <>
            <CornerSelector value={(params.corner as string) || "bottomRight"} onChange={(corner) => handleParamChange("corner", corner)} />
            <TransitionSlider
              label="Fold shadow"
              value={((params.shadow as number) ?? 0.55) * 100}
              onChange={(value) => handleParamChange("shadow", value / 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </>
        );

      case "inset":
        return <CornerSelector value={(params.corner as string) || "topLeft"} onChange={(corner) => handleParamChange("corner", corner)} />;

      case "checkerboard":
        return renderTilesControl("Squares across");

      case "checkerWipe":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(direction) => handleParamChange("direction", direction)}
              options={["left", "right", "up", "down"]}
            />
            {renderTilesControl("Squares across")}
          </>
        );

      case "wedgeWipe":
        return (
          <>
            <TransitionSlider
              label="Start Angle"
              value={(params.startAngle as number) ?? 0}
              onChange={(value) => handleParamChange("startAngle", value)}
              min={-180}
              max={180}
              step={1}
              unit="°"
            />
            {renderCenterControls()}
          </>
        );

      case "randomBlocks":
        return (
          <>
            {renderTilesControl("Blocks across")}
            {renderSeedControl()}
          </>
        );

      case "randomWipe":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(direction) => handleParamChange("direction", direction)}
              options={["left", "right", "up", "down"]}
            />
            {renderTilesControl("Strips")}
            {renderSeedControl()}
          </>
        );

      case "morphCut":
        return <MorphCutControls transitionId={transition?.id} params={params} onChange={handleParamChange} />;

      case "filmDissolve":
      case "additiveDissolve":
        return null;

      case "crossfade":
      default:
        return null;
    }
  };

  const selectedTypeInfo = transitionTypes.find((t) => t.type === selectedType);
  const name =
    selectedType === "crossfade"
      ? "Cross dissolve"
      : selectedType === "circleReveal"
        ? "Iris"
        : (selectedTypeInfo?.name ?? selectedType);
  const cutTime =
    edge === "in" ? clipA.startTime : clipA.startTime + clipA.duration;
  const curve = typeof params.curve === "string" ? params.curve : "linear";
  const curvePreview = EASING_CURVES[curve] ?? EASING_CURVES.linear;
  const actualDurationMax = edge
    ? (validation.maxDuration ?? clipA.duration)
    : alignment === "start"
      ? (clipB?.duration ?? clipA.duration)
      : alignment === "end"
        ? clipA.duration
        : (validation.maxDuration ?? 5);
  const savePreset = async (scope: "project" | "library" = "project") => {
    if (scope === "library") {
      const { getGlobalTransitionPresets } = await import("../../../services/global-transition-presets");
      const outcome = await getGlobalTransitionPresets().save(presetName, { type: selectedType, duration, params });
      if (outcome.ok) {
        toast.success("Transition preset", outcome.message);
        setPresetNaming(false);
      } else toast.error("Transition preset", outcome.error);
      return;
    }
    const { saveTransitionPreset } = await import("../../../services/transition-presets");
    const outcome = await saveTransitionPreset(presetName, { type: selectedType, duration, params });
    if (outcome.ok) {
      toast.success("Transition preset", outcome.message);
      setPresetNaming(false);
    } else {
      toast.error("Transition preset", outcome.error);
    }
  };
  const applyToAllCuts = async () => {
    if (applyingAll || !canEdit()) return;
    const store = useProjectStore.getState();
    const projectId = store.project.id;
    const history = store.actionHistory;
    setApplyingAll(true);
    let count = 0;
    history.beginGroup("Apply transitions to all cuts");
    try {
      tracks:
      for (const track of store.project.timeline.tracks) {
        if (track.locked || track.type !== "video") continue;
        const clips = [...track.clips].sort((a, b) => a.startTime - b.startTime);
        for (let i = 0; i < clips.length - 1; i++) {
          if (!canEdit()) break tracks;
          const a = clips[i],
            b = clips[i + 1];
          if (Math.abs(a.startTime + a.duration - b.startTime) > 0.001) continue;
          const existing = store.getClipTransitionBetweenClips(a.id, b.id);
          const max =
            alignment === "start"
              ? b.duration
              : alignment === "end"
                ? a.duration
                : Math.min(a.duration, b.duration) * 2;
          const next = {
            type: selectedType,
            duration: Math.min(duration, max),
            params,
          };
          if (existing) {
            if (await store.updateClipTransition(existing.id, next)) count++;
          } else {
            const created = bridge.createTransition(
              a,
              b,
              next.type,
              next.duration,
              params,
            );
            const value = created.transitionId
              ? bridge.getTransition(created.transitionId)
              : null;
            if (value && (await store.addClipTransition(value))) count++;
          }
        }
      }
    } catch (error) {
      if (useProjectStore.getState().project.id === projectId)
        toast.error("Could not apply all transitions", error instanceof Error ? error.message : "Try again, or undo the edits already applied.");
      return;
    } finally {
      history.endGroup();
      setApplyingAll(false);
    }
    if (useProjectStore.getState().project.id !== projectId) return;
    if (count)
      toast.success(
        `Transition applied to ${count} cut${count === 1 ? "" : "s"}`,
      );
    else
      toast.warning(
        "No adjacent video cuts",
        "Place two video clips next to each other on an unlocked track.",
      );
  };
  return (
    <fieldset disabled={locked} className="workspace-transition-inspector m-0 min-w-0 border-0 p-0">
      <div className="workspace-transition-summary">
        <div
          className="workspace-transition-pair"
          role="img"
          aria-label={`Transition clips: ${mediaA?.name ?? "A"} to ${mediaB?.name ?? (edge ? "project background" : "B")}`}
        >
          <div className="workspace-transition-frame">
            {mediaA?.thumbnailUrl && <img src={mediaA.thumbnailUrl} alt="" />}
            <span>A</span>
          </div>
          <div className="workspace-transition-frame">
            {mediaB?.thumbnailUrl && <img src={mediaB.thumbnailUrl} alt="" />}
            <span>B</span>
          </div>
          <div className="workspace-transition-blend" aria-hidden="true" />
        </div>
        <div className="workspace-transition-summary-row">
          <div>
            <strong>{name}</strong>
            <p>
              {track ? getTrackBadge(project.timeline.tracks, track.id) : "Video"} ·{" "}
              {edge ? `${edge === "in" ? "intro" : "outro"} at` : "cut at"}{" "}
              {formatFrameTimecode(cutTime, frameRate)}
            </p>
          </div>
          <Select
            value={selectedType}
            onValueChange={(value) => handleTypeChange(value as TransitionType)}
          >
            <SelectTrigger
              aria-label="Replace transition"
              className="workspace-transition-replace"
              icon={<span aria-hidden="true">▾</span>}
            >
              <span>Replace</span>
            </SelectTrigger>
            <SelectContent>
              {transitionTypes.map((info) => (
                <SelectItem key={info.type} value={info.type}>
                  {info.type === "crossfade" ? "Cross dissolve" : info.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="workspace-transition-properties">
        <TransitionDurationField
          key={`${project.id}:${transition?.id ?? "new"}:${clipA.id}:${clipB?.id ?? edge}`}
          value={duration}
          frameRate={frameRate}
          max={actualDurationMax}
          onChange={handleDurationChange}
        />
        {!edge && (
          <div className="workspace-transition-property">
            <span>Alignment</span>
            <RadioGroup
              aria-label="Transition alignment"
              className="workspace-transition-alignment"
              orientation="horizontal"
              value={alignment}
              onValueChange={(value) => {
                if (!canEdit()) return;
                const nextMax =
                  value === "start"
                    ? (clipB?.duration ?? clipA.duration)
                    : value === "end"
                      ? clipA.duration
                      : Math.min(
                          clipA.duration,
                          clipB?.duration ?? clipA.duration,
                        ) * 2;
                const nextDuration = Math.min(duration, nextMax);
                const nextParams = { ...params, alignment: value };
                setParams(nextParams);
                setDuration(nextDuration);
                if (transition)
                  onTransitionUpdate?.(transition.id, {
                    duration: nextDuration,
                    params: nextParams,
                  });
              }}
            >
              {["start", "center", "end"].map(value => <div key={value} className="workspace-transition-alignment-choice">
                <RadioGroupItem id={`${alignmentId}-${value}`} value={value} aria-label={value[0].toUpperCase() + value.slice(1)} />
                <Label htmlFor={`${alignmentId}-${value}`}>{value[0].toUpperCase() + value.slice(1)}</Label>
              </div>)}
            </RadioGroup>
          </div>
        )}
        <div className="workspace-transition-property is-easing">
          <span>Easing</span>
          <div className="workspace-transition-easing">
            <Select
              value={EASING_CURVES[curve] ? curve : "linear"}
              onValueChange={(value) => handleParamChange("curve", value)}
            >
              <SelectTrigger aria-label="Transition easing" icon={<span className="workspace-transition-caret" aria-hidden="true">▾</span>}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="ease">Ease in-out</SelectItem>
                <SelectItem value="ease-in">Ease in</SelectItem>
                <SelectItem value="ease-out">Ease out</SelectItem>
                <SelectItem value="ease-in-out">Quadratic in-out</SelectItem>
              </SelectContent>
            </Select>
          <div
            className="workspace-transition-curve"
            aria-label={`${curvePreview.label} curve`}
            role="img"
          >
            <svg
              width="100%"
              height="80"
              viewBox="0 0 200 80"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d={curvePreview.path}
                stroke="var(--accent)"
                strokeWidth="2"
                fill="none"
              />
              {curve === "ease" && <>
                <path d="M10 70 L80 70 M190 10 L120 10" stroke="#3A3D44" strokeWidth="1" strokeDasharray="3 3" />
                <circle cx="80" cy="70" r="3.5" fill="#E8E9EC" />
                <circle cx="120" cy="10" r="3.5" fill="#E8E9EC" />
              </>}
            </svg>
          </div>
          </div>
        </div>
        <div className="workspace-transition-property">
          <span>Start / end</span>
          <div className="grid grid-cols-2 gap-2">
            <TransitionSlider
              label="Start"
              value={(params.startPct as number) ?? 0}
              onChange={(value) => handleParamChange("startPct", Math.min(value, (params.endPct as number) ?? 100))}
              min={0}
              max={100}
              unit="%"
            />
            <TransitionSlider
              label="End"
              value={(params.endPct as number) ?? 100}
              onChange={(value) => handleParamChange("endPct", Math.max(value, (params.startPct as number) ?? 0))}
              min={0}
              max={100}
              unit="%"
            />
          </div>
        </div>
        {isMaskTransition(selectedType) && (
          <div className="workspace-transition-parameters" data-testid="transition-mask-controls">
            <TransitionSlider
              label="Feather"
              value={((params.feather as number) ?? 0) * 100}
              onChange={(value) => handleParamChange("feather", value / 100)}
              min={0}
              max={100}
              unit="%"
            />
            <TransitionSlider
              label="Border width"
              value={(params.borderWidth as number) ?? 0}
              onChange={(value) => handleParamChange("borderWidth", Math.round(value))}
              min={0}
              max={50}
              unit="px"
            />
            <label className="workspace-transition-toggle">
              <span>Border colour</span>
              <input
                type="color"
                aria-label="Border colour"
                value={typeof params.borderColor === "string" && /^#[0-9a-f]{6}$/i.test(params.borderColor) ? params.borderColor : "#ffffff"}
                onChange={(event) => handleParamChange("borderColor", event.target.value)}
              />
            </label>
            <Toggle
              label="Reverse"
              value={(params.reverse as boolean) ?? false}
              onChange={(value) => handleParamChange("reverse", value)}
            />
          </div>
        )}
        <Toggle
          label={edge ? "Fade clip audio" : "Also blend audio (crossfade)"}
          value={(params.audioFade as boolean) ?? false}
          onChange={(value) => handleParamChange("audioFade", value)}
        />
        {selectedTypeInfo?.hasCustomParams && (
          <div className="workspace-transition-parameters">
            {renderTypeParams()}
          </div>
        )}
        {validation.warning && (
          <p className="text-[11px] text-amber-400" role="status">
            {validation.warning}
          </p>
        )}
        {!validation.valid && validation.error && (
          <p className="text-[11px] text-red-400" role="alert">
            {validation.error}
          </p>
        )}
      </div>
      <div className="workspace-transition-presets" data-testid="transition-preset-row">
        {presetNaming ? (
          <>
            <Input
              autoFocus
              aria-label="Preset name"
              value={presetName}
              placeholder="Preset name"
              onChange={(event) => setPresetName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void savePreset();
                if (event.key === "Escape") setPresetNaming(false);
              }}
            />
            <Button variant="secondary" onClick={() => void savePreset()} title="Keep the preset in this project">Save</Button>
            <Button variant="secondary" onClick={() => void savePreset("library")} title="Keep the preset for every project in this app">Save to library</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => { setPresetName(""); setPresetNaming(true); }}>Save as preset…</Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const { setDefaultTransition } = await import("../../../services/transition-presets");
                const outcome = await setDefaultTransition({ type: selectedType, duration, params, label: name });
                if (outcome.ok) toast.success("Default transition", outcome.message);
                else toast.error("Default transition", outcome.error);
              }}
            >
              Set as default
            </Button>
          </>
        )}
      </div>
      <div className="workspace-transition-actions">
        <Button variant="secondary" disabled={applyingAll} onClick={() => void applyToAllCuts()}>
          {applyingAll ? "Applying…" : "Apply to all cuts"}
        </Button>
        {transition ? (
          <Button
            variant="secondary"
            className="text-red-400"
            onClick={handleRemove}
          >
            Remove
          </Button>
        ) : (
          <Button className="workspace-transition-create" disabled={!validation.valid} onClick={handleCreate}>
            Apply transition
          </Button>
        )}
      </div>
    </fieldset>
  );
};

export function TransitionDurationField({
  value,
  frameRate,
  max,
  onChange,
  label = "Duration",
  ariaLabel = "Transition duration",
  className = "",
}: {
  value: number;
  frameRate: number;
  max: number;
  onChange: (value: number) => void;
  label?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(formatFrameTimecode(value, frameRate));
  const [editing, setEditing] = useState(false);
  const cancelled = React.useRef(false);
  useEffect(() => {
    if (!editing) setDraft(formatFrameTimecode(value, frameRate));
  }, [value, frameRate, editing]);
  const commit = () => {
    const parts = draft.split(":").map(Number);
    const next =
      parts.length === 4
        ? parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / frameRate
        : Number(draft);
    if (Number.isFinite(next) && next > 0)
      onChange(Math.max(1 / frameRate, Math.min(max, next)));
    else setDraft(formatFrameTimecode(value, frameRate));
  };
  return (
    <label className={`workspace-transition-property ${className}`}>
      <span>{label}</span>
      <Input
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        onBlur={() => {
          if (!cancelled.current) commit();
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(formatFrameTimecode(value, frameRate));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

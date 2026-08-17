import type { CSSProperties, JSX } from "react";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  MoveUp,
  Repeat2,
  Sparkles,
  Zap,
} from "@/icons/lucide-compat";
import {
  MOTION_ANIMATION_PRESETS,
  applyMotionAnimationPreset,
  canApplyMotionAnimationPreset,
  type MotionAnimationPreset,
  type MotionAnimationPresetCategory,
  type MotionComposition,
} from "@openreel/core";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  EmptyState,
  Field,
  NumberInput,
  PanelHeader,
  Section,
} from "./primitives";
import { useTranslation } from "react-i18next";

interface AnimationPresetsPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const CATEGORY_META: Record<
  MotionAnimationPresetCategory,
  { label: string; icon: typeof Sparkles }
> = {
  entrance: { label: "Entrance", icon: ArrowUpFromLine },
  exit: { label: "Exit", icon: ArrowDownToLine },
  emphasis: { label: "Emphasis", icon: Zap },
  loop: { label: "Loop", icon: Repeat2 },
  shape: { label: "Shape Style", icon: Sparkles },
};

const CATEGORY_ORDER: readonly MotionAnimationPresetCategory[] = [
  "entrance",
  "emphasis",
  "shape",
  "exit",
  "loop",
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function AnimationPresetsPanel({
  composition,
  embedded = false,
}: AnimationPresetsPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const [duration, setDuration] = useState(0.6);
  const [distance, setDistance] = useState(120);
  const [intensity, setIntensity] = useState(1);
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const playhead = useMotionStore((state) => state.playhead);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const selectedLayers = selectedLayerId
    ? Array.from(new Set([selectedLayerId, ...selectedLayerIds])).flatMap(
        (id) => {
          const layer = composition.layers.find((candidate) => candidate.id === id);
          return layer ? [layer] : [];
        },
      )
    : [];

  const applyPreset = (preset: MotionAnimationPreset) => {
    const targetIds = new Set(
      selectedLayers
        .filter(
          (layer) =>
            !layer.locked && canApplyMotionAnimationPreset(layer, preset),
        )
        .map((layer) => layer.id),
    );
    if (targetIds.size === 0) return;
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) => {
        if (!targetIds.has(layer.id)) return layer;
        const localTime = clamp(
          playhead - layer.startTime,
          0,
          Math.max(0, layer.duration - 0.001),
        );
        return applyMotionAnimationPreset(layer, preset.id, {
          startTime: localTime,
          duration,
          distance,
          intensity,
        });
      }),
      modifiedAt: Date.now(),
    });
    setSelectedProperty(preset.properties[0] ?? "transform.position.x");
  };

  if (!selectedLayer) {
    if (embedded) {
      return null;
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title={t("Animation Presets")} icon={Sparkles} />
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Sparkles}
            title={t("Select a layer")}
            description={t("Apply entrance, exit, emphasis, and loop presets as editable keyframes.")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : <PanelHeader title={t("Animation Presets")} icon={Sparkles} />}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title={t("Timing")} icon={MoveUp}>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label={t("Duration")} hint="s">
              <NumberInput
                value={duration}
                min={0.05}
                max={selectedLayer.duration}
                step={0.05}
                onChange={setDuration}
              />
            </Field>
            <Field label={t("Distance")} hint="px">
              <NumberInput
                value={distance}
                min={0}
                max={2000}
                step={10}
                onChange={setDistance}
              />
            </Field>
            <Field label={t("Intensity")}>
              <NumberInput
                value={intensity}
                min={0}
                max={4}
                step={0.05}
                onChange={setIntensity}
              />
            </Field>
          </div>
          <div className="rounded-md border border-border bg-bg-2 px-2.5 py-2 text-[11px] text-fg-muted">
            {selectedLayers.length > 1 ? (
              <>
                {t("Applies at each layer’s local playhead time across")}{" "}
                <span className="font-medium text-fg-2">
                  {selectedLayers.length} {t(" selected layers")}</span>
                {t(". Locked or incompatible layers are skipped.")}</>
            ) : (
              <>
                {t("Applies at local ")}{formatSeconds(playhead - selectedLayer.startTime)} on{" "}
                <span className="font-medium text-fg-2">{selectedLayer.name}</span>.
              </>
            )}
          </div>
        </Section>

        {CATEGORY_ORDER.map((category) => {
          const presets = MOTION_ANIMATION_PRESETS.filter(
            (preset) =>
              preset.category === category &&
              canApplyMotionAnimationPreset(selectedLayer, preset),
          );
          if (presets.length === 0) return null;
          return (
            <PresetCategorySection
              key={category}
              category={category}
              presets={presets}
              disabled={selectedLayer.locked}
              onApply={applyPreset}
            />
          );
        })}
      </div>
    </div>
  );
}

function PresetCategorySection({
  category,
  presets,
  disabled,
  onApply,
}: {
  category: MotionAnimationPresetCategory;
  presets: readonly MotionAnimationPreset[];
  disabled: boolean;
  onApply: (preset: MotionAnimationPreset) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <Section title={t(meta.label)} icon={Icon}>
      <div className="grid grid-cols-1 gap-2">
        {presets.map((preset) => (
          <PresetButton
            key={preset.id}
            preset={preset}
            disabled={disabled}
            onApply={() => onApply(preset)}
          />
        ))}
      </div>
    </Section>
  );
}

function PresetButton({
  preset,
  disabled,
  onApply,
}: {
  preset: MotionAnimationPreset;
  disabled: boolean;
  onApply: () => void;
}): JSX.Element {
  const [isHovered, setIsHovered] = useState(false);
  const [progress, setProgress] = useState(0.62);

  useEffect(() => {
    if (!isHovered) {
      setProgress(0.62);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      setProgress(((now - startedAt) % 1200) / 1200);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [isHovered]);

  return (
    <ToolcraftClickableCard
      label={`Apply ${preset.name}`}
      disabled={disabled}
      onClick={onApply}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      variant="muted"
      padding={2}
      className="min-h-[88px]"
    >
      <span className="flex items-center gap-2.5">
        <AnimationPresetPreview
          preset={preset}
          progress={progress}
          className="mb-0 h-[70px] w-24 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex items-start justify-between gap-2">
            <ToolcraftText
              as="span"
              type="label"
              color="primary"
              weight="semibold"
              className="min-w-0 leading-tight"
            >
              {preset.name}
            </ToolcraftText>
            <ToolcraftText
              as="span"
              type="supporting"
              color="secondary"
              className="shrink-0 rounded bg-bg-1 px-1.5 py-0.5 tabular-nums"
            >
              {preset.defaultDuration}s
            </ToolcraftText>
          </span>
          <ToolcraftText type="supporting" color="secondary" maxLines={2}>
            {preset.description}
          </ToolcraftText>
        </span>
      </span>
    </ToolcraftClickableCard>
  );
}

function AnimationPresetPreview({
  preset,
  progress,
  className = "",
}: {
  preset: MotionAnimationPreset;
  progress: number;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const eased = 1 - Math.pow(1 - progress, 3);
  const pulse = Math.sin(progress * Math.PI * 2);
  const style = previewStyle(preset, eased, pulse);
  const isShapePreset = preset.category === "shape";

  return (
    <span
      data-testid="motion-animation-preset-preview"
      data-preset-id={preset.id}
      aria-hidden="true"
      className={`relative mb-2 block h-14 overflow-hidden rounded-md border border-white/10 bg-[radial-gradient(circle_at_50%_25%,rgba(139,92,246,.2),transparent_55%),#0f1420] ${className}`}
    >
      <span className="absolute inset-x-2 bottom-2 h-px bg-white/10" />
      <span
        className={`absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 shadow-lg ${
          isShapePreset
            ? "h-7 w-10 rounded-md border-2 border-cyan-300 bg-cyan-400/15"
            : "flex h-7 w-12 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 text-[10px] font-black text-white"
        }`}
        style={style}
      >
        {isShapePreset ? null : "Aa"}
      </span>
      <span className="absolute bottom-1 right-1.5 text-[7px] font-bold uppercase tracking-[0.12em] text-white/45">
        {t("Preview")}</span>
    </span>
  );
}

function previewStyle(
  preset: MotionAnimationPreset,
  progress: number,
  pulse: number,
): CSSProperties {
  switch (preset.id) {
    case "fade-in":
      return { opacity: progress };
    case "fade-out":
      return { opacity: 1 - progress };
    case "slide-up-in":
      return {
        opacity: progress,
        transform: `translate(-50%, calc(-50% + ${(1 - progress) * 28}px))`,
      };
    case "slide-left-in":
      return {
        opacity: progress,
        transform: `translate(calc(-50% - ${(1 - progress) * 34}px), -50%)`,
      };
    case "scale-pop":
      return { transform: `translate(-50%, -50%) scale(${0.35 + progress * 0.75 + Math.max(0, pulse) * 0.12})` };
    case "rotate-in":
      return { opacity: progress, transform: `translate(-50%, -50%) rotate(${(1 - progress) * -120}deg) scale(${0.55 + progress * 0.45})` };
    case "pulse":
      return { transform: `translate(-50%, -50%) scale(${1 + pulse * 0.18})` };
    case "float-loop":
      return { transform: `translate(-50%, calc(-50% + ${pulse * 8}px))` };
    case "click-press":
      return { transform: `translate(-50%, -50%) scale(${1 - Math.max(0, pulse) * 0.18})` };
    case "lift-to-3d":
      return { transform: `translate(-50%, calc(-50% - ${progress * 8}px)) perspective(120px) rotateX(${(1 - progress) * 28}deg)`, boxShadow: `0 ${4 + progress * 8}px ${8 + progress * 12}px rgba(0,0,0,.45)` };
    case "flip-in-3d":
      return { opacity: progress > 0.08 ? 1 : 0, transform: `translate(-50%, -50%) perspective(120px) rotateY(${(1 - progress) * -90}deg)` };
    case "stroke-draw-on":
      return { clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`, background: "transparent" };
    case "stroke-pop":
      return { transform: `translate(-50%, -50%) scale(${0.45 + progress * 0.55 + Math.max(0, pulse) * 0.1})`, background: "transparent" };
    case "gradient-sweep":
      return { background: `linear-gradient(${progress * 180}deg, #22d3ee, #8b5cf6, #f472b6)`, transform: "translate(-50%, -50%)" };
    case "corner-bloom":
      return { borderRadius: `${Math.round((1 - progress) * 50)}%`, transform: `translate(-50%, -50%) scale(${0.65 + progress * 0.35})` };
  }
}

function formatSeconds(value: number): string {
  return `${Math.max(0, value).toFixed(2)}s`;
}

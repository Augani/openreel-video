import { useState, type JSX } from "react";
import {
  Aperture,
  ArrowDown,
  ArrowUp,
  Diamond,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Layers,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from "@/icons/lucide-compat";
import {
  MOTION_EFFECT_PRESETS,
  addMotionLayerEffect,
  createMotionEffect,
  createMotionShaderEffect,
  duplicateMotionLayerEffect,
  findMotionLayerKeyframeAtTime,
  getMotionEffectKeyframeProperty,
  getMotionEffectParameterDescriptor,
  getMotionEffectParameterDescriptors,
  getMotionEffectParameterValueAtTime,
  getMotionShaderDef,
  getMotionShaderEffectDefs,
  isMotionExpressionControlEffect,
  nextMotionControlName,
  removeMotionLayerEffect,
  clearMotionEffectStack,
  removeMotionLayerKeyframe,
  reorderMotionLayerEffect,
  setMotionEffectParameterValue,
  toggleMotionLayerEffect,
  transferMotionEffectStack,
  updateMotionLayerEffect,
  upsertMotionLayerKeyframe,
  type MotionComposition,
  type MotionEffect,
  type MotionEffectParameterName,
  type MotionEffectType,
  type MotionLayer,
  type MotionShaderParamDef,
} from "@openreel/core";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { GenerateShaderBox } from "./GenerateShaderBox";
import { ShaderPreviewBrowser } from "../../components/shaders/ShaderPreviewBrowser";
import { MotionEffectPreview } from "./MotionEffectPreview";
import {
  Button,
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  Slider,
  SwitchInput,
} from "./primitives";

interface EffectsPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

let effectStackClipboard: Pick<MotionLayer, "effects" | "keyframes" | "expressions"> | null = null;

type MotionEffectCategory = "all" | "color" | "blur" | "stylize" | "distort";

const EFFECT_CATEGORIES: readonly { id: MotionEffectCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "color", label: "Color" },
  { id: "blur", label: "Blur" },
  { id: "stylize", label: "Stylize" },
  { id: "distort", label: "Distort" },
];

const EFFECT_CATEGORY_BY_TYPE: Partial<Record<MotionEffectType, Exclude<MotionEffectCategory, "all">>> = {
  "color-adjust": "color", invert: "color", grayscale: "color", sepia: "color",
  levels: "color", threshold: "color", vignette: "color",
  blur: "blur", "directional-blur": "blur", "radial-blur": "blur",
  "backdrop-blur": "blur", sharpen: "blur",
  "drop-shadow": "stylize", glow: "stylize", posterize: "stylize", noise: "stylize",
  mosaic: "stylize", "chromatic-aberration": "stylize",
  displace: "distort",
};

const EXPRESSION_CONTROL_TYPES: readonly MotionEffectType[] = [
  "slider-control",
  "checkbox-control",
  "angle-control",
];

function isExpressionControlPreset(type: MotionEffectType): boolean {
  return EXPRESSION_CONTROL_TYPES.includes(type);
}

interface MotionEffectBrowserPreset {
  readonly id: string;
  readonly type: MotionEffectType;
  readonly name: string;
  readonly description: string;
  readonly create: (id?: string) => MotionEffect;
}

function createEffectVariant(
  type: MotionEffectType,
  name: string,
  overrides: Record<string, unknown>,
  id?: string,
): MotionEffect {
  return { ...createMotionEffect(type, id), ...overrides, name } as MotionEffect;
}

export const MOTION_EFFECT_VARIANTS: readonly MotionEffectBrowserPreset[] = [
  {
    id: "dream-blur",
    type: "blur",
    name: "Dream Blur",
    description: "Soft diffusion for dreamy title and portrait treatments.",
    create: (id) => createEffectVariant("blur", "Dream Blur", { radius: 32 }, id),
  },
  {
    id: "neon-glow",
    type: "glow",
    name: "Neon Glow",
    description: "Hot magenta bloom for logos, type, and UI accents.",
    create: (id) =>
      createEffectVariant(
        "glow",
        "Neon Glow",
        { color: "#ec4899", intensity: 0.9, radius: 64 },
        id,
      ),
  },
  {
    id: "long-shadow",
    type: "drop-shadow",
    name: "Long Shadow",
    description: "Graphic offset shadow for bold motion-design layouts.",
    create: (id) =>
      createEffectVariant(
        "drop-shadow",
        "Long Shadow",
        { color: "#111827", opacity: 0.6, blur: 4, offsetX: 28, offsetY: 28 },
        id,
      ),
  },
  {
    id: "film-grain",
    type: "noise",
    name: "Film Grain",
    description: "Fine organic grain for cinematic texture and cohesion.",
    create: (id) =>
      createEffectVariant("noise", "Film Grain", { amount: 0.08, seed: 37 }, id),
  },
  {
    id: "crt-split",
    type: "chromatic-aberration",
    name: "CRT Split",
    description: "Strong horizontal RGB separation for retro screens.",
    create: (id) =>
      createEffectVariant(
        "chromatic-aberration",
        "CRT Split",
        { amount: 14, angle: 0 },
        id,
      ),
  },
  {
    id: "punchy-contrast",
    type: "color-adjust",
    name: "Punchy Contrast",
    description: "Crisp contrast and saturation for high-impact graphics.",
    create: (id) =>
      createEffectVariant(
        "color-adjust",
        "Punchy Contrast",
        { brightness: 1, contrast: 1.35, saturation: 1.2, hue: 0 },
        id,
      ),
  },
  {
    id: "cinematic-fade",
    type: "levels",
    name: "Cinematic Fade",
    description: "Lifted blacks and softened whites for a filmic tonal rolloff.",
    create: (id) =>
      createEffectVariant(
        "levels",
        "Cinematic Fade",
        {
          inputBlack: 0,
          inputWhite: 1,
          gamma: 1.08,
          outputBlack: 0.08,
          outputWhite: 0.94,
        },
        id,
      ),
  },
  {
    id: "comic-poster",
    type: "posterize",
    name: "Comic Poster",
    description: "Reduced color bands for graphic illustration and title cards.",
    create: (id) =>
      createEffectVariant("posterize", "Comic Poster", { levels: 5 }, id),
  },
  {
    id: "speed-streak",
    type: "directional-blur",
    name: "Speed Streak",
    description: "Fast horizontal smear for energetic entrances and exits.",
    create: (id) =>
      createEffectVariant(
        "directional-blur",
        "Speed Streak",
        { angle: 0, distance: 34 },
        id,
      ),
  },
  {
    id: "zoom-burst",
    type: "radial-blur",
    name: "Zoom Burst",
    description: "Centered radial rush for impact frames and transitions.",
    create: (id) =>
      createEffectVariant(
        "radial-blur",
        "Zoom Burst",
        { centerX: 0.5, centerY: 0.5, amount: 32 },
        id,
      ),
  },
  {
    id: "analog-warp",
    type: "displace",
    name: "Analog Warp",
    description: "Organic turbulent distortion for tape and liquid treatments.",
    create: (id) =>
      createEffectVariant(
        "displace",
        "Analog Warp",
        { amount: 18, scale: 42, seed: 73 },
        id,
      ),
  },
  {
    id: "ink-cutout",
    type: "threshold",
    name: "Ink Cutout",
    description: "Hard black-and-white separation for print-style graphics.",
    create: (id) =>
      createEffectVariant("threshold", "Ink Cutout", { level: 0.56 }, id),
  },
  {
    id: "pixel-art",
    type: "mosaic",
    name: "Pixel Art",
    description: "Chunky pixel blocks for retro games and censored reveals.",
    create: (id) =>
      createEffectVariant("mosaic", "Pixel Art", { blockSize: 18 }, id),
  },
  {
    id: "soft-focus",
    type: "vignette",
    name: "Soft Focus",
    description: "Gentle edge falloff that draws attention toward the subject.",
    create: (id) =>
      createEffectVariant(
        "vignette",
        "Soft Focus",
        { amount: 0.52, softness: 0.78 },
        id,
      ),
  },
];

const EFFECT_BROWSER_PRESETS: readonly MotionEffectBrowserPreset[] = [
  ...MOTION_EFFECT_PRESETS.filter(
    (preset) => !isExpressionControlPreset(preset.type),
  ).map((preset) => ({ ...preset, id: `default-${preset.type}` })),
  ...MOTION_EFFECT_VARIANTS,
];

const EFFECT_ICON: Record<MotionEffectType, typeof Sparkles> = {
  blur: Layers,
  "drop-shadow": Sparkles,
  glow: Wand2,
  "color-adjust": Sparkles,
  invert: Wand2,
  grayscale: Layers,
  sepia: Sparkles,
  levels: SlidersHorizontal,
  sharpen: Wand2,
  posterize: Layers,
  "directional-blur": Layers,
  noise: Sparkles,
  "radial-blur": Layers,
  displace: Wand2,
  threshold: SlidersHorizontal,
  mosaic: Layers,
  "chromatic-aberration": Aperture,
  vignette: Aperture,
  "backdrop-blur": Aperture,
  shader: Wand2,
  "slider-control": SlidersHorizontal,
  "checkbox-control": SlidersHorizontal,
  "angle-control": SlidersHorizontal,
};

export function EffectsPanel({ composition, embedded = false }: EffectsPanelProps): JSX.Element | null {
  const [effectSearch, setEffectSearch] = useState("");
  const [effectCategory, setEffectCategory] = useState<MotionEffectCategory>("all");
  const [hasEffectStackClipboard, setHasEffectStackClipboard] = useState(
    () => effectStackClipboard !== null,
  );
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const playhead = useMotionStore((state) => state.playhead);
  const autoKeyframe = useMotionStore((state) => state.autoKeyframe);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const effectTargetLayerIds = selectedLayerId
    ? Array.from(new Set([selectedLayerId, ...selectedLayerIds])).filter((id) =>
        composition.layers.some((layer) => layer.id === id),
      )
    : [];
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );

  const replaceLayer = (nextLayer: MotionLayer) => {
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === nextLayer.id ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addEffectToSelection = (createEffect: () => MotionEffect) => {
    if (effectTargetLayerIds.length === 0) return;
    const targetIds = new Set(effectTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id)
          ? addMotionLayerEffect(layer, createEffect())
          : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addEffectPreset = (preset: MotionEffectBrowserPreset) => {
    addEffectToSelection(() => preset.create());
  };

  const addControl = (type: MotionEffectType, baseName: string) => {
    if (!selectedLayerId) return;
    const currentComposition =
      useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === composition.id,
        ) ?? composition;
    const currentLayer = currentComposition.layers.find(
      (layer) => layer.id === selectedLayerId,
    );
    if (!currentLayer) return;
    const effect = createMotionEffect(type);
    const appended = addMotionLayerEffect(currentLayer, effect);
    const named = updateMotionLayerEffect(appended, effect.id, (current) => ({
      ...current,
      name: nextMotionControlName(
        (appended.effects ?? []).filter((item) => item.id !== effect.id),
        baseName,
      ),
    }));
    void upsertMotionComposition({
      ...currentComposition,
      layers: currentComposition.layers.map((layer) =>
        layer.id === named.id ? named : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addShaderEffect = (shaderId: string) => {
    addEffectToSelection(() => createMotionShaderEffect(shaderId));
  };

  const updateEffect = (
    effectId: string,
    updater: (effect: MotionEffect) => MotionEffect,
  ) => {
    if (!selectedLayer) return;
    replaceLayer(updateMotionLayerEffect(selectedLayer, effectId, updater));
  };

  const copyEffectStack = () => {
    if (!selectedLayer || (selectedLayer.effects ?? []).length === 0) return;
    const effectIds = new Set((selectedLayer.effects ?? []).map((effect) => effect.id));
    const belongsToStack = (property: string) => {
      const match = /^effect\.([^.]+)\./.exec(property);
      return match ? effectIds.has(match[1]) : false;
    };
    effectStackClipboard = {
      effects: (selectedLayer.effects ?? []).map((effect) =>
        effect.type === "shader"
          ? { ...effect, params: { ...effect.params } }
          : { ...effect },
      ),
      keyframes: selectedLayer.keyframes
        .filter((keyframe) => belongsToStack(keyframe.property))
        .map((keyframe) => ({ ...keyframe })),
      expressions: (selectedLayer.expressions ?? [])
        .filter((expression) => belongsToStack(expression.property))
        .map((expression) => ({ ...expression })),
    };
    setHasEffectStackClipboard(true);
  };

  const pasteEffectStack = (mode: "append" | "replace") => {
    if (!effectStackClipboard || effectTargetLayerIds.length === 0) return;
    const targetIds = new Set(effectTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id)
          ? transferMotionEffectStack(effectStackClipboard!, layer, mode).layer
          : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const clearEffectStacks = () => {
    if (effectTargetLayerIds.length === 0) return;
    const targetIds = new Set(effectTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id) ? clearMotionEffectStack(layer) : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  if (!selectedLayer) {
    if (embedded) return null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title="Effects" icon={Sparkles} />
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Sparkles}
            title="Select a layer"
            description="Layer effects can be stacked, reordered, and rendered into editor preview and export."
          />
        </div>
      </div>
    );
  }

  const effects = selectedLayer.effects ?? [];
  const normalizedEffectSearch = effectSearch.trim().toLowerCase();
  const visibleEffectPresets = EFFECT_BROWSER_PRESETS.filter((preset) => {
    if (
      effectCategory !== "all" &&
      EFFECT_CATEGORY_BY_TYPE[preset.type] !== effectCategory
    ) return false;
    return (
      normalizedEffectSearch.length === 0 ||
      preset.name.toLowerCase().includes(normalizedEffectSearch) ||
      preset.description.toLowerCase().includes(normalizedEffectSearch) ||
      preset.type.includes(normalizedEffectSearch)
    );
  });
  const localPlayhead = Math.min(
    selectedLayer.duration,
    Math.max(0, playhead - selectedLayer.startTime),
  );

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : <PanelHeader title="Effects" icon={Sparkles} />}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title="Add Effect" icon={Plus}>
          <div className="mb-2.5 space-y-2">
            {effectTargetLayerIds.length > 1 ? (
              <div className="rounded-md border border-accent/25 bg-accent-soft px-2.5 py-2">
                <ToolcraftText type="supporting" color="secondary">
                  New effects will be added to all {effectTargetLayerIds.length}{" "}
                  selected layers.
                </ToolcraftText>
              </div>
            ) : null}
            <label className="relative block">
              <span className="sr-only">Search standard effects</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" size={13} />
              <input
                type="search"
                value={effectSearch}
                onChange={(event) => setEffectSearch(event.target.value)}
                placeholder="Search effects"
                className="h-8 w-full rounded-md border border-border bg-bg-2 pl-8 pr-2.5 text-[11px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Effect categories">
              {EFFECT_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={effectCategory === category.id}
                  onClick={() => setEffectCategory(category.id)}
                  className={`h-6 rounded-md border px-2 text-[10px] font-medium transition-colors ${
                    effectCategory === category.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-bg-2 text-fg-3 hover:border-accent hover:text-accent"
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>
          {visibleEffectPresets.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-bg-2 px-3 py-4 text-center text-[11px] text-fg-muted">
              No standard effects match “{effectSearch.trim()}”.
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-2">
            {visibleEffectPresets.map((preset) => {
              const Icon = EFFECT_ICON[preset.type];
              const previewEffect = preset.create(`preview-${preset.id}`);
              return (
                <ToolcraftClickableCard
                  key={preset.id}
                  label={`Add ${preset.name}`}
                  onClick={() => addEffectPreset(preset)}
                  variant="muted"
                  padding={2}
                  className="min-h-[146px]"
                >
                  <MotionEffectPreview effect={previewEffect} />
                  <ToolcraftText
                    as="span"
                    type="label"
                    color="primary"
                    weight="semibold"
                    className="mb-1.5 flex items-center gap-1.5"
                  >
                    <Icon size={13} />
                    {preset.name}
                  </ToolcraftText>
                  <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                    {preset.description}
                  </ToolcraftText>
                </ToolcraftClickableCard>
              );
            })}
          </div>
          )}
        </Section>

        <Section title="Shaders" icon={Wand2}>
          <ShaderPreviewBrowser
            defs={getMotionShaderEffectDefs()}
            onSelect={addShaderEffect}
            sample="effect"
            label="Effect previews"
          />
          <div className="mt-2">
            <GenerateShaderBox
              category="effect"
              onGenerated={(def) => addShaderEffect(def.id)}
            />
          </div>
        </Section>

        <Section title="Expression controls" icon={SlidersHorizontal}>
          <div className="grid grid-cols-3 gap-2">
            {MOTION_EFFECT_PRESETS.filter((preset) =>
              isExpressionControlPreset(preset.type),
            ).map((preset) => {
              const Icon = EFFECT_ICON[preset.type];
              return (
                <ToolcraftClickableCard
                  key={preset.type}
                  label={`Add ${preset.name}`}
                  onClick={() => addControl(preset.type, preset.name)}
                  variant="muted"
                  padding={2}
                  className="min-h-[68px]"
                >
                  <ToolcraftText
                    as="span"
                    type="label"
                    color="primary"
                    weight="semibold"
                    className="mb-1.5 flex items-center gap-1.5"
                  >
                    <Icon size={13} />
                    {preset.name}
                  </ToolcraftText>
                  <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                    {preset.description}
                  </ToolcraftText>
                </ToolcraftClickableCard>
              );
            })}
          </div>
        </Section>

        <Section title={`Stack (${effects.length})`} icon={Sparkles}>
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <Button
              label="Copy stack"
              icon={Copy}
              variant="outline"
              size="sm"
              disabled={effects.length === 0}
              onClick={copyEffectStack}
            />
            <Button
              label="Paste append"
              icon={ClipboardPaste}
              variant="outline"
              size="sm"
              disabled={!hasEffectStackClipboard}
              onClick={() => pasteEffectStack("append")}
            />
            <Button
              label="Paste replace"
              variant="outline"
              size="sm"
              disabled={!hasEffectStackClipboard}
              onClick={() => pasteEffectStack("replace")}
            />
            <Button
              label="Clear stack"
              variant="outline"
              size="sm"
              disabled={
                !composition.layers.some(
                  (layer) =>
                    effectTargetLayerIds.includes(layer.id) &&
                    (layer.effects ?? []).length > 0,
                )
              }
              onClick={clearEffectStacks}
            />
          </div>
          {effects.length === 0 ? (
            <ToolcraftText type="supporting" color="secondary" className="rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
              Add blur, glow, shadow, or color adjustment effects to build a
              reusable motion look for this layer.
            </ToolcraftText>
          ) : (
            <div className="space-y-2">
              {effects.map((effect, index) => (
                <EffectCard
                  key={effect.id}
                  effect={effect}
                  isFirst={index === 0}
                  isLast={index === effects.length - 1}
                  onToggle={(enabled) =>
                    replaceLayer(
                      toggleMotionLayerEffect(selectedLayer, effect.id, enabled),
                    )
                  }
                  onMove={(direction) =>
                    replaceLayer(
                      reorderMotionLayerEffect(selectedLayer, effect.id, direction),
                    )
                  }
                  onRemove={() =>
                    replaceLayer(removeMotionLayerEffect(selectedLayer, effect.id))
                  }
                  onDuplicate={() =>
                    replaceLayer(
                      duplicateMotionLayerEffect(selectedLayer, effect.id).layer,
                    )
                  }
                  onUpdate={(updater) => updateEffect(effect.id, updater)}
                  layer={selectedLayer}
                  localTime={localPlayhead}
                  autoKeyframe={autoKeyframe}
                  replaceLayer={replaceLayer}
                  setSelectedProperty={setSelectedProperty}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function EffectCard({
  effect,
  isFirst,
  isLast,
  layer,
  localTime,
  autoKeyframe,
  onToggle,
  onMove,
  onRemove,
  onDuplicate,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  isFirst: boolean;
  isLast: boolean;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onToggle: (enabled: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const Icon = EFFECT_ICON[effect.type];
  return (
    <div className={`rounded-lg border border-border bg-bg-2 ${effect.enabled ? "" : "opacity-55"}`}>
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-1 text-fg-3">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-fg-2">
            {effect.name}
          </span>
          <span className="block text-[10.5px] capitalize text-fg-muted">
            {effect.type.replace("-", " ")}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={ArrowUp}
            label="Move effect up"
            size="sm"
            disabled={isFirst}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon={ArrowDown}
            label="Move effect down"
            size="sm"
            disabled={isLast}
            onClick={() => onMove(1)}
          />
          <IconButton
            icon={effect.enabled ? Eye : EyeOff}
            label={effect.enabled ? "Disable effect" : "Enable effect"}
            size="sm"
            active={effect.enabled}
            onClick={() => onToggle(!effect.enabled)}
          />
          <IconButton
            icon={Copy}
            label="Duplicate effect"
            size="sm"
            onClick={onDuplicate}
          />
          <IconButton
            icon={Trash2}
            label="Remove effect"
            size="sm"
            variant="danger"
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="space-y-3 p-3">
        <EffectControls
          effect={effect}
          layer={layer}
          localTime={localTime}
          autoKeyframe={autoKeyframe}
          onUpdate={onUpdate}
          replaceLayer={replaceLayer}
          setSelectedProperty={setSelectedProperty}
        />
      </div>
    </div>
  );
}

function EffectControls({
  effect,
  layer,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const renderParam = (param: MotionEffectParameterName): JSX.Element => (
    <EffectParameterControl
      key={param}
      effect={effect}
      layer={layer}
      param={param}
      localTime={localTime}
      autoKeyframe={autoKeyframe}
      onUpdate={onUpdate}
      replaceLayer={replaceLayer}
      setSelectedProperty={setSelectedProperty}
    />
  );

  if (effect.type === "blur") {
    return renderParam("radius");
  }

  if (effect.type === "drop-shadow") {
    return (
      <>
        <Field label="Color">
          <ColorInput
            value={effect.color}
            onChange={(color) =>
              onUpdate((current) =>
                current.type === "drop-shadow" ? { ...current, color } : current,
              )
            }
          />
        </Field>
        {renderParam("opacity")}
        <div className="grid grid-cols-3 gap-2">
          {renderParam("blur")}
          {renderParam("offsetX")}
          {renderParam("offsetY")}
        </div>
      </>
    );
  }

  if (effect.type === "glow") {
    return (
      <>
        <Field label="Color">
          <ColorInput
            value={effect.color}
            onChange={(color) =>
              onUpdate((current) =>
                current.type === "glow" ? { ...current, color } : current,
              )
            }
          />
        </Field>
        {renderParam("intensity")}
        {renderParam("radius")}
      </>
    );
  }

  if (
    effect.type === "invert" ||
    effect.type === "grayscale" ||
    effect.type === "sepia"
  ) {
    return renderParam("amount");
  }

  if (effect.type === "color-adjust") {
    return (
      <>
        {renderParam("brightness")}
        {renderParam("contrast")}
        {renderParam("saturation")}
        {renderParam("hue")}
      </>
    );
  }

  if (effect.type === "shader") {
    const def = getMotionShaderDef(effect.shaderId);
    if (!def) {
      return (
        <ToolcraftText type="supporting" color="secondary">
          Unknown shader.
        </ToolcraftText>
      );
    }
    return (
      <>
        {def.params.map((paramDef) => (
          <ShaderParameterControl
            key={paramDef.name}
            effect={effect}
            layer={layer}
            paramDef={paramDef}
            localTime={localTime}
            autoKeyframe={autoKeyframe}
            onUpdate={onUpdate}
            replaceLayer={replaceLayer}
            setSelectedProperty={setSelectedProperty}
          />
        ))}
      </>
    );
  }

  if (isMotionExpressionControlEffect(effect)) {
    return (
      <ExpressionControlBody
        effect={effect}
        layer={layer}
        localTime={localTime}
        autoKeyframe={autoKeyframe}
        onUpdate={onUpdate}
        replaceLayer={replaceLayer}
        setSelectedProperty={setSelectedProperty}
        renderParam={renderParam}
      />
    );
  }

  return (
    <>
      {getMotionEffectParameterDescriptors(effect).map((descriptor) =>
        renderParam(descriptor.param),
      )}
    </>
  );
}

function ExpressionControlBody({
  effect,
  layer,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
  renderParam,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
  renderParam: (param: MotionEffectParameterName) => JSX.Element;
}): JSX.Element {
  const usageHint = `effect("${effect.name}")("value")`;
  return (
    <>
      <div className="rounded-md border border-border bg-bg-1 px-2.5 py-2">
        <ToolcraftText as="span" type="label" color="primary" weight="semibold" className="block">
          {effect.name}
        </ToolcraftText>
        <ToolcraftText type="supporting" color="secondary" className="mt-0.5 block text-[11px]">
          use:{" "}
          <span className="font-mono text-fg-2">{usageHint}</span>
        </ToolcraftText>
      </div>
      {effect.type === "checkbox-control" ? (
        <CheckboxControlValue
          effect={effect}
          layer={layer}
          localTime={localTime}
          autoKeyframe={autoKeyframe}
          onUpdate={onUpdate}
          replaceLayer={replaceLayer}
          setSelectedProperty={setSelectedProperty}
        />
      ) : (
        renderParam("value")
      )}
    </>
  );
}

function CheckboxControlValue({
  effect,
  layer,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const descriptor = getMotionEffectParameterDescriptor(effect, "value");
  const property = getMotionEffectKeyframeProperty(effect.id, "value");
  const value = getMotionEffectParameterValueAtTime(
    effect,
    layer.keyframes,
    "value",
    localTime,
    layer.expressions,
    layer.duration,
  );
  const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
    layer,
    property,
    localTime,
  );
  const label = descriptor?.label ?? "Checkbox";

  const writeValue = (nextValue: number) => {
    setSelectedProperty(property);
    if (autoKeyframe) {
      replaceLayer(
        upsertMotionLayerKeyframe(layer, property, localTime, {
          value: nextValue,
          easing: keyframeAtPlayhead?.easing ?? "ease",
        }),
      );
      return;
    }
    onUpdate((current) =>
      current.id === effect.id
        ? setMotionEffectParameterValue(current, "value", nextValue)
        : current,
    );
  };

  return (
    <SwitchInput
      label={label}
      checked={value >= 0.5}
      onChange={(checked) => writeValue(checked ? 1 : 0)}
    />
  );
}

function EffectParameterControl({
  effect,
  layer,
  param,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  param: MotionEffectParameterName;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const descriptor = getMotionEffectParameterDescriptor(effect, param);
  const property = getMotionEffectKeyframeProperty(effect.id, param);
  const value = getMotionEffectParameterValueAtTime(
    effect,
    layer.keyframes,
    param,
    localTime,
    layer.expressions,
    layer.duration,
  );
  const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
    layer,
    property,
    localTime,
  );
  const label = descriptor?.label ?? param;
  const min = descriptor?.min;
  const max = descriptor?.max;
  const step = descriptor?.step ?? 0.01;
  const usesSlider =
    !descriptor?.unit &&
    typeof min === "number" &&
    typeof max === "number" &&
    min >= 0 &&
    max <= 4;

  const writeValue = (nextValue: number) => {
    setSelectedProperty(property);
    if (autoKeyframe) {
      replaceLayer(
        upsertMotionLayerKeyframe(layer, property, localTime, {
          value: nextValue,
          easing: keyframeAtPlayhead?.easing ?? "ease",
        }),
      );
      return;
    }
    onUpdate((current) =>
      current.id === effect.id
        ? setMotionEffectParameterValue(current, param, nextValue)
        : current,
    );
  };

  const toggleKeyframe = () => {
    setSelectedProperty(property);
    if (keyframeAtPlayhead) {
      replaceLayer(removeMotionLayerKeyframe(layer, keyframeAtPlayhead.id));
      return;
    }
    replaceLayer(
      upsertMotionLayerKeyframe(layer, property, localTime, {
        value,
        easing: "ease",
      }),
    );
  };

  return (
    <Field label={label} hint={descriptor?.unit}>
      <div className="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
        {usesSlider ? (
          <Slider
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        ) : (
          <NumberInput
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        )}
        <IconButton
          icon={Diamond}
          label={
            keyframeAtPlayhead
              ? `Remove ${label} keyframe`
              : `Add ${label} keyframe`
          }
          size="sm"
          variant={keyframeAtPlayhead ? "solid" : "ghost"}
          onClick={toggleKeyframe}
        />
      </div>
    </Field>
  );
}

function ShaderParameterControl({
  effect,
  layer,
  paramDef,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  paramDef: MotionShaderParamDef;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const param = paramDef.name;
  const property = getMotionEffectKeyframeProperty(effect.id, param);
  const value = getMotionEffectParameterValueAtTime(
    effect,
    layer.keyframes,
    param,
    localTime,
    layer.expressions,
    layer.duration,
  );
  const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
    layer,
    property,
    localTime,
  );
  const { label, min, max, step } = paramDef;
  const usesSlider = min >= 0 && max <= 4;

  const writeValue = (nextValue: number) => {
    setSelectedProperty(property);
    if (autoKeyframe) {
      replaceLayer(
        upsertMotionLayerKeyframe(layer, property, localTime, {
          value: nextValue,
          easing: keyframeAtPlayhead?.easing ?? "ease",
        }),
      );
      return;
    }
    onUpdate((current) =>
      current.id === effect.id
        ? setMotionEffectParameterValue(current, param, nextValue)
        : current,
    );
  };

  const toggleKeyframe = () => {
    setSelectedProperty(property);
    if (keyframeAtPlayhead) {
      replaceLayer(removeMotionLayerKeyframe(layer, keyframeAtPlayhead.id));
      return;
    }
    replaceLayer(
      upsertMotionLayerKeyframe(layer, property, localTime, {
        value,
        easing: "ease",
      }),
    );
  };

  return (
    <Field label={label}>
      <div className="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
        {usesSlider ? (
          <Slider
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        ) : (
          <NumberInput
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        )}
        <IconButton
          icon={Diamond}
          label={
            keyframeAtPlayhead
              ? `Remove ${label} keyframe`
              : `Add ${label} keyframe`
          }
          size="sm"
          variant={keyframeAtPlayhead ? "solid" : "ghost"}
          onClick={toggleKeyframe}
        />
      </div>
    </Field>
  );
}

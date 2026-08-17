import type { JSX } from "react";
import { useMemo, useState } from "react";
import { Clapperboard, Sparkles } from "@/icons/lucide-compat";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { MOTION_PRESETS, getMotionPresetCategories } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PanelHeader, SegmentedControl } from "./primitives";
import { useTranslation } from "react-i18next";

const CATEGORY_LABELS: Record<string, string> = {
  ads: "Ads",
  "app-ui-demos": "App UI demos",
  "lower-thirds": "Lower thirds",
  "product-shots": "Product shots",
  "social-hooks": "Social hooks",
  "kinetic-typography": "Kinetic typography",
  "logo-reveals": "Logo reveals",
  "end-screens": "End screens",
};

const CATEGORY_GRADIENTS: Record<string, string> = {
  ads: "from-emerald-500/30 via-teal-500/20 to-green-500/30",
  "lower-thirds": "from-emerald-500/30 via-teal-500/20 to-cyan-500/30",
  "logo-reveals": "from-amber-500/30 via-orange-500/20 to-rose-500/30",
  "social-hooks": "from-emerald-500/30 via-lime-500/20 to-orange-500/30",
  "kinetic-typography": "from-sky-500/30 via-teal-500/20 to-emerald-500/30",
  "end-screens": "from-slate-500/30 via-zinc-500/20 to-stone-500/30",
};

const DEFAULT_GRADIENT = "from-accent-soft via-bg-3 to-accent-soft";

export function MotionTemplateBrowser(): JSX.Element {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const createMotionComposition = useProjectStore(
    (state) => state.createMotionComposition,
  );
  const setActiveCompositionId = useMotionStore(
    (state) => state.setActiveCompositionId,
  );

  const categories = useMemo(() => {
    return ["all", ...getMotionPresetCategories()];
  }, []);

  const presets = useMemo(
    () =>
      activeCategory === "all"
        ? MOTION_PRESETS
        : MOTION_PRESETS.filter((preset) => preset.category === activeCategory),
    [activeCategory],
  );

  const applyPreset = async (presetId: string, name: string) => {
    const composition = await createMotionComposition(name, presetId);
    if (composition) setActiveCompositionId(composition.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t("Templates")} icon={Sparkles} />

      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <SegmentedControl
          value={activeCategory}
          options={categories.map((category) => ({
            value: category,
            label: category === "all" ? "All" : CATEGORY_LABELS[category] ?? category,
          }))}
          onChange={setActiveCategory}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 gap-3">
          {presets.map((preset) => (
            <ToolcraftClickableCard
              key={preset.id}
              label={`Apply ${preset.name}`}
              onClick={() => void applyPreset(preset.id, preset.name)}
              variant="muted"
              padding={0}
              className="overflow-hidden"
            >
              <div
                className={`relative flex aspect-video items-center justify-center bg-gradient-to-br ${
                  CATEGORY_GRADIENTS[preset.category] ?? DEFAULT_GRADIENT
                }`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-transform group-hover:scale-110">
                  <Clapperboard size={20} aria-hidden />
                </div>
                <span className="absolute left-2.5 top-2.5 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
                  {CATEGORY_LABELS[preset.category] ?? preset.category}
                </span>
                {preset.variables.length > 0 ? (
                  <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                    {preset.variables.length} {t(" vars")}</span>
                ) : null}
              </div>
              <div className="p-3">
                <ToolcraftText type="body" color="primary" weight="semibold" className="mb-1 block">
                  {preset.name}
                </ToolcraftText>
                <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                  {preset.description}
                </ToolcraftText>
              </div>
            </ToolcraftClickableCard>
          ))}
        </div>
      </div>
    </div>
  );
}

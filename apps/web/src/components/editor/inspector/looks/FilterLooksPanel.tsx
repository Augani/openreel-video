import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import { Button, Card, cn } from "@openreel/ui";
import { Palette } from "@/icons/lucide-compat";
import {
  FILTER_CATEGORIES,
  FILTER_PRESETS,
  getPresetsByCategory,
  type FilterCategory,
  type FilterPreset,
} from "@openreel/core";
import { PropertySlider } from "../shell/PropertySlider";
import { useProjectStore } from "../../../../stores/project-store";
import { useUIStore } from "../../../../stores/ui-store";
import { toast } from "../../../../stores/notification-store";
import {
  applyFilterPreset,
  clearFilterEffects,
  filterPresetEffectsForPreview,
  resolveFilterPreset,
  setFilterPresetIntensity,
  type FilterPresetSelection,
} from "../../../../services/filter-preset-application";
import { EffectPreviewProvider, effectPreviewsSupported } from "../../panels/effect-previews/EffectLivePreview";
import type { PreviewEffectDef } from "../../panels/effect-previews/preview-engine";
import { LookCard } from "./LookCard";
import { currentLookDef, gradeSignature, hasGrade, memoLookDef, settingsToClipGrading } from "./look-defs";
import { useClipLookScene } from "./useClipLookScene";
import type { ColorGradingSettings } from "../../../../bridges/effects-bridge";
import { presetSummary } from "./look-labels";

/**
 * The card renders what `applyFilterPreset` leaves on the clip: the preset's effects (the very units and order it
 * writes) in place of the clip's effect chain, which applying replaces, under the clip's grade, which applying keeps.
 */
function previewDefFor(preset: FilterPreset, current: ColorGradingSettings): PreviewEffectDef {
  const grading = settingsToClipGrading(current);
  const graded = hasGrade(grading);
  const id = `look-${preset.id}-${graded ? gradeSignature(current) : "ungraded"}`;
  return memoLookDef(id, () => ({
    id,
    kind: "look",
    type: "filter-preset",
    effects: filterPresetEffectsForPreview(preset),
    ...(graded ? { grading } : {}),
  }));
}

interface FilterLooksPanelProps {
  clipId?: string;
  /** Inside the Color tab's "Looks and LUTs" section: no own header, and the section owns the preview engine. */
  embedded?: boolean;
  /** Split every card into the clip as it is now (left) and with the look applied (right). */
  compare?: boolean;
}

const Panel: React.FC<FilterLooksPanelProps> = ({ clipId, embedded = false, compare = false }) => {
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());
  const project = useProjectStore((state) => state.project);

  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>("cinematic");
  const [selection, setSelection] = useState<(FilterPresetSelection & { scope: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const changingPreset = useRef(false);

  const targetClipId = clipId || selectedClipIds[0];
  const targetTrack = project.timeline.tracks.find((track) => track.clips.some((clip) => clip.id === targetClipId));
  const targetClip = targetTrack?.clips.find((clip) => clip.id === targetClipId);
  const mediaType = project.mediaLibrary.items.find((item) => item.id === targetClip?.mediaId)?.type;
  const scope = `${project.id}:${targetClipId}`;
  const scene = useClipLookScene(targetClipId);
  const before = useMemo(() => (compare ? currentLookDef(scene.effects, scene.grading) : null), [compare, scene]);
  const applied = useMemo(
    () =>
      targetClip
        ? resolveFilterPreset(
            targetClip.effects.map((effect, order) => ({
              ...effect,
              type: effect.type as FilterPreset["effects"][number]["type"],
              order,
            })),
            selection?.scope === scope ? selection : null,
          )
        : null,
    [targetClip, selection, scope],
  );
  const presets = useMemo(() => getPresetsByCategory(selectedCategory), [selectedCategory]);
  const tabId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleTabKey = useCallback((event: React.KeyboardEvent, index: number) => {
    const count = FILTER_CATEGORIES.length;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    setSelectedCategory(FILTER_CATEGORIES[next].id as FilterCategory);
    tabRefs.current[next]?.focus();
  }, []);

  const handleApplyPreset = useCallback(
    async (preset: FilterPreset) => {
      if (!targetClipId || changingPreset.current) return;
      changingPreset.current = true;
      setBusy(true);
      try {
        const result = await applyFilterPreset(project.id, targetClipId, preset);
        setSelection({ ...result, scope });
        toast.success("Filter Applied", `${preset.name} preset applied`);
      } catch (error) {
        toast.error("Filter not applied", error instanceof Error ? error.message : "Please try again.");
      } finally {
        changingPreset.current = false;
        setBusy(false);
      }
    },
    [targetClipId, project.id, scope],
  );

  const handleClearEffects = useCallback(async () => {
    if (!targetClipId || changingPreset.current) return;
    changingPreset.current = true;
    setBusy(true);
    try {
      await clearFilterEffects(project.id, targetClipId);
      setSelection(null);
      toast.info("Effects Cleared");
    } catch (error) {
      toast.error("Effects not removed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      changingPreset.current = false;
      setBusy(false);
    }
  }, [targetClipId, project.id]);

  const handleIntensity = useCallback(
    async (value: number) => {
      if (!targetClipId || !applied || changingPreset.current) return;
      try {
        await setFilterPresetIntensity(project.id, targetClipId, applied, value);
      } catch (error) {
        toast.error("Filter intensity not changed", error instanceof Error ? error.message : "Please try again.");
      }
    },
    [targetClipId, project.id, applied],
  );

  if (!targetClip || (mediaType !== "video" && mediaType !== "image")) {
    return (
      <div className="p-4 text-center">
        <Palette size={24} className="mx-auto mb-2 text-fg-3" />
        <span className="text-[12px] leading-5 text-fg-2 font-normal">Select a video or image clip to apply filters</span>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="filter-looks-panel">
      {embedded ? null : (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-2">
          <Palette size={16} className="text-primary" />
          <div className="flex flex-col gap-0.5">
            <span className="block text-[12px] font-medium leading-5 text-fg">Looks</span>
            <span className="block text-[9px] font-normal text-fg-2">One-click color grades, shown on your footage</span>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Look categories" className="flex flex-wrap gap-1">
        {FILTER_CATEGORIES.map((category, index) => {
          const active = selectedCategory === category.id;
          return (
            <button
              key={category.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${tabId}-tab-${category.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${tabId}-panel`}
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => handleTabKey(event, index)}
              onClick={() => setSelectedCategory(category.id as FilterCategory)}
              className={cn(
                "h-7 shrink-0 whitespace-nowrap rounded-[7px] px-2.5 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-accent text-accent-fg" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg",
              )}
            >
              {category.name}
            </button>
          );
        })}
      </div>

      <div
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-tab-${selectedCategory}`}
        className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-0.5"
      >
        {presets.map((preset) => (
          <LookCard
            key={preset.id}
            def={previewDefFor(preset, scene.grading)}
            before={before}
            label={preset.name}
            detail={presetSummary(preset)}
            ariaLabel={`Apply ${preset.name} filter preset`}
            applied={applied?.presetId === preset.id}
            disabled={busy || !!targetTrack?.locked}
            onApply={() => void handleApplyPreset(preset)}
          />
        ))}
      </div>

      {applied && (
        <Card className="min-w-0 space-y-3 rounded-[7px] border border-transparent bg-bg-2 p-3 text-fg shadow-none">
          <PropertySlider
            label="Intensity"
            min={0}
            max={100}
            step={1}
            value={applied.intensity}
            onChange={handleIntensity}
            isDisabled={busy || !!targetTrack?.locked}
            formatValue={(value) => `${value}%`}
          />
          <Button
            onClick={handleClearEffects}
            disabled={busy || !!targetTrack?.locked}
            type="button"
            aria-label="Remove All Effects"
            className="inline-flex h-7 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-[10px] font-semibold text-red-400 outline-none transition-colors hover:bg-status-error/90 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="truncate">Remove All Effects</span>
          </Button>
        </Card>
      )}

      <span className="block text-center text-[9px] font-normal text-fg-2">
        {FILTER_PRESETS.length} looks in {FILTER_CATEGORIES.length} categories
      </span>
    </div>
  );
};

/** Filter presets as a grid of real-footage previews. Owns a preview engine unless embedded in a section that does. */
export const FilterLooksPanel: React.FC<FilterLooksPanelProps> = (props) =>
  props.embedded || !effectPreviewsSupported() ? (
    <Panel {...props} />
  ) : (
    <EffectPreviewProvider>
      <Panel {...props} />
    </EffectPreviewProvider>
  );

export default FilterLooksPanel;

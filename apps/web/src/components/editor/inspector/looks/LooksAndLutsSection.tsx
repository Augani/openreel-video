import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Download, Trash2, Upload } from "@/icons/lucide-compat";
import {
  createLutEntry,
  lutToJson,
  parseCubeToLutData,
  type ClipColorGrading,
  type LUTData,
  type LutLibraryEntry,
  type SavedLook,
} from "@openreel/core";
import { useProjectStore } from "../../../../stores/project-store";
import { useUIStore } from "../../../../stores/ui-store";
import { useColorLibraryStore } from "../../../../stores/color-library-store";
import { toast } from "../../../../stores/notification-store";
import { removeClipLut } from "../../../../services/editor-effect-application";
import {
  applyLookToClips,
  applyLutEntryToClips,
  cubeTextFor,
  downloadCube,
  saveLookFromClip,
  type LutSlot,
} from "../../../../services/color-library-service";
import type { PreviewEffectDef } from "../../panels/effect-previews/preview-engine";
import { LUTLoader, parse3dlLUT } from "../LUTLoader";
import { currentLookDef, effectsSignature, gradeSignature, memoLookDef, mergedPreviewGrading, type PreviewClipEffect } from "./look-defs";
import { useClipLookScene } from "./useClipLookScene";
import { PropertySlider } from "../shell/PropertySlider";
import FilterLooksPanel from "./FilterLooksPanel";
import type { ColorGradingSettings } from "../../../../bridges/effects-bridge";
import { LookCard, lookIconButton } from "./LookCard";
import { CompareToggle, useLookCompare } from "./compare-context";
import CameraInputPicker from "./CameraInputPicker";

/** Clips an apply action targets: the timeline selection, or the inspected clip. */
function targetClipIds(clipId: string): string[] {
  const selected = useUIStore.getState().getSelectedClipIds();
  return selected.length > 0 ? selected : [clipId];
}

/**
 * A LUT card renders what "apply as creative LUT" produces on this clip: the clip's own effects, then its grade with
 * the table (at the strength apply will use) in the creative slot.
 */
function lutDef(entry: LutLibraryEntry, current: ColorGradingSettings, clipEffects: ReadonlyArray<PreviewClipEffect>, intensity: number | undefined): PreviewEffectDef {
  const id = `look-lut-${entry.id}-${gradeSignature(current)}-${effectsSignature(clipEffects)}-${intensity ?? "lib"}`;
  return memoLookDef(id, () => ({
    id,
    kind: "look",
    type: "lut-look",
    ...(clipEffects.length > 0 ? { effects: clipEffects } : {}),
    grading: mergedPreviewGrading(current, { lut: { ...entry.lut, intensity: intensity ?? entry.lut.intensity } }),
  }));
}

/**
 * A saved look replaces the clip's whole grade when applied, so its card renders the stored grade alone, after the
 * clip's own effects (which a look leaves untouched).
 */
function savedLookDef(look: SavedLook, clipEffects: ReadonlyArray<PreviewClipEffect>): PreviewEffectDef {
  const id = `look-saved-${look.id}-${effectsSignature(clipEffects)}`;
  return memoLookDef(id, () => ({
    id,
    kind: "look",
    type: "saved-look",
    ...(clipEffects.length > 0 ? { effects: clipEffects } : {}),
    grading: look.grading as ClipColorGrading,
  }));
}

/** Same table? Cheap check (size, length, sampled values): marks the LUT card the clip actually uses. */
export function sameLut(a: { size: number; data: ArrayLike<number> } | undefined, b: { size: number; data: ArrayLike<number> } | undefined): boolean {
  if (!a || !b || a.size !== b.size || a.data.length !== b.data.length) return false;
  const step = Math.max(1, Math.floor(a.data.length / 64));
  for (let i = 0; i < a.data.length; i += step) if (a.data[i] !== b.data[i]) return false;
  return true;
}

const sectionTitle = "text-[10px] font-semibold uppercase tracking-wide text-fg-3";

interface Props {
  clipId: string;
}

/** One place for built-in looks, imported LUTs and saved looks, each shown graded on the footage. */
const LooksAndLuts: React.FC<Props> = ({ clipId }) => {
  const updateColorGrading = useProjectStore((s) => s.updateColorGrading);
  const luts = useColorLibraryStore((s) => s.luts);
  const looks = useColorLibraryStore((s) => s.looks);
  const refresh = useColorLibraryStore((s) => s.refresh);
  const [lookName, setLookName] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  // Strength the creative LUT cards preview and apply at. null: each LUT's own library strength.
  const [lutStrength, setLutStrength] = useState<number | null>(null);
  const { compare } = useLookCompare();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const scene = useClipLookScene(clipId);
  const grading = scene.grading;
  const lutIntensity = lutStrength === null ? undefined : lutStrength / 100;
  const before = useMemo(() => (compare ? currentLookDef(scene.effects, scene.grading) : null), [compare, scene]);

  const keepImported = useCallback(async (name: string, lut: LUTData) => {
    const store = useColorLibraryStore.getState();
    await store.refresh();
    const json = lutToJson(lut);
    const size = json.curve1d ? json.curve1d.size : json.size;
    const dup = useColorLibraryStore.getState().luts.some((l) => l.name === name && l.size === size);
    if (!dup) await store.addLut(createLutEntry(name, json));
  }, []);

  const handleClipLut = useCallback(
    (lut: LUTData | null) => {
      if (lut) {
        void updateColorGrading(clipId, { lut });
      } else {
        void removeClipLut(clipId).then((removed) => {
          if (!removed) toast.error("LUT could not be removed", "Unlock the clip's track and try again.");
        });
      }
    },
    [clipId, updateColorGrading],
  );

  const handleInputLut = useCallback(
    (lut: LUTData | null) => {
      void updateColorGrading(clipId, { inputLut: lut ?? undefined });
    },
    [clipId, updateColorGrading],
  );

  const handleImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      for (const file of files) {
        try {
          const text = await file.text();
          const ext = file.name.toLowerCase().split(".").pop();
          const lut = ext === "cube" ? parseCubeToLutData(text) : ext === "3dl" ? parse3dlLUT(text) : null;
          if (!lut) throw new Error("Use .cube or .3dl files.");
          await keepImported(file.name.replace(/\.[^.]+$/, ""), lut);
        } catch (error) {
          toast.error(`${file.name} was not imported`, error instanceof Error ? error.message : "Invalid LUT file");
        }
      }
    },
    [keepImported],
  );

  const exportSlot = useCallback(
    (slot: LutSlot) => {
      const lut = slot === "input" ? grading.inputLut : grading.lut;
      if (!lut) return;
      downloadCube(`${slot}-lut.cube`, cubeTextFor(lutToJson(lut), `${slot}-lut`));
    },
    [grading.inputLut, grading.lut],
  );

  const applyLut = useCallback(
    async (entry: LutLibraryEntry, slot: LutSlot) => {
      // Strength is the creative LUT's blend; the input transform always runs at full strength.
      const changed = await applyLutEntryToClips(entry, targetClipIds(clipId), slot, slot === "creative" ? lutIntensity : undefined);
      toast.success(`${slot === "input" ? "Input" : "Creative"} LUT applied`, `${entry.name} on ${changed.length} clip(s)`);
    },
    [clipId, lutIntensity],
  );

  const saveLook = useCallback(async () => {
    try {
      const look = await saveLookFromClip(clipId, lookName);
      await useColorLibraryStore.getState().refresh();
      setLookName("");
      toast.success("Look saved", look.name);
    } catch (error) {
      toast.error("Look not saved", error instanceof Error ? error.message : "Unknown error");
    }
  }, [clipId, lookName]);

  const applyLook = useCallback(
    async (look: SavedLook) => {
      const changed = await applyLookToClips(look, targetClipIds(clipId));
      toast.success("Look applied", `${look.name} on ${changed.length} clip(s)`);
    },
    [clipId],
  );

  return (
    <div className="space-y-4" data-testid="looks-and-luts">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className={sectionTitle}>Looks</div>
          <CompareToggle testId="looks-compare" />
        </div>
        <FilterLooksPanel clipId={clipId} embedded compare={compare} />
      </div>

      <div className="space-y-2" data-testid="lut-library">
        <div className="flex items-center justify-between gap-2">
          <div className={sectionTitle}>LUTs</div>
          <div className="flex shrink-0 items-center gap-1">
            <CompareToggle testId="lut-compare" />
            <button type="button" className={`${lookIconButton} !bg-bg-1 border border-border !text-fg-2 hover:!text-fg`} title="Import LUTs (.cube, .3dl)" aria-label="Import LUTs to library" onClick={() => importRef.current?.click()}>
              <Upload size={12} aria-hidden />
            </button>
            <button type="button" className={`${lookIconButton} !bg-bg-1 border border-border !text-fg-2 hover:!text-fg disabled:opacity-40`} title="Export the clip's LUT as .cube" aria-label="Export creative LUT as .cube" disabled={!grading.lut} onClick={() => exportSlot("creative")}>
              <Download size={12} aria-hidden />
            </button>
            <button type="button" className={`${lookIconButton} !bg-bg-1 border border-border !text-fg-2 hover:!text-fg disabled:opacity-40`} title="Export the clip's input LUT as .cube" aria-label="Export input LUT as .cube" disabled={!grading.inputLut} onClick={() => exportSlot("input")}>
              <Download size={12} aria-hidden />
              <span className="ml-0.5">In</span>
            </button>
          </div>
        </div>
        <input ref={importRef} type="file" multiple accept=".cube,.3dl" className="hidden" aria-label="Import LUT files" onChange={(e) => void handleImport(e)} />
        {luts.length > 0 && (Object.keys(grading).length > 0 || scene.effects.length > 0) ? (
          <div className="text-[9px] leading-snug text-fg-3" data-testid="lut-preview-note">
            Previews show each LUT on top of this clip's current effects and grade.
          </div>
        ) : null}
        {luts.length > 0 ? (
          <div data-testid="lut-strength">
            <PropertySlider
              label="LUT strength"
              min={0}
              max={100}
              step={1}
              value={lutStrength ?? 100}
              onChange={(value: number) => setLutStrength(value)}
              formatValue={(value: number) => `${value}%`}
            />
          </div>
        ) : null}
        {luts.length === 0 ? (
          <div className="rounded-[7px] border border-dashed border-border px-3 py-3 text-center text-[10px] leading-snug text-fg-3">
            No LUTs yet. Import a .cube or .3dl file and it is kept here for every project, previewed on your footage.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {luts.map((l) => (
              <LookCard
                key={l.id}
                def={lutDef(l, grading, scene.effects, lutIntensity)}
                before={before}
                label={l.name}
                detail={l.kind === "1d" ? `1D curve, ${l.size} points` : `3D LUT, ${l.size}³`}
                ariaLabel={`Apply ${l.name} as creative LUT`}
                applied={sameLut(grading.lut as LUTData | undefined, l.lut as unknown as LUTData)}
                onApply={() => void applyLut(l, "creative")}
                actions={
                  <>
                    <button type="button" className={lookIconButton} title={`Use ${l.name} as the Input LUT (camera log to working space)`} aria-label={`Apply ${l.name} as input LUT`} onClick={() => void applyLut(l, "input")}>
                      Input
                    </button>
                    <button type="button" className={lookIconButton} title={`Delete ${l.name} from the library`} aria-label={`Delete ${l.name} from library`} onClick={() => void useColorLibraryStore.getState().removeLut(l.id)}>
                      <Trash2 size={11} aria-hidden />
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
        {grading.lut ? (
          <LUTLoader lutData={grading.lut as LUTData | null} onChange={handleClipLut} onImported={(name, lut) => void keepImported(name, lut)} />
        ) : null}
      </div>

      <div className="space-y-2" data-testid="saved-looks">
        <div className="flex items-center justify-between gap-2">
          <div className={sectionTitle}>Saved looks</div>
          <CompareToggle testId="saved-compare" />
        </div>
        <div className="flex gap-1">
          <input
            value={lookName}
            onChange={(e) => setLookName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveLook();
            }}
            placeholder="Name this clip's grade"
            aria-label="Look name"
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-border bg-bg-1 px-2 text-[11px] text-fg"
          />
          <button type="button" className={`${lookIconButton} !h-7 !px-2 !bg-bg-1 border border-border !text-fg-2 hover:!text-fg disabled:opacity-40`} title="Save this clip's whole grade as a look" aria-label="Save grade as look" disabled={!lookName.trim()} onClick={() => void saveLook()}>
            <Bookmark size={12} aria-hidden />
            <span className="ml-1">Save</span>
          </button>
        </div>
        {looks.length === 0 ? (
          <div className="rounded-[7px] border border-dashed border-border px-3 py-3 text-center text-[10px] leading-snug text-fg-3">
            Grade a clip, name the grade and save it. Saved looks appear here on your footage and apply to the selected clips.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {looks.map((l) => (
              <LookCard
                key={l.id}
                def={savedLookDef(l, scene.effects)}
                before={before}
                label={l.name}
                detail="Saved look"
                ariaLabel={`Apply look ${l.name} to selected clips`}
                onApply={() => void applyLook(l)}
                actions={
                  <button type="button" className={lookIconButton} title={`Delete look ${l.name}`} aria-label={`Delete look ${l.name}`} onClick={() => void useColorLibraryStore.getState().removeLook(l.id)}>
                    <Trash2 size={11} aria-hidden />
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>

      <CameraInputPicker clipId={clipId} />

      <div className="space-y-2">
        <div className={sectionTitle}>Input LUT</div>
        <div className="text-[9px] leading-snug text-fg-3">
          Applied to the source before the whole grade (camera log to working space). The creative LUT stays separate.
        </div>
        <LUTLoader slotName="Input" lutData={(grading.inputLut as LUTData | undefined) ?? null} onChange={handleInputLut} onImported={(name, lut) => void keepImported(name, lut)} />
      </div>
    </div>
  );
};

export default LooksAndLuts;

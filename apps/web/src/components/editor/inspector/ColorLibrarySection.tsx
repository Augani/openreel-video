import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@openreel/ui";
import { parseCubeToLutData, lutToJson, createLutEntry, type LUTData } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useColorLibraryStore } from "../../../stores/color-library-store";
import { toast } from "../../../stores/notification-store";
import {
  applyLookToClips,
  applyLutEntryToClips,
  cubeTextFor,
  downloadCube,
  saveLookFromClip,
  type LutSlot,
} from "../../../services/color-library-service";
import { LUTLoader, parse3dlLUT } from "./LUTLoader";

const rowBtn =
  "h-6 rounded-[6px] px-2 text-[10px] font-medium bg-bg-1 border border-border text-fg-2 hover:text-fg";

/** Clips an apply action targets: the timeline selection, or the inspected clip. */
function targetClipIds(clipId: string): string[] {
  const selected = useUIStore.getState().getSelectedClipIds();
  return selected.length > 0 ? selected : [clipId];
}

interface Props {
  clipId: string;
}

/** Input LUT slot, per-user LUT library with .cube export, and saved looks. */
export const ColorLibrarySection: React.FC<Props> = ({ clipId }) => {
  const modifiedAt = useProjectStore((s) => s.project.modifiedAt);
  const updateColorGrading = useProjectStore((s) => s.updateColorGrading);
  const getColorGrading = useProjectStore((s) => s.getColorGrading);
  const luts = useColorLibraryStore((s) => s.luts);
  const looks = useColorLibraryStore((s) => s.looks);
  const refresh = useColorLibraryStore((s) => s.refresh);
  const [lookName, setLookName] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grading = React.useMemo(() => getColorGrading(clipId), [clipId, getColorGrading, modifiedAt]);

  const keepImported = useCallback(async (name: string, lut: LUTData) => {
    const store = useColorLibraryStore.getState();
    await store.refresh();
    const json = lutToJson(lut);
    const dup = useColorLibraryStore
      .getState()
      .luts.some((l) => l.name === name && l.size === (json.curve1d ? json.curve1d.size : json.size));
    if (!dup) await store.addLut(createLutEntry(name, json));
  }, []);

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
      const json = lutToJson(lut);
      downloadCube(`${slot}-lut.cube`, cubeTextFor(json, `${slot}-lut`));
    },
    [grading.inputLut, grading.lut],
  );

  const applyLut = useCallback(
    async (id: string, slot: LutSlot) => {
      const entry = luts.find((l) => l.id === id);
      if (!entry) return;
      const changed = await applyLutEntryToClips(entry, targetClipIds(clipId), slot);
      toast.success(`${slot === "input" ? "Input" : "Creative"} LUT applied`, `${entry.name} on ${changed.length} clip(s)`);
    },
    [clipId, luts],
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
    async (id: string) => {
      const look = looks.find((l) => l.id === id);
      if (!look) return;
      const changed = await applyLookToClips(look, targetClipIds(clipId));
      toast.success("Look applied", `${look.name} on ${changed.length} clip(s)`);
    },
    [clipId, looks],
  );

  return (
    <div className="space-y-4" data-testid="color-library-section">
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">Input LUT</div>
        <div className="text-[9px] leading-snug text-fg-3">
          Applied to the source before the whole grade (camera log to working space). The creative LUT below stays separate.
        </div>
        <LUTLoader
          slotName="Input"
          lutData={(grading.inputLut as LUTData | undefined) ?? null}
          onChange={handleInputLut}
          onImported={(name, lut) => void keepImported(name, lut)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">LUT library</div>
          <div className="flex gap-1">
            <Button type="button" className={rowBtn} onClick={() => importRef.current?.click()} aria-label="Import LUTs to library">
              Import
            </Button>
            <Button type="button" className={rowBtn} disabled={!grading.lut} onClick={() => exportSlot("creative")} aria-label="Export creative LUT as .cube">
              Export LUT
            </Button>
            <Button type="button" className={rowBtn} disabled={!grading.inputLut} onClick={() => exportSlot("input")} aria-label="Export input LUT as .cube">
              Export input
            </Button>
          </div>
        </div>
        <input ref={importRef} type="file" multiple accept=".cube,.3dl" className="hidden" aria-label="Import LUT files" onChange={(e) => void handleImport(e)} />
        {luts.length === 0 ? (
          <div className="text-[10px] text-fg-3">Imported LUTs are kept here for every project.</div>
        ) : (
          <ul className="space-y-1">
            {luts.map((l) => (
              <li key={l.id} className="flex items-center gap-1 rounded-[6px] bg-bg-1 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={l.name}>
                  {l.name}
                  <span className="ml-1 text-[9px] text-fg-3">{l.kind === "1d" ? `1D ${l.size}` : `${l.size}³`}</span>
                </span>
                <Button type="button" className={rowBtn} onClick={() => void applyLut(l.id, "creative")} aria-label={`Apply ${l.name} as creative LUT`}>
                  Creative
                </Button>
                <Button type="button" className={rowBtn} onClick={() => void applyLut(l.id, "input")} aria-label={`Apply ${l.name} as input LUT`}>
                  Input
                </Button>
                <Button type="button" className={rowBtn} onClick={() => void useColorLibraryStore.getState().removeLut(l.id)} aria-label={`Delete ${l.name} from library`}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-3">Saved looks</div>
        <div className="flex gap-1">
          <input
            value={lookName}
            onChange={(e) => setLookName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveLook();
            }}
            placeholder="Look name"
            aria-label="Look name"
            className="h-6 min-w-0 flex-1 rounded-[6px] border border-border bg-bg-1 px-2 text-[11px] text-fg"
          />
          <Button type="button" className={rowBtn} disabled={!lookName.trim()} onClick={() => void saveLook()} aria-label="Save grade as look">
            Save look
          </Button>
        </div>
        {looks.length === 0 ? (
          <div className="text-[10px] text-fg-3">Save this clip's whole grade, then apply it to the selected clips.</div>
        ) : (
          <ul className="space-y-1">
            {looks.map((l) => (
              <li key={l.id} className="flex items-center gap-1 rounded-[6px] bg-bg-1 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={l.name}>
                  {l.name}
                </span>
                <Button type="button" className={rowBtn} onClick={() => void applyLook(l.id)} aria-label={`Apply look ${l.name} to selected clips`}>
                  Apply
                </Button>
                <Button type="button" className={rowBtn} onClick={() => void useColorLibraryStore.getState().removeLook(l.id)} aria-label={`Delete look ${l.name}`}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

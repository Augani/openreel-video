import React, { useMemo } from "react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@openreel/ui";
import { effectiveSourceColor } from "@openreel/core/color/source-color";
import {
  SEQUENCE_COLOR_SPACES,
  resolveSequenceColorSpace,
  sequenceColorSpacePatch,
  suggestSequenceColorSpace,
  type SequenceColorSpace,
} from "@openreel/core/color/sequence-color";
import { useProjectStore } from "../../../stores/project-store";

type Choice = SequenceColorSpace | "rec2020";

const CHOICES: ReadonlyArray<{ value: Choice; label: string }> = [
  SEQUENCE_COLOR_SPACES[0],
  { value: "rec2020", label: "Rec.2020 (wide gamut SDR)" },
  SEQUENCE_COLOR_SPACES[1],
  SEQUENCE_COLOR_SPACES[2],
];

/**
 * Preview options > Sequence color space: Rec.709 (default), Rec.2020, Rec.2100 PQ or Rec.2100 HLG. One undoable
 * `project/updateSettings`. Detected HDR footage (PQ / HLG tags read from the container) offers its matching space.
 */
export const SequenceColorSpaceMenu: React.FC = () => {
  const settings = useProjectStore((s) => s.project.settings);
  const items = useProjectStore((s) => s.project.mediaLibrary.items);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const sequence = resolveSequenceColorSpace(settings);
  const current: Choice = sequence !== "rec709" ? sequence : settings.workingColorSpace === "rec2020" ? "rec2020" : "rec709";
  const suggestion = useMemo(
    () => suggestSequenceColorSpace(items.filter((i) => i.type === "video" || i.type === "image").map((i) => effectiveSourceColor(i))),
    [items],
  );
  const select = (value: Choice): void => {
    void updateSettings(value === "rec2020" ? { workingColorSpace: "rec2020", sequenceColorSpace: undefined } : sequenceColorSpacePatch(value));
  };
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="sequence-color-space-trigger">Sequence color space</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {CHOICES.map(({ value, label }) => (
          <DropdownMenuCheckboxItem key={value} data-testid={`sequence-color-space-${value}`} checked={current === value} onCheckedChange={() => select(value)}>
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        {suggestion && sequence === "rec709" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem data-testid="sequence-color-space-suggest" checked={false} onCheckedChange={() => select(suggestion)}>
              HDR footage detected: switch to {suggestion === "rec2100pq" ? "Rec.2100 PQ" : "Rec.2100 HLG"}
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="max-w-[260px] whitespace-normal text-[10px] font-normal leading-snug">
          Rec.2020 and Rec.2100 switch to the HDR working mode: compositing and grading run in half-float scene-linear Rec.2020 (highlights above SDR
          white are kept). The preview shows a tone-mapped SDR view, scopes read in nits, and the export defaults to the sequence transfer (HEVC Main10
          or ProRes, tagged BT.2020 with PQ or HLG).
        </DropdownMenuLabel>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

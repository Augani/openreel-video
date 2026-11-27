import React, { useState } from "react";
import { Button, Input, Label } from "@openreel/ui";
import { readBwfPrefs, writeBwfPrefs, type BwfPrefs } from "../../services/export-bwf-prefs";
import { useT } from "@openreel/i18n/react";

interface ExportBwfSectionProps {
  /** Starts the audio-only Broadcast WAV export with the saved fields. */
  onExport: () => void;
}

/**
 * Audio-only Broadcast WAV (BWF) delivery: the `bext` description (256 bytes) and originator (32 bytes) of the file.
 * The time reference comes from the sequence start timecode. Files over 4 GB are written as RF64.
 */
export const ExportBwfSection: React.FC<ExportBwfSectionProps> = ({ onExport }) => {
  const t = useT();
  const [prefs, setPrefs] = useState<BwfPrefs>(() => readBwfPrefs());
  const update = (patch: Partial<BwfPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeBwfPrefs(next);
  };
  return (
    <section className="mt-3 space-y-2 rounded-md border border-border bg-bg-2 px-3 py-2" data-testid="export-bwf">
      <div>
        <p className="text-[12px] font-semibold text-fg">{t("Broadcast WAV (audio only)")}</p>
        <p className="text-[10px] text-fg-muted">
          24-bit WAV with bext time reference from the sequence start timecode and iXML track names. Files over 4 GB are written as RF64.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="export-bwf-description" className="text-[11px] text-fg-2">{t("Description")}</Label>
          <Input
            id="export-bwf-description"
            data-testid="export-bwf-description"
            className="h-8 text-xs"
            maxLength={256}
            placeholder={t("Project name")}
            value={prefs.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="export-bwf-originator" className="text-[11px] text-fg-2">{t("Originator")}</Label>
          <Input
            id="export-bwf-originator"
            data-testid="export-bwf-originator"
            className="h-8 text-xs"
            maxLength={32}
            placeholder="OpenReel"
            value={prefs.originator}
            onChange={(e) => update({ originator: e.target.value })}
          />
        </div>
      </div>
      <Button type="button" size="sm" variant="outline" data-testid="export-bwf-run" onClick={onExport}>
        {t("Export Broadcast WAV")}
      </Button>
    </section>
  );
};

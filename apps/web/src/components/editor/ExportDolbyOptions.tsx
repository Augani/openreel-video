import React from "react";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import {
  DEFAULT_DIALNORM,
  DIALNORM_MAX,
  DIALNORM_MIN,
  DOLBY_BITRATES,
  DOLBY_LABEL,
  clampDialnorm,
  clampDolbyBitrate,
  isDolbyFormat,
  type AudioExportSettings,
} from "@openreel/core";

interface ExportDolbyOptionsProps {
  audio: AudioExportSettings;
  onChange: (next: AudioExportSettings) => void;
  /** The delivered audio is 5.1 (a 5.1 sequence with the 5.1 channel choice). */
  surround: boolean;
}

/**
 * Bitrate and dialogue-level controls of an AC-3 / E-AC-3 delivery (Export > Audio). Renders nothing for other
 * audio formats. 5.1 is raised to 384 kbps by the export (see resolveSequenceAudioSettings), which the list shows.
 */
export function ExportDolbyOptions({ audio, onChange, surround }: ExportDolbyOptionsProps): React.ReactElement | null {
  if (!isDolbyFormat(audio.format)) return null;
  const codec = audio.format;
  const floor = surround ? 384 : 0;
  const options = DOLBY_BITRATES[codec].filter((kbps) => kbps >= floor);
  const bitrate = String(Math.max(floor, clampDolbyBitrate(codec, audio.bitrate)));
  return (
    <>
      <div className="space-y-1.5" data-testid="export-dolby-bitrate">
        <Label htmlFor="export-dolby-bitrate-select" className="text-[11px] text-fg-2">
          {DOLBY_LABEL[codec]} bitrate
        </Label>
        <Select value={bitrate} onValueChange={(value) => onChange({ ...audio, bitrate: Number(value) })}>
          <SelectTrigger id="export-dolby-bitrate-select" className="h-8 w-full text-xs" data-testid="export-dolby-bitrate-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((kbps) => (
              <SelectItem key={kbps} value={String(kbps)} className="text-xs">
                {kbps} kbps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5" data-testid="export-dolby-dialnorm">
        <Label htmlFor="export-dolby-dialnorm-input" className="text-[11px] text-fg-2">
          Dialogue level (dialnorm, dB)
        </Label>
        <Input
          id="export-dolby-dialnorm-input"
          data-testid="export-dolby-dialnorm-input"
          type="number"
          inputMode="numeric"
          min={DIALNORM_MIN}
          max={DIALNORM_MAX}
          step={1}
          className="h-8 text-xs"
          placeholder={`Auto (${DEFAULT_DIALNORM})`}
          value={audio.dialnorm ?? ""}
          onChange={(event) => {
            const raw = event.target.value.trim();
            if (raw === "") {
              const { dialnorm: _unused, ...rest } = audio;
              void _unused;
              onChange(rest);
              return;
            }
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) onChange({ ...audio, dialnorm: clampDialnorm(parsed) });
          }}
        />
        <p className="text-[10px] text-fg-muted">
          Metadata the player uses to level the programme. Auto writes the loudness target when normalising, else {DEFAULT_DIALNORM} (no change).
        </p>
      </div>
    </>
  );
}

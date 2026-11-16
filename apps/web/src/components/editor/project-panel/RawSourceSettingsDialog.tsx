import React from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@openreel/ui";
import {
  EXPOSURE_LIMIT,
  RAW_DEMOSAIC_QUALITIES,
  RAW_OUTPUT_COLOR_SPACES,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  TINT_LIMIT,
  getRawDeveloper,
  isRawDemosaicQuality,
  isRawOutputColorSpace,
  normalizeRawSettings,
  rawFormatForFile,
  rawSettingsEqual,
  type MediaItem,
  type RawSourceSettings,
} from "@openreel/core";
import { runOrganize, setRawSourceSettings } from "../../../services/project-panel-commands";

/**
 * RAW Source Settings: white balance (temperature / tint), exposure, highlight
 * recovery, demosaic quality and output colour space of a camera RAW still.
 *
 * The preview here is developed from the draft values while you drag; nothing
 * in the project changes until Apply, which commits ALL the edits as ONE
 * undoable step. Preview and export develop from the stored settings with the
 * same function, so they render identically.
 */

const PREVIEW_EDGE = 640;

interface RowProps {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (v: number) => string;
  readonly onChange: (v: number) => void;
}

const SliderRow: React.FC<RowProps> = ({ id, label, value, min, max, step, format, onChange }) => (
  <div className="grid grid-cols-[110px_1fr_64px] items-center gap-2 text-xs">
    <label htmlFor={`raw-${id}`} className="text-fg-2">{label}</label>
    <input
      id={`raw-${id}`}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      data-testid={`raw-${id}`}
      aria-label={label}
    />
    <output className="text-right tabular-nums text-fg-3" data-testid={`raw-${id}-value`}>{format(value)}</output>
  </div>
);

export const RawSourceSettingsDialog: React.FC<{ media: MediaItem; onClose: () => void }> = ({ media, onClose }) => {
  const raw = media.raw;
  const stored = raw?.settings;
  const [draft, setDraft] = React.useState<RawSourceSettings | null>(stored ?? null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = React.useState<"idle" | "developing" | "error">("idle");
  const request = React.useRef(0);

  React.useEffect(() => {
    if (!draft || !media.blob || raw?.developedBy !== "openreel") return;
    const mine = ++request.current;
    setStatus("developing");
    const timer = window.setTimeout(() => {
      getRawDeveloper()
        .develop({ sourceKey: `${media.id}:${media.blob!.size}`, blob: media.blob!, settings: draft, maxLongEdge: PREVIEW_EDGE })
        .then((frame) => {
          if (mine !== request.current) return;
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;
          canvas.width = frame.width;
          canvas.height = frame.height;
          ctx.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
          setStatus("idle");
        })
        .catch(() => {
          if (mine === request.current) setStatus("error");
        });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [draft, media.id, media.blob, raw?.developedBy]);

  if (!raw) return null;
  const format = rawFormatForFile(media.name);

  if (raw.sequence) {
    const baked = raw.sequence.bakedSettings;
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-[460px] border-border bg-bg-1 text-fg" data-testid="raw-settings-dialog">
          <DialogHeader>
            <DialogTitle>RAW Source Settings</DialogTitle>
            <DialogDescription className="truncate">{media.name}</DialogDescription>
          </DialogHeader>
          <p className="text-xs leading-snug text-fg-2" data-testid="raw-settings-sequence">
            This CinemaDNG sequence ({raw.sequence.frames} frames at {raw.sequence.frameRate} fps, from {raw.sequence.firstFrame}) was developed
            when it was imported: {baked.temperature} K, tint {baked.tint}, exposure {baked.exposure} EV, highlight recovery{" "}
            {Math.round(baked.highlightRecovery * 100)}%, {baked.demosaic} demosaic. To change the look, import the DNG frames again.
          </p>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (raw.developedBy !== "openreel" || !stored || !draft) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-[460px] border-border bg-bg-1 text-fg" data-testid="raw-settings-dialog">
          <DialogHeader>
            <DialogTitle>RAW Source Settings</DialogTitle>
            <DialogDescription className="truncate">{media.name}</DialogDescription>
          </DialogHeader>
          <p className="text-xs leading-snug text-fg-2" data-testid="raw-settings-unavailable">
            {format?.label ?? raw.format.toUpperCase()} was developed by macOS (ImageIO) when it was imported. Apple&apos;s engine chose the white
            balance and tone, so these settings cannot be changed here. For full control, convert the file to DNG (Adobe DNG Converter is free)
            and import the DNG.
          </p>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const set = (patch: Partial<RawSourceSettings>) => setDraft((d) => (d ? normalizeRawSettings(patch, d) : d));
  const asShot = raw.asShot;
  const dirty = !rawSettingsEqual(draft, stored);
  const apply = () => {
    onClose();
    if (dirty) void runOrganize("RAW Source Settings", setRawSourceSettings(media.id, draft));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[760px] border-border bg-bg-1 text-fg" data-testid="raw-settings-dialog">
        <DialogHeader>
          <DialogTitle>RAW Source Settings</DialogTitle>
          <DialogDescription className="truncate">
            {media.name}
            {raw.make || raw.model ? ` · ${[raw.make, raw.model].filter(Boolean).join(" ")}` : ""}
            {raw.bitDepth ? ` · ${raw.bitDepth}-bit ${raw.cfa ?? ""}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_360px]">
          <div className="flex min-h-[200px] items-center justify-center rounded border border-border bg-bg-0 p-1">
            <canvas ref={canvasRef} className="max-h-[360px] max-w-full" data-testid="raw-settings-preview" aria-label="Preview of the developed image" />
            {status === "error" && <span className="text-xs text-status-error">Could not develop this file.</span>}
          </div>
          <div className="space-y-2">
            <SliderRow id="temperature" label="Temperature" value={draft.temperature} min={TEMPERATURE_MIN} max={TEMPERATURE_MAX} step={50}
              format={(v) => `${v} K`} onChange={(v) => set({ temperature: v })} />
            <SliderRow id="tint" label="Tint" value={draft.tint} min={-TINT_LIMIT} max={TINT_LIMIT} step={1}
              format={(v) => (v > 0 ? `+${v}` : `${v}`)} onChange={(v) => set({ tint: v })} />
            <SliderRow id="exposure" label="Exposure" value={draft.exposure} min={-EXPOSURE_LIMIT} max={EXPOSURE_LIMIT} step={0.05}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`} onChange={(v) => set({ exposure: v })} />
            <SliderRow id="highlights" label="Highlight recovery" value={draft.highlightRecovery} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ highlightRecovery: v })} />
            <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs">
              <label htmlFor="raw-demosaic" className="text-fg-2">Demosaic</label>
              <select id="raw-demosaic" data-testid="raw-demosaic" className="h-7 rounded border border-border bg-bg-2 px-1"
                value={draft.demosaic} onChange={(e) => isRawDemosaicQuality(e.target.value) && set({ demosaic: e.target.value })}>
                {RAW_DEMOSAIC_QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label} - {q.hint}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs">
              <label htmlFor="raw-output" className="text-fg-2">Output colour space</label>
              <select id="raw-output" data-testid="raw-output" className="h-7 rounded border border-border bg-bg-2 px-1"
                value={draft.outputColorSpace} onChange={(e) => isRawOutputColorSpace(e.target.value) && set({ outputColorSpace: e.target.value })}>
                {RAW_OUTPUT_COLOR_SPACES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" data-testid="raw-as-shot"
                onClick={() => asShot && set({ temperature: asShot.temperature, tint: asShot.tint })}>
                As shot white balance
              </Button>
              <Button variant="secondary" size="sm" data-testid="raw-reset"
                onClick={() => asShot && setDraft(normalizeRawSettings({ temperature: asShot.temperature, tint: asShot.tint, exposure: 0, highlightRecovery: 0, demosaic: "standard", outputColorSpace: "srgb" }, draft))}>
                Reset all
              </Button>
            </div>
          </div>
        </div>
        <p className="text-[10px] leading-snug text-fg-3">
          Applying is one undo step. Preview and export develop from these same values, so they match. Output colour space sets the primaries
          of the developed image; the project&apos;s colour pipeline converts it from there.
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} data-testid="raw-cancel">Cancel</Button>
          <Button onClick={apply} disabled={!dirty} data-testid="raw-apply">Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

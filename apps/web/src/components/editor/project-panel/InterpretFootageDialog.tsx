import React from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@openreel/ui";
import {
  FOOTAGE_COLOR_PRESETS,
  CAMERA_FOOTAGE_COLOR_PRESETS,
  cameraPresetOf,
  PIXEL_ASPECT_PRESETS,
  FIELD_ORDERS,
  DEINTERLACE_MODES,
  effectivePixelAspect,
  effectiveFieldOrder,
  effectiveDeinterlace,
  interpretedDisplaySize,
  type FieldOrder,
  type DeinterlaceMode,
  validateInterpretation,
  DEFAULT_SOURCE_COLOR,
  describeSourceColor,
  effectiveSourceColor,
  inputSpaceForItem,
  isHdrTransfer,
  mapOcioColorSpaces,
  OcioConfigError,
  parseOcioConfig,
  type FootageColorPreset,
  type MediaItem,
  type OcioMapping,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { applyFootageInterpretation, runOrganize } from "../../../services/project-panel-commands";
import { actionTargetIds } from "./ProjectPanelMenus";

/**
 * Media info for colour plus "Interpret footage": what the file's tags say,
 * what the editor treats the pixels as, and a one-step undoable override.
 */
export const InterpretFootageDialog: React.FC<{ media: MediaItem; onClose: () => void }> = ({ media, onClose }) => {
  const [choice, setChoice] = React.useState<FootageColorPreset | "tagged">(media.colorInterpretation ?? "tagged");
  const detected = media.metadata.sourceColor;
  const effective = effectiveSourceColor({ ...media, colorInterpretation: choice === "tagged" ? undefined : choice });
  const willTransform = inputSpaceForItem({ ...media, colorInterpretation: choice === "tagged" ? undefined : choice }) !== null;
  const hdr = isHdrTransfer(effective);
  const cameraLog = cameraPresetOf(choice === "tagged" ? undefined : choice);
  const acesMode = useProjectStore((s) => s.project.settings.colorManagement === "aces");
  const ocioMode = useProjectStore((s) => s.project.settings.colorManagement === "ocio");
  // OCIO config import: a transient mapping of the config's colour spaces onto the built-in presets.
  const [ocio, setOcio] = React.useState<{ fileName: string; mapping: OcioMapping } | null>(null);
  const [ocioError, setOcioError] = React.useState<string | null>(null);
  const importOcio = async (file: File | undefined) => {
    if (!file) return;
    try {
      const mapping = mapOcioColorSpaces(parseOcioConfig(await file.text()));
      setOcio({ fileName: file.name, mapping });
      setOcioError(null);
    } catch (error) {
      setOcio(null);
      setOcioError(error instanceof OcioConfigError ? error.message : "The file could not be read as an OCIO config.");
    }
  };

  const isVideo = media.type === "video";
  const [fps, setFps] = React.useState(String(media.interpretation?.frameRate ?? media.metadata.frameRate ?? ""));
  const [retime, setRetime] = React.useState(true);
  const initialFps = String(media.interpretation?.frameRate ?? media.metadata.frameRate ?? "");
  const fpsEdited = fps !== initialFps;
  const draftError = isVideo && fpsEdited ? validateInterpretation({ frameRate: Number(fps) }) : null;

  const initialPar = effectivePixelAspect(media);
  const initialField = effectiveFieldOrder(media);
  const initialDeinterlace = effectiveDeinterlace(media);
  const initialParText = String(Number(initialPar.toFixed(4)));
  const [par, setPar] = React.useState(initialParText);
  // A preset's exact ratio (4/3, 10/11, ...); typing clears it so the typed number is what applies.
  const [parExact, setParExact] = React.useState<number | null>(null);
  const [field, setField] = React.useState<FieldOrder>(initialField);
  const [deinterlace, setDeinterlace] = React.useState<DeinterlaceMode>(initialDeinterlace);
  // Compared as text against the rounded initial value: an untouched dialog must not write a rounded override.
  const parEdited = par !== initialParText;
  const parValue = parExact ?? Number(par);
  const parError = isVideo && parEdited ? validateInterpretation({ pixelAspectRatio: parValue }) : null;
  const display = interpretedDisplaySize({ metadata: media.metadata, interpretation: { pixelAspectRatio: parValue > 0 ? parValue : 1 } });
  const detectedPar = media.metadata.pixelAspectRatio;

  const apply = () => {
    if (draftError || parError) return;
    const ids = actionTargetIds(media.id);
    onClose();
    // One organize action = one undo step. Only what was edited is sent; other selected items keep their overrides.
    void runOrganize(
      "Interpret footage",
      applyFootageInterpretation(ids, {
        ...(isVideo && fpsEdited ? { frameRate: Number(fps) } : {}),
        ...(isVideo && parEdited ? { pixelAspectRatio: parValue } : {}),
        ...(isVideo && field !== initialField ? { fieldOrder: field } : {}),
        ...(isVideo && deinterlace !== initialDeinterlace ? { deinterlace } : {}),
        ...(choice !== (media.colorInterpretation ?? "tagged") ? { color: choice === "tagged" ? null : choice } : {}),
        retimeClips: retime,
      }),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[440px] overflow-y-auto overflow-x-hidden border-border bg-bg-1 text-fg" data-testid="interpret-footage-dialog">
        <DialogHeader>
          <DialogTitle>Interpret footage</DialogTitle>
          <DialogDescription className="truncate">{media.name}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs" data-testid="media-color-info">
          <dt className="text-fg-3">Tagged as</dt>
          <dd data-testid="media-color-detected">{detected ? describeSourceColor(detected) : `${describeSourceColor(DEFAULT_SOURCE_COLOR)} - no colour tags`}</dd>
          <dt className="text-fg-3">Treated as</dt>
          <dd data-testid="media-color-effective">{describeSourceColor(effective)}</dd>
          <dt className="text-fg-3">Input transform</dt>
          <dd data-testid="media-color-transform">
            {ocioMode
              ? "OpenColorIO: the clip's OCIO input colour space (Color tab) or the project's default, then the config's looks and view; Interpret footage does not apply"
              : acesMode
              ? "ACES input transform (IDT) to ACEScg, then the ACES output transform, identical in preview and export"
              : willTransform
              ? hdr
                ? "HDR to SDR working image (tone-mapped), identical in preview and export"
                : cameraLog
                  ? "Camera log to Rec.709 (built-in formula, highlights rolled off), identical in preview and export"
                  : "Gamut converted to Rec.709, identical in preview and export"
              : "None: pixels are used as decoded"}
          </dd>
        </dl>
        <fieldset className="space-y-1" aria-label="Interpret footage as">
          <label className="flex items-center gap-2 text-xs">
            <input type="radio" name="interpret" checked={choice === "tagged"} onChange={() => setChoice("tagged")} data-testid="interpret-tagged" />
            As tagged{detected ? ` (${describeSourceColor(detected)})` : " (Rec.709)"}
          </label>
          {FOOTAGE_COLOR_PRESETS.filter((preset) => !preset.camera).map((preset) => (
            <label key={preset.id} className="flex items-center gap-2 text-xs">
              <input type="radio" name="interpret" checked={choice === preset.id} onChange={() => setChoice(preset.id)} data-testid={`interpret-${preset.id}`} />
              {preset.label}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 text-xs">
          <label htmlFor="interpret-camera" className="text-fg-3">Camera input (log)</label>
          <select
            id="interpret-camera"
            value={cameraLog ? choice : ""}
            onChange={(e) => e.target.value && setChoice(e.target.value as typeof choice)}
            className="h-7 w-full min-w-0 rounded border border-border bg-bg-2 px-1"
            data-testid="interpret-camera-select"
          >
            <option value="" disabled>None (use the option above)</option>
            {Array.from(new Set(CAMERA_FOOTAGE_COLOR_PRESETS.map((preset) => preset.camera?.maker ?? ""))).map((maker) => (
              <optgroup key={maker} label={maker}>
                {CAMERA_FOOTAGE_COLOR_PRESETS.filter((preset) => (preset.camera?.maker ?? "") === maker).map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="space-y-1 text-xs" data-testid="interpret-ocio">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3">
            <label htmlFor="interpret-ocio-file" className="text-fg-3">OCIO config</label>
            <input
              id="interpret-ocio-file"
              type="file"
              accept=".ocio,.yaml,.yml,text/plain"
              onChange={(e) => { void importOcio(e.target.files?.[0]); e.target.value = ""; }}
              className="min-w-0 text-[11px]"
              data-testid="interpret-ocio-file"
            />
          </div>
          {ocioError && <p className="text-[10px] text-red-400" data-testid="interpret-ocio-error">{ocioError}</p>}
          {ocio && (
            <div className="space-y-1" data-testid="interpret-ocio-result">
              <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3">
                <label htmlFor="interpret-ocio-space" className="text-fg-3">Colour space</label>
                <select
                  id="interpret-ocio-space"
                  value=""
                  onChange={(e) => e.target.value && setChoice(e.target.value as FootageColorPreset)}
                  className="h-7 w-full min-w-0 rounded border border-border bg-bg-2 px-1"
                  data-testid="interpret-ocio-select"
                >
                  <option value="" disabled>{ocio.mapping.supported.length} supported of {ocio.mapping.supported.length + ocio.mapping.unsupported.length} in {ocio.fileName}</option>
                  {ocio.mapping.supported.map((space) => (
                    <option key={space.name} value={space.preset}>
                      {space.name} → {FOOTAGE_COLOR_PRESETS.find((p) => p.id === space.preset)?.label ?? space.preset}
                    </option>
                  ))}
                </select>
              </div>
              {ocio.mapping.unsupported.length > 0 && (
                <details className="text-[10px] leading-snug text-fg-3" data-testid="interpret-ocio-unsupported">
                  <summary className="cursor-pointer">{ocio.mapping.unsupported.length} colour spaces are not supported</summary>
                  <ul className="mt-1 space-y-0.5">
                    {ocio.mapping.unsupported.map((space) => (
                      <li key={space.name}><span className="text-fg-2">{space.name}</span>: {space.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <p className="text-[10px] leading-snug text-fg-3">
            Reads the colour space list of an .ocio file and applies the matching built-in preset. The config's own transforms and LUTs are not run.
          </p>
        </div>
        {isVideo && (
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs" data-testid="interpret-timing">
            <label htmlFor="interpret-fps" className="text-fg-3">Frame rate</label>
            <input
              id="interpret-fps"
              type="number"
              min={1}
              max={240}
              step="any"
              value={fps}
              onChange={(e) => setFps(e.target.value)}
              className="h-7 w-full min-w-0 rounded border border-border bg-bg-2 px-2"
              data-testid="interpret-fps"
            />
            {draftError && <p className="col-span-2 text-[10px] text-red-400" data-testid="interpret-error">{draftError}</p>}
            <label htmlFor="interpret-par" className="text-fg-3">Pixel aspect</label>
            <div className="flex min-w-0 items-center gap-2">
              <select
                aria-label="Pixel aspect preset"
                value={PIXEL_ASPECT_PRESETS.find((p) => Math.abs(p.value - Number(par)) < 1e-3)?.id ?? ""}
                onChange={(e) => {
                  const preset = PIXEL_ASPECT_PRESETS.find((p) => p.id === e.target.value);
                  if (preset) {
                    setPar(String(Number(preset.value.toFixed(4))));
                    setParExact(preset.value);
                  }
                }}
                className="h-7 w-full min-w-0 rounded border border-border bg-bg-2 px-1"
                data-testid="interpret-par-preset"
              >
                <option value="">Custom</option>
                {PIXEL_ASPECT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <input
                id="interpret-par"
                type="number"
                min={0.25}
                max={4}
                step="any"
                value={par}
                onChange={(e) => { setPar(e.target.value); setParExact(null); }}
                className="h-7 w-20 shrink-0 rounded border border-border bg-bg-2 px-2"
                data-testid="interpret-par"
              />
            </div>
            {parError && <p className="col-span-2 text-[10px] text-red-400" data-testid="interpret-par-error">{parError}</p>}
            <dt className="text-fg-3">Display size</dt>
            <dd data-testid="interpret-display-size">
              {display.width} x {display.height}
              {detectedPar !== undefined ? ` (file reports pixel aspect ${Number(detectedPar.toFixed(4))})` : ""}
            </dd>
            <label htmlFor="interpret-field" className="text-fg-3">Field order</label>
            <select
              id="interpret-field"
              value={field}
              onChange={(e) => setField(e.target.value as FieldOrder)}
              className="h-7 w-full min-w-0 rounded border border-border bg-bg-2 px-1"
              data-testid="interpret-field"
            >
              {FIELD_ORDERS.map((o) => (
                <option key={o} value={o}>{o === "progressive" ? "Progressive (none)" : o === "upper" ? "Upper field first" : "Lower field first"}</option>
              ))}
            </select>
            <label htmlFor="interpret-deinterlace" className="text-fg-3">Deinterlace</label>
            <select
              id="interpret-deinterlace"
              value={deinterlace}
              disabled={field === "progressive"}
              onChange={(e) => setDeinterlace(e.target.value as DeinterlaceMode)}
              className="h-7 w-full min-w-0 rounded border border-border bg-bg-2 px-1"
              data-testid="interpret-deinterlace"
            >
              {DEINTERLACE_MODES.map((m) => (
                <option key={m} value={m}>{m === "none" ? "None" : m === "blend" ? "Blend" : "Bob"}</option>
              ))}
            </select>
            <label className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={retime} onChange={(e) => setRetime(e.target.checked)} data-testid="interpret-retime" />
              Apply to clips already on the timeline
            </label>
            <p className="col-span-2 text-[10px] leading-snug text-fg-3">
              A frame rate override conforms the footage: it plays at the interpreted rate, so a 30 fps file read as 24 fps runs 25% longer.
              Clips of this footage are retimed and later clips on the same track move to follow. Pixel aspect ratio stretches the frame to its
              display shape; field order with Blend or Bob removes combing from interlaced footage. Both apply to preview, the Program monitor, scopes and export.
            </p>
          </div>
        )}
        <p className="text-[10px] leading-snug text-fg-3">
          Use an override when a file is untagged or tagged wrongly (a flat, washed-out clip). On the web build the browser converts tagged
          HDR and wide-gamut files itself, so only an override changes them there; the desktop app decodes them through ffmpeg and applies the
          file's own tags.
        </p>
        <DialogFooter className="sticky bottom-0 -mb-6 bg-bg-1 pb-6 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={!!draftError || !!parError} data-testid="interpret-apply">Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

import {
  BROADCAST_AUDIO_TRACK_OPTIONS,
  isBroadcastCodec,
  normalizeStartTimecode,
  type BroadcastDeliverySettings,
  type VideoExportSettings,
} from "@openreel/core";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";

interface ExportBroadcastOptionsProps {
  settings: VideoExportSettings;
  onChange: (settings: VideoExportSettings) => void;
  isDesktop: boolean;
  /** The sequence's start timecode; the field falls back to it. */
  sequenceStartTimecode?: string;
}

/** Drops the broadcast block when every field is back at its default. */
function withBroadcast(settings: VideoExportSettings, patch: Partial<BroadcastDeliverySettings>): VideoExportSettings {
  const next: BroadcastDeliverySettings = { ...settings.broadcast, ...patch };
  for (const key of Object.keys(next) as (keyof BroadcastDeliverySettings)[]) {
    if (next[key] === undefined || next[key] === "") delete next[key];
  }
  if (next.audioTracks === undefined) delete next.extraTracks;
  return { ...settings, broadcast: Object.keys(next).length ? next : undefined };
}

/**
 * Broadcast delivery controls of the Export dialog: picture scan (1080i), MXF OP1a / OP-Atom, mono audio
 * tracks and the file's start timecode. The ffmpeg sidecar writes them, so the web build shows what is
 * missing instead of the controls.
 */
export function ExportBroadcastOptions({ settings, onChange, isDesktop, sequenceStartTimecode }: ExportBroadcastOptionsProps) {
  if (settings.format !== "mxf" && settings.format !== "mov") return null;
  if (!isDesktop) {
    return (
      <div className="col-span-2 space-y-1 rounded-md border border-border bg-bg-2 px-3 py-2" data-testid="export-broadcast-web-note">
        <p className="text-[11px] font-medium text-fg-2">Broadcast delivery needs the desktop app</p>
        <p className="text-[10px] leading-snug text-fg-3">
          XDCAM HD422 and AVC-Intra 100 in MXF OP1a, MXF OP-Atom, per-channel mono audio tracks and a start timecode are written by the OpenReel
          desktop app. In the browser, export H.264 / MP4.
        </p>
      </div>
    );
  }
  const broadcast = settings.broadcast ?? {};
  const broadcastCodec = isBroadcastCodec(settings.codec);
  const tracks = broadcast.audioTracks;
  const timecode = broadcast.startTimecode ?? "";
  const timecodeInvalid = timecode !== "" && !normalizeStartTimecode(timecode, settings.frameRate);
  return (
    <div className="col-span-2 grid grid-cols-2 gap-4 rounded-md border border-border bg-bg-2 p-3" data-testid="export-broadcast-options">
      <p className="col-span-2 text-[11px] font-medium text-fg-2">Broadcast delivery</p>

      {broadcastCodec && (
        <div className="space-y-1.5">
          <Label htmlFor="export-scan" className="text-[11px] text-fg-2">Scan</Label>
          <Select
            value={broadcast.scan ?? "progressive"}
            onValueChange={(value) => onChange(withBroadcast(settings, { scan: value === "interlaced-tff" ? "interlaced-tff" : undefined }))}
          >
            <SelectTrigger id="export-scan" aria-label="Scan" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="progressive" className="text-xs">Progressive</SelectItem>
              <SelectItem value="interlaced-tff" disabled={settings.height !== 1080} className="text-xs">Interlaced, top field first (1080i)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {settings.format === "mxf" && (
        <div className="space-y-1.5">
          <Label htmlFor="export-mxf-pattern" className="text-[11px] text-fg-2">MXF wrapper</Label>
          <Select
            value={broadcast.mxfPattern ?? "op1a"}
            onValueChange={(value) => onChange(withBroadcast(settings, { mxfPattern: value === "opatom" ? "opatom" : undefined }))}
          >
            <SelectTrigger id="export-mxf-pattern" aria-label="MXF wrapper" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="op1a" className="text-xs">OP1a (one file)</SelectItem>
              <SelectItem value="opatom" className="text-xs">OP-Atom (one file per track)</SelectItem>
            </SelectContent>
          </Select>
          {broadcast.mxfPattern === "opatom" && (
            <p className="text-[10px] leading-snug text-fg-3" data-testid="export-opatom-note">
              Writes name_V01.mxf for the picture and name_A01.mxf, name_A02.mxf... for each mono audio track beside the chosen file name.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="export-audio-tracks" className="text-[11px] text-fg-2">Audio tracks</Label>
        <Select
          value={tracks === undefined ? "stereo" : String(tracks)}
          onValueChange={(value) => onChange(withBroadcast(settings, { audioTracks: value === "stereo" ? undefined : Number(value) }))}
        >
          <SelectTrigger id="export-audio-tracks" aria-label="Audio tracks" className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stereo" className="text-xs">Stereo mix (one 2-channel track)</SelectItem>
            {BROADCAST_AUDIO_TRACK_OPTIONS.map((count) => (
              <SelectItem key={count} value={String(count)} className="text-xs">{count} mono tracks</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tracks !== undefined && tracks > 2 && (
        <div className="space-y-1.5">
          <Label htmlFor="export-extra-tracks" className="text-[11px] text-fg-2">Tracks 3-{tracks}</Label>
          <Select
            value={broadcast.extraTracks ?? "silence"}
            onValueChange={(value) => onChange(withBroadcast(settings, { extraTracks: value === "stems" ? "stems" : undefined }))}
          >
            <SelectTrigger id="export-extra-tracks" aria-label="Extra audio tracks" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="silence" className="text-xs">Silence</SelectItem>
              <SelectItem value="stems" className="text-xs">Stems (Dialogue, Music, FX, Ambience)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {tracks !== undefined && (
        <p className="col-span-2 -mt-2 text-[10px] leading-snug text-fg-3" data-testid="export-audio-tracks-note">
          Tracks 1 and 2 carry the stereo mix (left, right).{" "}
          {tracks > 2 ? (broadcast.extraTracks === "stems" ? "Following tracks carry the mono Essential Sound stems, in that order." : "The remaining tracks are silent.") : ""}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="export-start-timecode" className="text-[11px] text-fg-2">Start timecode</Label>
        <Input
          id="export-start-timecode"
          aria-label="Start timecode"
          aria-invalid={timecodeInvalid}
          spellCheck={false}
          placeholder={sequenceStartTimecode ?? "00:00:00:00"}
          value={timecode}
          onChange={(event) => onChange(withBroadcast(settings, { startTimecode: event.currentTarget.value.trim() || undefined }))}
          className="h-8 w-full font-mono text-xs"
        />
        <p className="text-[10px] leading-snug text-fg-3">
          {timecodeInvalid
            ? "Use HH:MM:SS:FF (a semicolon before the frames for drop frame)."
            : sequenceStartTimecode
              ? "Blank uses the sequence start timecode."
              : "Blank writes none. Set the sequence start in the Preview menu."}
        </p>
      </div>
    </div>
  );
}

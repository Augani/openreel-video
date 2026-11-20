import { useMemo } from "react";
import {
  CAPTION_EXPORT_FORMATS,
  CAPTION_FORMAT_INFO,
  listCaptionTracks,
  planEmbeddedCaptions,
  trackExportSettings,
  type CaptionExportFormat,
  type CaptionExportSettings,
  type CaptionTrackExportSettings,
  type EmbeddedCaptionMode,
  type Subtitle,
} from "@openreel/core";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@openreel/ui";

interface ExportCaptionOptionsProps {
  subtitles: readonly Subtitle[];
  value: CaptionExportSettings;
  onChange: (next: CaptionExportSettings) => void;
  format: "mp4" | "webm" | "mov" | "mxf" | "mkv";
  isDesktop: boolean;
  frameRate: number;
}

const EMBEDDED_LABEL: Record<EmbeddedCaptionMode, string> = {
  none: "Not embedded",
  subtitle: "Subtitle track",
  cea608: "CEA-608 (MOV)",
};

const trackName = (id: string, language: string | undefined) =>
  id ? `${id}${language ? ` (${language})` : ""}` : language ? `Default captions (${language})` : "Default captions";

/** Is a track left at defaults (burned in, no sidecar, not embedded)? Defaults are not stored. */
const isDefault = (t: CaptionTrackExportSettings) => t.burnIn && t.sidecar === "none" && t.embedded === "none";

/**
 * Per caption track delivery in the Export dialog: burn into the picture, write a
 * sidecar file (SRT / WebVTT / TTML / SCC / EBU-STL) and/or embed a subtitle track
 * (WebVTT or tx3g in MP4, CEA-608 in MOV on desktop).
 */
export function ExportCaptionOptions({
  subtitles,
  value,
  onChange,
  format,
  isDesktop,
  frameRate,
}: ExportCaptionOptionsProps) {
  const tracks = useMemo(() => listCaptionTracks(subtitles as Subtitle[]), [subtitles]);

  const warnings = useMemo(
    () =>
      planEmbeddedCaptions(subtitles, value, {
        format,
        engine: isDesktop ? "native" : "web",
        frameRate,
      }).warnings,
    [subtitles, value, format, isDesktop, frameRate],
  );

  const hiddenTracks = useMemo(() => {
    const shown = new Set(subtitles.filter((c) => !c.hidden).map((c) => c.captionTrackId ?? ""));
    return new Set(tracks.filter((t) => !shown.has(t.id)).map((t) => t.id));
  }, [subtitles, tracks]);

  const update = (id: string, patch: Partial<CaptionTrackExportSettings>) => {
    const next = { ...trackExportSettings(value, id), ...patch };
    const others = value.tracks.filter((t) => t.captionTrackId !== id);
    onChange({ tracks: isDefault(next) ? others : [...others, next] });
  };

  const embeddedInBrowser = !isDesktop && value.tracks.some((t) => t.embedded !== "none");

  if (!tracks.length) {
    return (
      <section className="rounded-[10px] border border-border bg-bg-1 p-4" data-testid="export-captions">
        <h4 className="text-[12px] font-semibold text-fg">Captions</h4>
        <p className="mt-1 text-[10px] text-fg-muted">
          This project has no captions. Add or import captions to burn them in, write sidecar files or embed them.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[10px] border border-border bg-bg-1 p-4" data-testid="export-captions">
      <h4 className="text-[12px] font-semibold text-fg">Captions</h4>
      <p className="mt-1 text-[10px] text-fg-muted">
        Per caption track: draw it into the picture, write a sidecar file next to the video, or embed a subtitle track.
      </p>
      <div className="mt-3 space-y-3">
        {tracks.map((track) => {
          const settings = trackExportSettings(value, track.id);
          const key = track.id || "default";
          return (
            <div
              key={key}
              className="space-y-2 rounded-md border border-border bg-bg-2 p-2.5"
              data-testid={`export-caption-track-${key}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] font-medium text-fg">
                  {trackName(track.id, track.language)}
                </span>
                <span className="shrink-0 text-[10px] text-fg-muted">
                  {track.cueCount} caption{track.cueCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:justify-start">
                  <Label htmlFor={`caption-burn-${key}`} className="text-[10px] text-fg-muted">
                    {hiddenTracks.has(track.id) ? "Burn in (hidden)" : "Burn in"}
                  </Label>
                  <Switch
                    id={`caption-burn-${key}`}
                    aria-label={`Burn in ${trackName(track.id, track.language)}`}
                    title={hiddenTracks.has(track.id) ? "This track is hidden in the picture. Choose it with Show in picture in the Transcript panel." : undefined}
                    disabled={hiddenTracks.has(track.id)}
                    checked={settings.burnIn && !hiddenTracks.has(track.id)}
                    onCheckedChange={(burnIn) => update(track.id, { burnIn })}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label className="text-[10px] text-fg-muted">Sidecar file</Label>
                  <Select
                    value={settings.sidecar}
                    onValueChange={(sidecar) =>
                      update(track.id, { sidecar: sidecar as CaptionExportFormat | "none" })
                    }
                  >
                    <SelectTrigger
                      className="h-7 w-full text-[11px]"
                      aria-label={`Sidecar format for ${trackName(track.id, track.language)}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">
                        None
                      </SelectItem>
                      {CAPTION_EXPORT_FORMATS.map((f) => (
                        <SelectItem key={f} value={f} className="text-xs">
                          {CAPTION_FORMAT_INFO[f].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1">
                  <Label className="text-[10px] text-fg-muted">Embedded</Label>
                  <Select
                    value={settings.embedded}
                    onValueChange={(embedded) =>
                      update(track.id, { embedded: embedded as EmbeddedCaptionMode })
                    }
                  >
                    <SelectTrigger
                      className="h-7 w-full text-[11px]"
                      aria-label={`Embedded captions for ${trackName(track.id, track.language)}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(EMBEDDED_LABEL) as EmbeddedCaptionMode[]).map((mode) => (
                        <SelectItem key={mode} value={mode} className="text-xs">
                          {EMBEDDED_LABEL[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {embeddedInBrowser && warnings.length === 0 && (
        <p className="mt-2 text-[10px] text-fg-muted" data-testid="export-caption-browser-note">
          Browser exports embed a WebVTT track in the MP4. Some tools (including ffmpeg) list it as a data track; use the
          desktop app for a tx3g or CEA-608 track.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[10px] text-status-warning" role="status" data-testid="export-caption-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

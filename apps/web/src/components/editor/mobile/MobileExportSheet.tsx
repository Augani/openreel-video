import { useRef } from "react";
import {
  Button, Dialog, DialogContent, DialogTitle, Popover, PopoverContent,
  PopoverTrigger, ScrollArea, ToggleGroup, ToggleGroupItem,
} from "@openreel/ui";
import type { VideoExportSettings } from "@openreel/core";
import type { ExportDeliveryMode } from "../../../services/export-runner";
import { getProjectPreview } from "../../../services/project-preview-cache";
import { useProjectStore } from "../../../stores/project-store";
import { MobileEditorIcon } from "./MobileEditorIcon";
import "./mobile-tools.css";
import "./mobile-export.css";

/** Keep the chosen aspect ratio and round to the even dimensions required by H.264. */
export function mobileExportResolution(width: number, height: number, shortEdge: number) {
  const scale = shortEdge / Math.min(width, height);
  return { width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2) };
}

function ratioLabel(width: number, height: number) {
  const standard = [[16, 9], [9, 16], [1, 1], [4, 5], [4, 3], [3, 4]];
  const ratio = standard.find(([w, h]) => Math.abs(width / height - w / h) < .003);
  return ratio ? ratio.join(":") : `${width}×${height}`;
}

const shares = [
  { label: "TikTok", glyph: "T", platform: "TikTok" },
  { label: "Reels", glyph: "R", platform: "Instagram" },
  { label: "Shorts", glyph: "S", platform: "YouTube" },
];

export function MobileExportSheet({ open, onOpenChange, settings, onSettingsChange, duration,
  onExport, onAdvanced, disabled, checking, error, adjustment, nativeEncoderRequired,
  fallbackAcknowledged, onAcknowledgeFallback, section, delivery, onAddToQueue,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; settings: VideoExportSettings;
  onSettingsChange: (settings: Partial<VideoExportSettings>) => void; duration: number;
  onExport: () => void; onAdvanced: (platform?: string) => void; disabled: boolean;
  checking: boolean; error: string | null; adjustment: VideoExportSettings | null;
  nativeEncoderRequired: boolean; fallbackAcknowledged: boolean; onAcknowledgeFallback: () => void;
  section: "all" | "range"; delivery: ExportDeliveryMode;
  /** When set, a secondary "Add to queue" action sits under the primary export button. */
  onAddToQueue?: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const project = useProjectStore(state => state.project);
  const preview = getProjectPreview(project.id, project.modifiedAt);
  const android = /Android/i.test(navigator.userAgent);
  const shortEdge = Math.min(settings.width, settings.height);
  const resolution = [720, 1080, 2160].find(value => Math.abs(shortEdge - value) <= 1);
  const seconds = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const time = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  // Both rates are kilobits per second. This is an estimate, not the final muxed file size.
  const bytes = ((settings.bitrate || 0) + (settings.audioSettings?.bitrate || 0)) * 1000 * seconds / 8;
  const size = bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent ref={contentRef} hideCloseButton aria-describedby={undefined}
      className="mobile-editor-sheet mobile-export-sheet" overlayClassName="mobile-editor-sheet-scrim"
      data-platform={android ? "android" : "ios"}
      onOpenAutoFocus={event => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}>
      <div className="mobile-sheet-grabber" aria-hidden><span/></div>
      <div className="mobile-sheet-heading"><DialogTitle>Export</DialogTitle>
        <Button variant="ghost" className="mobile-export-options" aria-label="Advanced export settings" onClick={() => onAdvanced()}>•••</Button>
        <Button variant="ghost" onClick={() => onOpenChange(false)} aria-label="Close export">{android ? <MobileEditorIcon name="close" size={20}/> : "Done"}</Button>
      </div>
      <ScrollArea className="mobile-sheet-scroll">
        <div className="mobile-export-content">
          <div className="mobile-export-summary">
            <div className="mobile-export-thumbnail">{preview?.thumbnailUrl ? <img src={preview.thumbnailUrl} alt="Project preview"/> : <MobileEditorIcon name="play" size={24}/>}</div>
            <div><div className="mobile-export-name">{project.name || "Untitled project"}</div><div className="mobile-export-meta">{time} · {ratioLabel(settings.width, settings.height)} · ~{size}{section === "range" ? " · In/Out" : ""}</div></div>
          </div>
          <div className="mobile-export-field"><span>Resolution</span>
            <ToggleGroup type="single" value={resolution ? String(resolution) : "custom"} aria-label="Resolution" className="mobile-export-segmented" onValueChange={value => {
              if (value && value !== "custom") onSettingsChange(mobileExportResolution(settings.width, settings.height, Number(value)));
            }}>
              <ToggleGroupItem value="720">720p</ToggleGroupItem><ToggleGroupItem value="1080">1080p</ToggleGroupItem><ToggleGroupItem value="2160">4K</ToggleGroupItem>
              {!resolution && <ToggleGroupItem value="custom" onClick={() => onAdvanced()}>{settings.width}×{settings.height}</ToggleGroupItem>}
            </ToggleGroup>
          </div>
          <div className="mobile-export-field"><span>Frame rate</span>
            <ToggleGroup type="single" value={String(settings.frameRate)} aria-label="Frame rate" className="mobile-export-segmented" onValueChange={value => { if (value) onSettingsChange({ frameRate: Number(value), keyframeInterval: Math.round(Number(value) * 2) }); }}>
              <ToggleGroupItem value="30">30 fps</ToggleGroupItem><ToggleGroupItem value="60">60 fps</ToggleGroupItem>
              {![30, 60].includes(settings.frameRate) && <ToggleGroupItem value={String(settings.frameRate)}>{settings.frameRate} fps</ToggleGroupItem>}
            </ToggleGroup>
          </div>
          {error && <p role="alert" className="mobile-export-error">{error}</p>}
          {adjustment && <p role="alert" className="mobile-export-notice">Browser safety limits: {adjustment.width}×{adjustment.height} · {adjustment.frameRate} fps.</p>}
          {nativeEncoderRequired && <div className="mobile-export-notice"><p>ProRes, transparency and high bit depth require the desktop encoder.</p>{fallbackAcknowledged ? <p>Will export H.264 without transparency.</p> : <Button variant="secondary" onClick={onAcknowledgeFallback}>Use H.264 without transparency</Button>}</div>}
          <Button className="mobile-export-primary" disabled={disabled} onClick={onExport}>{checking ? "Checking encoder…" : delivery === "file" ? "Choose a file location" : "Save to device"}</Button>
          {onAddToQueue && <Button variant="secondary" className="mobile-export-queue" disabled={disabled} onClick={onAddToQueue}>Add to queue</Button>}
          <div className="mobile-export-share"><span>Share to</span><div>
            {shares.map(share => <Popover key={share.label}><PopoverTrigger asChild><Button variant="ghost" className="mobile-export-share-target" aria-label={`Export for ${share.label}`}><span>{share.glyph}</span><span>{share.label}</span></Button></PopoverTrigger>
              <PopoverContent className="mobile-export-share-options" collisionPadding={16}>
                <strong>Export for {share.label}</strong><p>Save the video, then upload it in {share.label}. Your current canvas and framing are preserved.</p>
                <Button disabled={disabled} onClick={onExport}>Export current settings</Button>
                <Button variant="secondary" onClick={() => onAdvanced(share.platform)}>Choose {share.label} preset</Button>
              </PopoverContent>
            </Popover>)}
            <Button variant="ghost" className="mobile-export-share-target" aria-label="More export options" onClick={() => onAdvanced()}><span>•••</span><span>More</span></Button>
          </div></div>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>;
}

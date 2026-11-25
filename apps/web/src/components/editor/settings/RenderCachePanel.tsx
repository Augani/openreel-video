import { useCallback, useEffect, useState } from "react";
import { Button, Select, Switch, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { FolderOpen, RotateCcw, Trash2 } from "@/icons/lucide-compat";
import type { OpenReelRenderCacheSettings } from "../../../types/global";
import { renderCacheService, useRenderCacheSnapshot } from "../../../services/render-cache-service";
import { desktopBridge } from "../../../services/render-cache-backends";
import {
  MAX_WEB_CAP_BYTES,
  MIN_WEB_CAP_BYTES,
  readRenderCachePrefs,
  writeRenderCachePrefs,
  type PreviewResolution,
} from "../../../services/render-cache-prefs";

const GB = 1024 * 1024 * 1024;
const DESKTOP_CAPS = [5, 10, 20, 50, 100, 250, 500].map((gb) => gb * GB);
const WEB_CAPS = [0.5, 1, 2, 4, 8].map((gb) => gb * GB);

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < GB) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

const capLabel = (bytes: number) => (bytes >= GB ? `${bytes / GB} GB` : `${bytes / 1024 / 1024} MB`);

/** Settings > Render cache: where render files live, how big the cache may grow, and at what size frames are rendered. */
export default function RenderCachePanel() {
  const bridge = desktopBridge();
  const snapshot = useRenderCacheSnapshot();
  const [settings, setSettings] = useState<OpenReelRenderCacheSettings | null>(null);
  const [prefs, setPrefs] = useState(readRenderCachePrefs);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<number | null>(null);

  const refreshUsage = useCallback(async () => {
    try {
      setUsage(bridge ? (await bridge.usage()).bytes : null);
    } catch {
      setUsage(null);
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getSettings().then(setSettings).catch(() => undefined);
    void refreshUsage();
  }, [bridge, refreshUsage, snapshot.bytes]);

  const pick = async () => {
    if (!bridge) return;
    setError(null);
    const result = await bridge.pickScratch();
    setSettings(result.settings);
    if (result.error) setError(result.error);
    if (result.changed) {
      // Files already rendered stay in the old folder; the open project starts a fresh cache in the new one.
      await renderCacheService.deleteRenderFiles({ silent: true });
      await renderCacheService.refreshBudget();
    }
  };
  const reset = async () => {
    if (!bridge) return;
    setSettings(await bridge.resetScratch());
    await renderCacheService.deleteRenderFiles({ silent: true });
  };
  const setCap = async (bytes: number) => {
    if (bridge) setSettings(await bridge.setCap(bytes));
    else setPrefs(writeRenderCachePrefs({ webCapBytes: Math.min(MAX_WEB_CAP_BYTES, Math.max(MIN_WEB_CAP_BYTES, bytes)) }));
    await renderCacheService.refreshBudget();
  };
  const caps = bridge ? DESKTOP_CAPS : WEB_CAPS;
  const cap = bridge ? (settings?.capBytes ?? DESKTOP_CAPS[2]) : prefs.webCapBytes;
  const capChoices = caps.includes(cap) ? caps : [...caps, cap].sort((a, b) => a - b);

  return (
    <div className="space-y-5 text-xs" data-testid="render-cache-panel">
      <div>
        <h3 className="text-sm font-medium">Render cache</h3>
        <p className="mt-1 leading-5 text-fg-2">
          Render In to Out writes the frames of effects-heavy stretches to disk so they play back in real time. Render files are kept between sessions and
          only the stretches you edit are discarded. The least recently played frames are removed first when the cache is full.
        </p>
      </div>

      {bridge ? (
        <section className="space-y-2" aria-labelledby="scratch-heading">
          <h4 id="scratch-heading" className="text-xs font-medium">Scratch disk</h4>
          <p className="leading-5 text-fg-2">Render files go to a folder named &ldquo;OpenReel Render Cache&rdquo; inside this location. Choose a fast drive with room to spare.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code data-testid="scratch-dir" className="min-w-0 max-w-full flex-1 truncate rounded-md border border-border bg-bg-2 px-2 py-1.5 text-[11px]" title={settings?.scratchDir}>
              {settings?.scratchDir ?? "…"}
            </code>
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void pick()}>
              <FolderOpen size={14} aria-hidden /> Choose folder
            </Button>
            {settings && !settings.isDefault && (
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void reset()}>
                <RotateCcw size={14} aria-hidden /> Use default
              </Button>
            )}
          </div>
          <p className="text-fg-2">
            {settings?.freeBytes != null ? `${formatBytes(settings.freeBytes)} free on this drive. ` : ""}
            {usage !== null ? `${formatBytes(usage)} of render files across all projects.` : ""}
          </p>
          {error && <p role="alert" className="text-status-error">{error}</p>}
        </section>
      ) : (
        <p className="leading-5 text-fg-2">
          In the browser, render files live in this site&rsquo;s private storage ({snapshot.codec ? "OPFS" : "browser storage"}), which the browser may clear when
          space runs low. The desktop app can use a scratch disk folder you choose.
        </p>
      )}

      <section className="space-y-2" aria-labelledby="cap-heading">
        <h4 id="cap-heading" className="text-xs font-medium">{bridge ? "Size limit (all projects)" : "Size limit (this project)"}</h4>
        <Select value={String(cap)} onValueChange={(value) => void setCap(Number(value))}>
          <SelectTrigger aria-label="Render cache size limit" className="h-8 w-full rounded-md bg-bg-2 px-2 text-xs sm:w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {capChoices.map((bytes) => <SelectItem key={bytes} value={String(bytes)}>{capLabel(bytes)}</SelectItem>)}
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-2" aria-labelledby="idle-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 id="idle-heading" className="text-xs font-medium">Render in background when idle</h4>
            <p className="text-[11px] text-text-secondary">
              After a few quiet seconds, renders the yellow and red parts of the render bar nearest the playhead. Any edit, playback or scrub stops it at once.
              It also pauses under memory pressure and on a low battery.
            </p>
          </div>
          <Switch
            aria-labelledby="idle-heading"
            checked={prefs.idleRender}
            onCheckedChange={(value) => setPrefs(writeRenderCachePrefs({ idleRender: value }))}
          />
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="res-heading">
        <h4 id="res-heading" className="text-xs font-medium">Preview resolution</h4>
        <Select
          value={prefs.resolution}
          onValueChange={(value) => setPrefs(writeRenderCachePrefs({ resolution: value as PreviewResolution }))}
        >
          <SelectTrigger aria-label="Render cache preview resolution" className="h-8 w-full rounded-md bg-bg-2 px-2 text-xs sm:w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Full resolution (sequence size)</SelectItem>
            <SelectItem value="1080p">Up to 1920 wide (smaller files)</SelectItem>
          </SelectContent>
        </Select>
        <p className="leading-5 text-fg-2">
          Changing this discards the current render files. Exports can reuse render files only when they match the export size, so full resolution is what makes
          &ldquo;Use previews&rdquo; apply to 4K exports.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void renderCacheService.deleteRenderFiles()}>
          <Trash2 size={14} aria-hidden /> Delete this project&rsquo;s render files
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void renderCacheService.deleteRenderFiles({ allProjects: true }).then(refreshUsage)}>
          Delete all render files
        </Button>
      </section>
    </div>
  );
}

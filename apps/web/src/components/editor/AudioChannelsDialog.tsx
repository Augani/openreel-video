import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ToggleGroup, ToggleGroupItem, cn } from "@openreel/ui";
import {
  CHANNEL_PRESETS,
  CHANNEL_PRESET_LABELS,
  CLIP_CHANNEL_FORMATS,
  FORMAT_CHANNEL_COUNT,
  FORMAT_CHANNEL_NAMES,
  MIX_CHANNELS,
  SILENT_CHANNEL,
  channelMatrix,
  fileChannelFormat,
  identityChannelMap,
  isIdentityChannelMap,
  matchChannelPreset,
  presetChannelMap,
  resolveClipChannelMap,
  sameChannelMap,
  type ChannelPreset,
  type ClipChannelFormat,
  type ClipChannelMap,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useAudioChannelsStore } from "../../stores/audio-channels-store";
import { canSplitToMono, setClipChannelMap, splitClipToMono } from "../../services/audio-channels";
import { toast } from "../../stores/notification-store";

const SOURCE_NAMES: Record<ClipChannelFormat, readonly string[]> = FORMAT_CHANNEL_NAMES;

/** Names a source channel: L/R for stereo files, the 5.1 names for 6-channel files, otherwise "Ch n". */
function sourceChannelName(index: number, sourceChannels: number): string {
  if (sourceChannels === 1) return "Mono";
  const names = SOURCE_NAMES[fileChannelFormat(sourceChannels)];
  return names[index] ?? `Ch ${index + 1}`;
}

/** Re-targets a map to another format, keeping what the old outputs played where the new format has the same slots. */
function withFormat(map: ClipChannelMap, format: ClipChannelFormat, sourceChannels: number): ClipChannelMap {
  if (map.format === format) return map;
  const count = FORMAT_CHANNEL_COUNT[format];
  const fallback = identityChannelMap(sourceChannels).sources;
  const sources = Array.from({ length: count }, (_, index) => {
    if (map.sources[index] !== undefined) return map.sources[index];
    if (format === "mono") return 0;
    return fallback[index] !== undefined ? fallback[index] : SILENT_CHANNEL;
  });
  return { format, sources };
}

/**
 * Modify > Audio Channels. Maps the source file's channels onto the clip's channels (mono, stereo, 5.1) for one
 * clip or a whole selection; the quick buttons cover the common jobs (left only, right only, swap) and Split to
 * mono clips turns a stereo interview into two mono clips. Nothing is applied until Apply (one undo step).
 */
export function AudioChannelsDialog() {
  const open = useAudioChannelsStore((state) => state.open);
  const clipIds = useAudioChannelsStore((state) => state.clipIds);
  const close = useAudioChannelsStore((state) => state.close);
  const project = useProjectStore((state) => state.project);

  const targets = useMemo(() => {
    const clips = project.timeline.tracks.flatMap((track) => track.clips);
    return clipIds.flatMap((id) => {
      const clip = clips.find((candidate) => candidate.id === id);
      const media = clip && project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
      return clip && media ? [{ clip, media }] : [];
    });
  }, [clipIds, project]);

  const sourceChannels = Math.max(1, ...targets.map(({ media }) => media.metadata.channels || 2));
  const first = targets[0];
  const initial = useMemo<ClipChannelMap>(
    () => (first ? resolveClipChannelMap(first.clip, first.media) ?? identityChannelMap(first.media.metadata.channels || 2) : identityChannelMap(2)),
    // Re-seed only when the dialog opens for a different selection, not on every unrelated project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, clipIds],
  );
  const [draft, setDraft] = useState<ClipChannelMap>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setDraft(initial); }, [open, initial]);

  const mixedStarts = targets.some(({ clip, media }) => !sameChannelMap(resolveClipChannelMap(clip, media) ?? identityChannelMap(media.metadata.channels || 2), initial));
  // For a stereo file "Use file" and "Stereo" are the same map, so the preset the user picked stays shown while it still matches.
  const [picked, setPicked] = useState<ChannelPreset | null>(null);
  useEffect(() => { if (open) setPicked(null); }, [open, clipIds]);
  const pickedMap = picked ? (picked === "file" ? identityChannelMap(sourceChannels) : presetChannelMap(picked, sourceChannels)) : undefined;
  const preset = picked && sameChannelMap(pickedMap, draft) ? picked : matchChannelPreset(draft, sourceChannels);
  const matrix = channelMatrix(draft, sourceChannels);
  const outputNames = FORMAT_CHANNEL_NAMES[draft.format];
  const canSplit = targets.length === 1 && canSplitToMono(project, targets[0].clip.id);
  const changed = mixedStarts || !sameChannelMap(draft, initial);

  const setOutput = (output: number, source: number) =>
    setDraft((map) => ({ ...map, sources: map.sources.map((entry, index) => (index === output ? source : entry)) }));
  const applyPreset = (name: ChannelPreset) => {
    setPicked(name);
    setDraft(name === "file" ? identityChannelMap(sourceChannels) : presetChannelMap(name, sourceChannels) ?? identityChannelMap(sourceChannels));
  };

  const apply = async () => {
    setBusy(true);
    try {
      // The file's own layout is stored as "no map" unless one of the clips' files has an import default that must be overridden.
      const overridesPreset = targets.some(({ media }) => media.channelPreset && media.channelPreset !== "file");
      const map = isIdentityChannelMap(draft, sourceChannels) && !overridesPreset ? null : draft;
      const result = await setClipChannelMap(targets.map(({ clip }) => clip.id), map);
      if (result.success) close();
      else toast.error("Audio channels not changed", result.error?.message ?? "The clips could not be updated.");
    } finally {
      setBusy(false);
    }
  };
  const split = async () => {
    if (!first) return;
    setBusy(true);
    try {
      const result = await splitClipToMono(first.clip.id);
      if (result.success) close();
      else toast.error("Could not split to mono", result.error?.message ?? "The clip could not be split.");
    } finally {
      setBusy(false);
    }
  };

  const title = targets.length === 1 ? first.media.name : `${targets.length} clips`;
  const columns: { key: number; label: string }[] = [
    ...Array.from({ length: sourceChannels }, (_, index) => ({ key: index, label: sourceChannelName(index, sourceChannels) })),
    { key: MIX_CHANNELS, label: "Mix" },
    { key: SILENT_CHANNEL, label: "Off" },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-lg gap-4" data-testid="audio-channels-dialog">
        <DialogHeader>
          <DialogTitle>Modify clip: Audio channels</DialogTitle>
          <DialogDescription className="truncate">{title}{targets.length === 1 ? ` · ${sourceChannels}-channel source` : ` · up to ${sourceChannels} source channels`}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-fg-2" id="audio-channels-preset-label">Preset</div>
          <ToggleGroup type="single" value={preset ?? ""} onValueChange={(value) => { if (value) applyPreset(value as ChannelPreset); }} aria-labelledby="audio-channels-preset-label" className="justify-start">
            {CHANNEL_PRESETS.map((name) => (
              <ToggleGroupItem key={name} value={name} data-testid={`audio-channels-preset-${name}`} className="h-8 px-3 text-xs">{CHANNEL_PRESET_LABELS[name]}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          {preset === null && <p className="text-[11px] text-fg-muted" data-testid="audio-channels-custom">Custom mapping</p>}
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-fg-2" id="audio-channels-format-label">Clip channel format</div>
          <ToggleGroup type="single" value={draft.format} onValueChange={(value) => { if (value) setDraft((map) => withFormat(map, value as ClipChannelFormat, sourceChannels)); }} aria-labelledby="audio-channels-format-label" className="justify-start">
            {CLIP_CHANNEL_FORMATS.map((format) => (
              <ToggleGroupItem key={format} value={format} data-testid={`audio-channels-format-${format}`} className="h-8 px-3 text-xs">{format === "mono" ? "Mono" : format === "stereo" ? "Stereo" : "5.1"}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-fg-2">Source channel for each clip channel</div>
            {sourceChannels >= 2 && draft.format !== "5.1" && (
              <div className="flex gap-1">
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" data-testid="audio-channels-left-only" onClick={() => setDraft({ format: "mono", sources: [0] })}>Left only</Button>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" data-testid="audio-channels-right-only" onClick={() => setDraft({ format: "mono", sources: [1] })}>Right only</Button>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" data-testid="audio-channels-swap" onClick={() => setDraft({ format: "stereo", sources: [1, 0] })}>Swap L/R</Button>
              </div>
            )}
          </div>
          <div role="grid" aria-label="Channel mapping" className="overflow-x-auto rounded-md border border-border bg-bg-2" data-testid="audio-channels-grid">
            <div role="row" className="grid items-center border-b border-border text-[10px] uppercase tracking-wide text-fg-muted" style={{ gridTemplateColumns: `minmax(64px,auto) repeat(${columns.length}, minmax(34px,1fr))` }}>
              <div role="columnheader" className="px-2 py-1.5">Clip</div>
              {columns.map((column) => <div key={column.key} role="columnheader" className="px-1 py-1.5 text-center">{column.label}</div>)}
            </div>
            {draft.sources.map((entry, output) => (
              <div key={output} role="row" className="grid items-center border-b border-border last:border-b-0" style={{ gridTemplateColumns: `minmax(64px,auto) repeat(${columns.length}, minmax(34px,1fr))` }} data-testid={`audio-channels-row-${output}`}>
                <div role="rowheader" className="px-2 py-1.5 text-xs font-medium">{outputNames[output]}</div>
                {columns.map((column) => {
                  const selected = entry === column.key;
                  return (
                    <div key={column.key} role="gridcell" className="flex justify-center py-1">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${outputNames[output]} plays ${column.key === MIX_CHANNELS ? "a mix of all source channels" : column.key === SILENT_CHANNEL ? "nothing" : `source ${column.label}`}`}
                        data-testid={`audio-channels-cell-${output}-${column.key === MIX_CHANNELS ? "mix" : column.key === SILENT_CHANNEL ? "off" : column.key}`}
                        onClick={() => setOutput(output, column.key)}
                        className={cn("h-5 w-5 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", selected ? "border-primary bg-primary" : "border-border bg-transparent hover:border-fg-2")}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-fg-muted" data-testid="audio-channels-summary">
            {matrix.map((row, index) => `${outputNames[index]}: ${row.every((gain) => gain === 0) ? "silent" : row.every((gain) => gain === row[0]) && row.length > 1 ? "mix of all channels" : row.map((gain, source) => (gain > 0 ? sourceChannelName(source, sourceChannels) : null)).filter(Boolean).join(" + ")}`).join("  ·  ")}
          </p>
          {draft.format === "5.1" && sourceChannels < 6 && <p className="text-[11px] text-fg-muted">This source has {sourceChannels} channel{sourceChannels === 1 ? "" : "s"}; the other 5.1 channels stay silent.</p>}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {canSplit ? <Button type="button" variant="outline" size="sm" disabled={busy} data-testid="audio-channels-split" onClick={() => { void split(); }}>Split to mono clips</Button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
            <Button type="button" size="sm" disabled={busy || !changed || targets.length === 0} data-testid="audio-channels-apply" onClick={() => { void apply(); }}>Apply</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

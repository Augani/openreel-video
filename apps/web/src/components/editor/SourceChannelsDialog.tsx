import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from "@openreel/ui";
import {
  CLIP_CHANNEL_FORMATS,
  FORMAT_CHANNEL_COUNT,
  FORMAT_CHANNEL_NAMES,
  MAX_SOURCE_GROUPS,
  MIX_CHANNELS,
  SILENT_CHANNEL,
  SOURCE_LAYOUT_PRESETS,
  SOURCE_LAYOUT_PRESET_LABELS,
  buildSourceGroups,
  matchSourceLayoutPreset,
  patchLabel,
  resolveSourceChannelGroups,
  sameSourceLayout,
  sourceAudioShape,
  type ClipChannelFormat,
  type MediaItem,
  type SourceChannelGroup,
  type SourceLayoutPreset,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useAudioChannelsStore } from "../../stores/audio-channels-store";
import { setMediaChannelLayout } from "../../services/audio-channels";
import { toast } from "../../stores/notification-store";

const OFF = String(SILENT_CHANNEL);
const MIX = String(MIX_CHANNELS);

/** Re-slots a group to another clip format, keeping what the old outputs played where the new format has the same slots. */
function withFormat(group: SourceChannelGroup, format: ClipChannelFormat): SourceChannelGroup {
  if (group.map.format === format) return group;
  const count = FORMAT_CHANNEL_COUNT[format];
  const base = group.map.sources.find((entry) => entry >= 0) ?? 0;
  const sources = Array.from({ length: count }, (_, index) => {
    const kept = group.map.sources[index];
    if (kept !== undefined) return kept;
    return format === "mono" ? base : base + index;
  });
  return { stream: group.stream, map: { format, sources } };
}

/**
 * Modify > Audio Channels for project items: how a file's audio streams and channels group into audio clips. Each
 * audio clip is one source patch indicator (A1..An) in the Source monitor and the timeline headers; Insert / Overwrite
 * place one linked clip per enabled indicator. Presets regroup one or many items at once; a single item also gets an
 * editor for the format of each clip and which source channel feeds each of its channels. Apply is one undo step.
 */
export function SourceChannelsDialog() {
  const open = useAudioChannelsStore((state) => state.sourceOpen);
  const mediaIds = useAudioChannelsStore((state) => state.sourceMediaIds);
  const close = useAudioChannelsStore((state) => state.closeSource);
  const project = useProjectStore((state) => state.project);

  const targets = useMemo<MediaItem[]>(
    () => mediaIds.flatMap((id) => project.mediaLibrary.items.filter((item) => item.id === id && item.type !== "image")),
    [mediaIds, project.mediaLibrary.items],
  );
  const single = targets.length === 1 ? targets[0] : null;
  const shape = sourceAudioShape(single ?? targets[0]);
  const initial = useMemo(() => (single ? resolveSourceChannelGroups(single) : []), [single]);
  const [draft, setDraft] = useState<SourceChannelGroup[]>(initial);
  const [preset, setPreset] = useState<SourceLayoutPreset | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setPreset(null);
    // Re-seed when the dialog opens for a different selection, not on unrelated project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mediaIds]);

  const shownPreset = single
    ? matchSourceLayoutPreset({ ...single, channelLayout: draft })
    : preset;
  const changed = single ? !sameSourceLayout(draft, initial) : preset !== null;
  const channelOptions = Array.from({ length: shape.channels }, (_, index) => index);

  const pick = (name: SourceLayoutPreset) => {
    setPreset(name);
    if (single) setDraft(buildSourceGroups(name, shape));
  };
  const update = (index: number, next: SourceChannelGroup) => setDraft((groups) => groups.map((group, i) => (i === index ? next : group)));
  const setOutput = (index: number, output: number, source: number) =>
    update(index, { ...draft[index], map: { ...draft[index].map, sources: draft[index].map.sources.map((entry, i) => (i === output ? source : entry)) } });

  const apply = async () => {
    setBusy(true);
    try {
      const result = await setMediaChannelLayout(targets.map((item) => item.id), single ? draft : (preset ?? "file"));
      if (result.success) close();
      else toast.error("Audio channels not changed", result.error?.message ?? "The items could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const title = single ? single.name : `${targets.length} items`;
  const detail = single
    ? `${shape.streams > 1 ? `${shape.streams} audio streams x ` : ""}${shape.channels}-channel source`
    : "Presets apply to each item's own channels";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-xl gap-4 overflow-y-auto" data-testid="source-channels-dialog">
        <DialogHeader>
          <DialogTitle>Modify clip: Audio channels</DialogTitle>
          <DialogDescription className="truncate">{title} · {detail}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-fg-2" id="source-channels-preset-label">Preset</div>
          <ToggleGroup type="single" value={shownPreset ?? ""} onValueChange={(value) => { if (value) pick(value as SourceLayoutPreset); }} aria-labelledby="source-channels-preset-label" className="flex-wrap justify-start">
            {SOURCE_LAYOUT_PRESETS.map((name) => (
              <ToggleGroupItem key={name} value={name} data-testid={`source-channels-preset-${name}`} className="h-8 px-3 text-xs">{SOURCE_LAYOUT_PRESET_LABELS[name]}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-[11px] text-fg-muted" data-testid="source-channels-summary">
            {single
              ? shownPreset === null
                ? `Custom: ${draft.length} audio clip${draft.length === 1 ? "" : "s"}`
                : `${draft.length} audio clip${draft.length === 1 ? "" : "s"} on Insert / Overwrite`
              : "Use file keeps mono, stereo and 5.1 streams as one clip; wider files get one mono clip per channel."}
          </p>
        </div>

        {single && (
          <div className="space-y-2" data-testid="source-channels-groups">
            <div className="text-xs font-medium text-fg-2">Audio clips</div>
            {draft.map((group, index) => (
              <div key={index} className="space-y-1.5 rounded-md border border-border bg-bg-2 p-2" data-testid={`source-channels-group-${index}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-8 text-xs font-bold">{patchLabel(index)}</span>
                  <ToggleGroup type="single" value={group.map.format} onValueChange={(value) => { if (value) update(index, withFormat(group, value as ClipChannelFormat)); }} aria-label={`${patchLabel(index)} clip channel format`}>
                    {CLIP_CHANNEL_FORMATS.map((format) => (
                      <ToggleGroupItem key={format} value={format} data-testid={`source-channels-format-${index}-${format}`} className="h-7 px-2 text-[11px]">{format === "mono" ? "Mono" : format === "stereo" ? "Stereo" : "5.1"}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {shape.streams > 1 && (
                    <Select value={String(group.stream)} onValueChange={(value) => update(index, { ...group, stream: Number(value) })}>
                      <SelectTrigger aria-label={`${patchLabel(index)} audio stream`} data-testid={`source-channels-stream-${index}`} className="h-7 w-[104px] px-2 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: shape.streams }, (_, stream) => <SelectItem key={stream} value={String(stream)}>Stream {stream + 1}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-[11px]" disabled={draft.length <= 1} aria-label={`Remove ${patchLabel(index)}`} data-testid={`source-channels-remove-${index}`} onClick={() => setDraft((groups) => groups.filter((_, i) => i !== index))}>Remove</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.map.sources.map((entry, output) => (
                    <label key={output} className="flex items-center gap-1.5 text-[11px] text-fg-2">
                      <span className="min-w-[28px]">{FORMAT_CHANNEL_NAMES[group.map.format][output]}</span>
                      <Select value={String(entry)} onValueChange={(value) => setOutput(index, output, Number(value))}>
                        <SelectTrigger aria-label={`${patchLabel(index)} ${FORMAT_CHANNEL_NAMES[group.map.format][output]} plays`} data-testid={`source-channels-source-${index}-${output}`} className="h-7 w-[84px] px-2 text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {channelOptions.map((channel) => <SelectItem key={channel} value={String(channel)}>Ch {channel + 1}</SelectItem>)}
                          <SelectItem value={MIX}>Mix</SelectItem>
                          <SelectItem value={OFF}>Off</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={draft.length >= MAX_SOURCE_GROUPS} data-testid="source-channels-add" onClick={() => setDraft((groups) => [...groups, { stream: 0, map: { format: "mono", sources: [Math.min(groups.length, shape.channels - 1)] } }])}>Add audio clip</Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy || !changed || targets.length === 0 || (!!single && draft.length === 0)} data-testid="source-channels-apply" onClick={() => { void apply(); }}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

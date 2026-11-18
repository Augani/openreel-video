import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@openreel/ui";
import {
  MAX_MULTICAM_ANGLES,
  computeAngleOffsets,
  type AngleSyncInput,
  type MulticamSyncMethod,
  type Project,
} from "@openreel/core";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useProjectStore } from "../../stores/project-store";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { analyzeAudioOffsets, createMulticamSourceCommand } from "../../services/multicam-controller";
import { formatFrameTimecode, parseFrameTimecode } from "../../utils/frame-timecode";

type Method = Exclude<MulticamSyncMethod, "manual">;
const METHODS: { id: Method; label: string; hint: string }[] = [
  { id: "audio", label: "Audio waveform", hint: "Matches the sound of every camera against the first angle." },
  { id: "timecode", label: "Timecode", hint: "Enter each camera's start timecode (HH:MM:SS:FF)." },
  { id: "in-points", label: "In points", hint: "Uses each clip's In mark from the Source monitor, or its In point on the timeline." },
  { id: "markers", label: "Markers", hint: "Uses the first timeline marker that sits over each angle's clip." },
];
const LOW_CONFIDENCE = 0.35;

/** First timeline marker over a clip of `mediaId`, in that media's own time. */
function markerTimeFor(project: Project, mediaId: string): number | undefined {
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.mediaId !== mediaId) continue;
      const marker = project.timeline.markers
        .filter((m) => m.time >= clip.startTime && m.time <= clip.startTime + clip.duration)
        .sort((a, b) => a.time - b.time)[0];
      if (marker) return clip.inPoint + (marker.time - clip.startTime) * (clip.speed ?? 1);
    }
  }
  return undefined;
}

function timelineInPoint(project: Project, mediaId: string): number | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.mediaId === mediaId);
    if (clip) return clip.inPoint;
  }
  return undefined;
}

export function MulticamSourceDialog() {
  const open = useEditorWorkspaceStore((state) => state.multicamSourceOpen);
  const setOpen = useEditorWorkspaceStore((state) => state.setMulticamSourceOpen);
  const project = useProjectStore((state) => state.project);
  const frameRate = project.settings.frameRate;
  const videos = useMemo(() => project.mediaLibrary.items.filter((item) => item.type === "video"), [project.mediaLibrary.items]);

  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<Method>("audio");
  const [timecodes, setTimecodes] = useState<Record<string, string>>({});
  const [audioFixed, setAudioFixed] = useState(false);
  const [fixedMedia, setFixedMedia] = useState("");
  const [place, setPlace] = useState(true);
  const [analysis, setAnalysis] = useState<{ key: string; offsets: number[]; confidence: number[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Opening the dialog starts from the clips selected on the timeline.
  useEffect(() => {
    if (!open) return;
    const ids = useUIStore.getState().getSelectedClipIds();
    const mediaIds: string[] = [];
    for (const track of useProjectStore.getState().project.timeline.tracks) {
      for (const clip of track.clips) {
        if (ids.includes(clip.id) && !mediaIds.includes(clip.mediaId) && videos.some((v) => v.id === clip.mediaId)) mediaIds.push(clip.mediaId);
      }
    }
    setSelected(mediaIds.slice(0, MAX_MULTICAM_ANGLES));
    setError(null);
    setAnalysis(null);
    setBusy(null);
    // Only on open: later media imports must not reset the picked angles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectionKey = selected.join("|");
  const nameOf = (id: string) => videos.find((v) => v.id === id)?.name ?? id;
  const analysisValid = analysis?.key === selectionKey ? analysis : null;

  const preview = useMemo(() => {
    if (selected.length < 2) return { ok: false as const, message: "Choose at least two video clips." };
    const inputs: AngleSyncInput[] = selected.map((id, index) => {
      const media = videos.find((v) => v.id === id);
      const tc = timecodes[id]?.trim();
      const parsedTc = tc ? parseFrameTimecode(tc, frameRate) : null;
      const marks = useSourceMonitorStore.getState().getMarks(id);
      return {
        mediaId: id,
        audioOffset: analysisValid?.offsets[index],
        timecode: parsedTc ?? (typeof media?.metadata.startTimecode === "number" ? media.metadata.startTimecode : undefined),
        inPoint: marks.in ?? timelineInPoint(project, id),
        marker: markerTimeFor(project, id),
      };
    });
    const result = computeAngleOffsets(method, inputs);
    if (!result.ok) return result;
    return { ok: true as const, offsets: result.offsets };
  }, [selected, videos, timecodes, frameRate, analysisValid, method, project]);

  const toggle = (id: string, checked: boolean) => {
    setError(null);
    setSelected((current) => {
      if (!checked) return current.filter((x) => x !== id);
      if (current.includes(id) || current.length >= MAX_MULTICAM_ANGLES) return current;
      return [...current, id];
    });
  };

  const analyze = async () => {
    setError(null);
    setBusy("Reading audio…");
    try {
      const result = await analyzeAudioOffsets(selected, (message) => setBusy(message));
      setAnalysis({ key: selectionKey, ...result });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Audio sync failed.");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!preview.ok) return;
    setBusy("Creating…");
    const result = await createMulticamSourceCommand({
      name: name.trim() || undefined,
      syncMethod: method,
      angles: selected.map((mediaId, i) => ({ mediaId, offset: preview.offsets[i] })),
      confidence: method === "audio" ? analysisValid?.confidence : undefined,
      audio: audioFixed ? { mode: "fixed", mediaId: selected.includes(fixedMedia) ? fixedMedia : selected[0] } : { mode: "follow" },
      placeAtPlayhead: place,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    useSourceMonitorStore.getState().setTab("multicam");
    if (place) useTimelineStore.getState().seekTo(useTimelineStore.getState().playheadPosition);
  };

  const needsAnalysis = method === "audio" && !analysisValid;
  const lowest = analysisValid ? Math.min(...analysisValid.confidence.slice(1)) : 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-testid="multicam-source-dialog"
        className="flex max-h-[90dvh] w-[95vw] max-w-xl flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg-1 p-0 text-fg"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left sm:text-left">
          <DialogTitle className="text-[15px] font-semibold">Create multi-camera source</DialogTitle>
          <DialogDescription className="text-[12px] leading-5 text-fg-2">
            Sync two to {MAX_MULTICAM_ANGLES} camera clips, then cut between them live with the number keys.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="multicam-name" className="text-[11px] text-fg-2">Name</Label>
            <Input id="multicam-name" value={name} placeholder="Multicam 1" onChange={(event) => setName(event.target.value)} className="h-8 text-[12px]" />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-[11px] text-fg-2">Angles ({selected.length}/{MAX_MULTICAM_ANGLES}) · the first is the sync reference</legend>
            {videos.length === 0 ? (
              <p className="text-[12px] text-fg-3">Import video clips first.</p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-1.5" data-testid="multicam-angle-list">
                {videos.map((video) => {
                  const order = selected.indexOf(video.id);
                  return (
                    <label key={video.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-bg-2">
                      <Checkbox
                        checked={order >= 0}
                        aria-label={`Use ${video.name} as an angle`}
                        onCheckedChange={(value) => toggle(video.id, value === true)}
                      />
                      <span className="min-w-0 flex-1 truncate">{video.name}</span>
                      {order >= 0 && <span className="rounded bg-accent/20 px-1.5 text-[10px] font-bold text-accent">{order + 1}</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-[11px] text-fg-2">Synchronize by</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Sync method">
              {METHODS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={method === entry.id}
                  data-testid={`multicam-sync-${entry.id}`}
                  onClick={() => {
                    setMethod(entry.id);
                    setError(null);
                  }}
                  className={cn(
                    "h-7 rounded-md border px-2.5 text-[12px] transition-colors",
                    method === entry.id ? "border-accent bg-accent/15 text-fg" : "border-border text-fg-2 hover:bg-bg-2",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-fg-3">{METHODS.find((entry) => entry.id === method)?.hint}</p>
          </fieldset>

          {method === "timecode" && selected.length > 0 && (
            <div className="space-y-1.5" data-testid="multicam-timecode-inputs">
              {selected.map((id, index) => (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-5 text-center text-[10px] font-bold text-accent">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{nameOf(id)}</span>
                  <Input
                    aria-label={`Start timecode of ${nameOf(id)}`}
                    value={timecodes[id] ?? ""}
                    placeholder={formatFrameTimecode(0, frameRate)}
                    onChange={(event) => setTimecodes((current) => ({ ...current, [id]: event.target.value }))}
                    className="h-7 w-[110px] font-mono text-[11px]"
                  />
                </div>
              ))}
            </div>
          )}

          {method === "audio" && selected.length >= 2 && (
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" data-testid="multicam-analyze" disabled={busy !== null} onClick={() => void analyze()}>
                {analysisValid ? "Re-analyze audio" : "Analyze audio"}
              </Button>
              {busy && <span role="status" className="text-[11px] text-fg-3">{busy}</span>}
            </div>
          )}

          {preview.ok && !needsAnalysis && (
            <table className="w-full text-[11px]" data-testid="multicam-offsets">
              <thead>
                <tr className="text-left text-fg-3">
                  <th className="w-6 font-medium">#</th>
                  <th className="font-medium">Angle</th>
                  <th className="text-right font-medium">Offset</th>
                  {method === "audio" && <th className="text-right font-medium">Match</th>}
                </tr>
              </thead>
              <tbody>
                {selected.map((id, index) => (
                  <tr key={id} data-testid="multicam-offset-row">
                    <td className="text-accent">{index + 1}</td>
                    <td className="max-w-0 truncate pr-2">{nameOf(id)}</td>
                    <td className="text-right font-mono tabular-nums" data-offset={preview.offsets[index]}>
                      {preview.offsets[index].toFixed(3)} s · {Math.round(preview.offsets[index] * frameRate)} f
                    </td>
                    {method === "audio" && (
                      <td className={cn("text-right tabular-nums", (analysisValid?.confidence[index] ?? 1) < LOW_CONFIDENCE && "text-status-error")}>
                        {Math.round((analysisValid?.confidence[index] ?? 0) * 100)}%
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {method === "audio" && analysisValid && lowest < LOW_CONFIDENCE && (
            <p className="text-[11px] text-status-error" role="alert">
              One angle matched weakly. Check that the cameras recorded the same sound, or pick another sync method.
            </p>
          )}
          {!preview.ok && selected.length >= 2 && !needsAnalysis && (
            <p className="text-[11px] text-status-error" role="alert">{preview.message}</p>
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-[11px] text-fg-2">Audio</legend>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <label className="flex items-center gap-1.5">
                <Checkbox checked={audioFixed} aria-label="Use a fixed audio angle" onCheckedChange={(value) => setAudioFixed(value === true)} />
                Fixed audio angle
              </label>
              {audioFixed && (
                <Select value={selected.includes(fixedMedia) ? fixedMedia : selected[0] || ""} onValueChange={setFixedMedia}>
                  <SelectTrigger aria-label="Audio angle" className="h-7 w-[200px] px-2 text-[11px]">
                    <SelectValue placeholder="Choose angle" />
                  </SelectTrigger>
                  <SelectContent>
                    {selected.map((id, index) => (
                      <SelectItem key={id} value={id}>
                        {index + 1} {nameOf(id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!audioFixed && <span className="text-fg-3">Audio follows the active video angle.</span>}
            </div>
          </fieldset>

          <label className="flex items-center gap-1.5 text-[12px]">
            <Checkbox checked={place} aria-label="Place on the timeline at the playhead" onCheckedChange={(value) => setPlace(value === true)} />
            Place on the timeline at the playhead
          </label>
          {error && <p className="text-[12px] text-status-error" role="alert" data-testid="multicam-error">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            data-testid="multicam-create"
            disabled={busy !== null || !preview.ok || needsAnalysis}
            onClick={() => void create()}
          >
            Create source
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

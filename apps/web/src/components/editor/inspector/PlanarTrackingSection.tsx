import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle, Button, Card, Label, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from "@openreel/ui";
import { AlertTriangle, Check, Target, X } from "@/icons/lucide-compat";
import { planarCornersAt, type PlanarTrackData, type TrackingData } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { getPlanarTrackBridge, type PlanarTrackRange, type PlanarTrackState } from "../../../bridges/planar-track-bridge";
import { applyPlanarTrack, readPlanarTrackAnalysis, readPlanarTrackApplication, removePlanarTrack } from "../../../services/planar-track-edit";
import { defaultPlanarCorners, usePlanarTrackOverlayStore } from "../../../stores/planar-track-overlay-store";
import { PropertySlider } from "./shell/PropertySlider";
import { RegionInput } from "./MotionTrackingSection";
import { MotionTrackQualityStrip } from "./MotionTrackQualityStrip";

const IDLE: PlanarTrackState = { isTracking: false, progress: 0, lostFrames: 0, error: null, clipId: null };
const CORNERS = ["Top left", "Top right", "Bottom right", "Bottom left"];
const THRESHOLD = 0.5;

/** The planar path shaped as a point track so the shared quality strip can draw it. */
function asQualityData(data: PlanarTrackData): TrackingData {
  return { trackId: data.trackId, clipId: data.clipId, frameRate: data.frameRate, region: { x: 0, y: 0, width: 1, height: 1 }, confidence: data.confidence,
    lostFrames: data.lostFrames, manualFrames: data.manualFrames, keyframes: data.keyframes.map(k => ({ frame: k.frame, position: { x: k.corners[0], y: k.corners[1] } })) };
}

export function PlanarTrackingSection({ clipId }: { clipId: string }) {
  const projectId = useProjectStore(state => state.project.id);
  return <PlanarTrackingControls key={`${projectId}:${clipId}`} clipId={clipId} />;
}

function PlanarTrackingControls({ clipId }: { clipId: string }) {
  const project = useProjectStore(state => state.project);
  const exporting = useUIStore(state => state.exportState.isExporting);
  const playbackLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const source = project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === clipId);
  const sourceTrack = project.timeline.tracks.find(track => track.id === source?.trackId);
  const media = project.mediaLibrary.items.find(item => item.id === source?.mediaId);
  const width = media?.metadata.width ?? project.settings.width, height = media?.metadata.height ?? project.settings.height;
  const fps = project.settings.frameRate;
  const frameCount = Math.max(1, Math.ceil((source?.duration ?? 0) * fps));
  const frame = useTimelineStore(state => Math.max(0, Math.min(frameCount - 1, Math.round((state.playheadPosition - (source?.startTime ?? 0)) * fps))));
  const bridge = getPlanarTrackBridge();
  const analysis = readPlanarTrackAnalysis(clipId), data = analysis?.data ?? null;
  const [state, setState] = useState(IDLE);
  const [corners, setCorners] = useState<number[]>(() => (data ? planarCornersAt(data, frame)?.corners : null) ?? data?.anchorCorners ?? defaultPlanarCorners(width, height));
  const [range, setRange] = useState<PlanarTrackRange>("clip");
  const [smoothing, setSmoothing] = useState(0);
  const [targetId, setTargetId] = useState<string>("");
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const alive = useRef(true), owned = useRef(false);
  const choices = useMemo(() => project.timeline.tracks.filter(track => track.type !== "audio").flatMap(track => track.clips
    .filter(clip => clip.id !== clipId && project.mediaLibrary.items.find(item => item.id === clip.mediaId)?.type !== "audio")
    .map(clip => ({ id: clip.id, label: `${project.mediaLibrary.items.find(item => item.id === clip.mediaId)?.name ?? track.name} · ${track.name}`, locked: track.locked }))), [project, clipId]);
  const pinned = choices.find(choice => readPlanarTrackApplication(choice.id)?.sourceClipId === clipId)?.id;
  const target = targetId || pinned || choices[0]?.id || "";
  const application = target ? readPlanarTrackApplication(target) : null;
  const applied = application?.sourceClipId === clipId;
  const targetLocked = !choices.find(choice => choice.id === target) || Boolean(choices.find(choice => choice.id === target)?.locked);
  const disabled = !source || Boolean(sourceTrack?.locked) || exporting || busy || playbackLocked;

  useEffect(() => {
    alive.current = true;
    const unsubscribe = bridge.subscribe(snapshot => { if (snapshot.clipId === clipId || !snapshot.isTracking) setState(snapshot); });
    return () => { alive.current = false; unsubscribe(); if (owned.current) bridge.cancel(); };
  }, [bridge, clipId]);

  // Show the tracked corners of the playhead frame; with no track the corners are a draft the user places.
  const trackedAt = data ? planarCornersAt(data, frame) : null;
  const trackedKey = trackedAt ? trackedAt.corners.join(",") : "";
  useEffect(() => { if (trackedAt) setCorners(trackedAt.corners.map(v => Math.round(v * 10) / 10)); }, [trackedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlay = usePlanarTrackOverlayStore;
  useEffect(() => {
    overlay.getState().open({ clipId, corners, mediaWidth: width, mediaHeight: height });
    return () => overlay.getState().close(clipId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once per clip; later changes are mirrored below
  }, [clipId, width, height]);
  useEffect(() => { overlay.getState().mirror(clipId, corners); }, [clipId, corners, overlay]);
  const dragRevision = overlay(s => (s.clipId === clipId ? s.editRevision : 0));
  useEffect(() => {
    const dragged = overlay.getState();
    if (dragRevision > 0 && dragged.clipId === clipId && dragged.corners) setCorners(previous => (previous.every((v, i) => v === dragged.corners![i]) ? previous : [...dragged.corners!]));
  }, [dragRevision, clipId, overlay]);

  const run = async (direction: PlanarTrackRange, merge: boolean) => {
    if (disabled || state.isTracking) return;
    setError(null); owned.current = true;
    try { await bridge.track({ clipId, corners, anchorFrame: frame, range: direction, confidenceThreshold: THRESHOLD, merge }); }
    catch (failure) { if (alive.current && !(failure instanceof Error && /cancelled/.test(failure.message))) setError(failure instanceof Error ? failure.message : "Tracking failed"); }
    finally { owned.current = false; }
  };
  const guarded = async (action: () => Promise<unknown>, fallback: string) => {
    if (disabled) return;
    setError(null); setBusy(true);
    try { await action(); } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : fallback); } finally { if (alive.current) setBusy(false); }
  };

  return <div className="min-w-0 space-y-3" data-testid="planar-tracking">
    <Card className="flex items-center gap-2 rounded-md border-primary/30 bg-primary/10 p-2 shadow-none">
      <Target size={16} className="shrink-0 text-primary" aria-hidden /><div className="min-w-0"><p className="text-xs font-medium">Planar Tracking</p><p className="text-[10px] text-fg-2">Track a flat surface by its four corners and pin a clip to it.</p></div>
    </Card>
    <fieldset disabled={disabled || state.isTracking} className="min-w-0 space-y-3">
      <p className="text-[11px] text-fg-2">Drag the corners on the Program monitor onto the surface at frame {frame}, or type them (source pixels, {width} × {height}).</p>
      <div className="grid grid-cols-2 gap-2">
        {CORNERS.map((name, i) => <div key={name} className="contents">
          <RegionInput label={`${name} X`} value={Math.round(corners[i * 2] * 10) / 10} min={0} max={width} onChange={v => setCorners(c => c.map((n, j) => j === i * 2 ? v : n))} />
          <RegionInput label={`${name} Y`} value={Math.round(corners[i * 2 + 1] * 10) / 10} min={0} max={height} onChange={v => setCorners(c => c.map((n, j) => j === i * 2 + 1 ? v : n))} />
        </div>)}
      </div>
      <Button type="button" variant="outline" className="h-[30px] w-full text-xs" onClick={() => setCorners(defaultPlanarCorners(width, height))}>Reset corners</Button>
      <div className="space-y-1.5"><Label className="text-xs">Track</Label>
        <ToggleGroup type="single" value={range} onValueChange={value => { if (value) setRange(value as PlanarTrackRange); }} aria-label="Planar tracking range" className="grid grid-cols-3 gap-1">
          <ToggleGroupItem value="clip" className="h-[30px] px-1 text-[11px]">Whole clip</ToggleGroupItem>
          <ToggleGroupItem value="forward" className="h-[30px] px-1 text-[11px]">Forward ▸</ToggleGroupItem>
          <ToggleGroupItem value="backward" className="h-[30px] px-1 text-[11px]">◂ Backward</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Button type="button" className="h-8 w-full text-xs" onClick={() => void run(range, Boolean(data) && range !== "clip")}><Target size={14} aria-hidden />{data ? "Re-track Surface" : "Start Tracking"}</Button>
    </fieldset>
    {state.isTracking && <div role="status" className="space-y-2 rounded-md bg-bg-2 p-3" data-testid="planar-track-progress">
      <div className="flex items-center justify-between gap-2"><p className="text-xs">Tracking in Progress · {Math.round(state.progress)}%</p><Button variant="ghost" size="icon-sm" aria-label="Cancel Planar Tracking" onClick={() => bridge.cancel()}><X size={14} aria-hidden /></Button></div>
      <Progress value={state.progress} aria-label="Planar tracking progress" />
      {state.lostFrames > 0 && <p className="text-[11px] text-amber-400">Lost the surface on {state.lostFrames} frame(s)</p>}
    </div>}
    {(error || state.error) && <Alert variant="destructive"><AlertTriangle size={14} aria-hidden /><AlertTitle>Tracking Failed</AlertTitle><AlertDescription>{error ?? state.error}</AlertDescription></Alert>}
    {data && !state.isTracking && <div className="space-y-3">
      <div role="status" className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 p-2" data-testid="planar-track-complete"><Check size={14} className="text-primary" aria-hidden /><p className="text-xs">Tracking Complete · {data.keyframes.length} frames{data.lostFrames.length ? ` · ${data.lostFrames.length} low confidence` : ""}</p></div>
      <MotionTrackQualityStrip data={asQualityData(data)} frameCount={frameCount} selectedFrame={frame} threshold={THRESHOLD} onSelect={next => useTimelineStore.getState().seekTo((source?.startTime ?? 0) + next / fps)} />
      <div className="space-y-2 rounded-md bg-bg-2 p-2">
        <p className="text-[11px]" data-testid="planar-track-frame-info">Frame {frame}{trackedAt ? ` · ${Math.round(trackedAt.confidence * 100)}% · ${trackedAt.manual ? "set by hand" : trackedAt.exact ? "tracked" : "between samples"}` : ""}</p>
        <Button type="button" className="h-[30px] w-full text-[11px]" disabled={disabled} onClick={() => void guarded(() => bridge.correctFrame(clipId, frame, corners), "Could not set corners")}>Set corners at this frame</Button>
        <div className="grid grid-cols-2 gap-1">
          <Button type="button" variant="outline" className="h-[30px] px-1 text-[11px]" disabled={disabled} onClick={() => void run("forward", true)}>Re-track from here</Button>
          <Button type="button" variant="outline" className="h-[30px] px-1 text-[11px]" disabled={disabled} onClick={() => void run("backward", true)}>Re-track backward</Button>
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <div className="space-y-1.5"><Label className="text-xs">Pin clip</Label>
          <Select value={target} onValueChange={setTargetId} disabled={disabled || !choices.length}>
            <SelectTrigger aria-label="Corner pin target" className="h-[30px] min-w-0 text-xs"><SelectValue placeholder="No other clip to pin" /></SelectTrigger>
            <SelectContent>{choices.map(choice => <SelectItem key={choice.id} value={choice.id} disabled={choice.locked}>{choice.label}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-[10px] text-fg-2">Adds a Corner Pin effect to the clip, keyframed to the surface. It maps the clip&apos;s frame, so a full-frame graphic fits best.</p>
        </div>
        <PropertySlider label="Path Smoothing" min={0} max={10} step={1} value={smoothing} onChange={setSmoothing} isDisabled={disabled || targetLocked} />
        <Button type="button" className="h-8 w-full text-xs" disabled={disabled || targetLocked} onClick={() => void guarded(() => applyPlanarTrack(clipId, target, { smoothing }), "Could not pin the clip")}>{busy ? "Applying…" : applied ? "Update Pin" : "Pin Clip to Surface"}</Button>
        {applied && <Button type="button" variant="outline" className="h-[30px] w-full text-xs" disabled={disabled || targetLocked} onClick={() => void guarded(() => removePlanarTrack(target), "Could not remove the pin")}>Remove Pin</Button>}
      </div>
    </div>}
  </div>;
}

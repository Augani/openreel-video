import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Alert, AlertDescription, AlertTitle, Button, Card, Checkbox,
  Collapsible, CollapsibleContent, CollapsibleTrigger, Input, Label,
  Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  ToggleGroup, ToggleGroupItem,
} from "@openreel/ui";
import { AlertTriangle, Check, ChevronRight, Target, X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { getMotionTrackingBridge, type MotionTrackingState } from "../../../bridges/motion-tracking-bridge";
import { TRACKING_APPLICATION, getMotionTrackingTarget, readMotionTrackingAnalysis, readMotionTrackingApplication } from "../../../services/motion-tracking-edit";
import { PropertySlider } from "./shell/PropertySlider";
import { useNumericDraft } from "./shell/useNumericDraft";
import { trackingPointAt, type Rectangle } from "@openreel/core";
import { MotionTrackQualityStrip } from "./MotionTrackQualityStrip";
import { useMotionTrackingOverlayStore } from "../../../stores/motion-tracking-overlay-store";

const EMPTY_STATE: MotionTrackingState = { isTracking: false, progress: 0, currentJob: null, trackingData: null, lostFrames: [], error: null };
const ALGORITHMS = [
  { id: "correlation", name: "Correlation", description: "Match textured patches between frames" },
  { id: "optical-flow", name: "Optical Flow", description: "Measure local pixel motion" },
  { id: "feature", name: "Feature Match", description: "Follow distinct visual corners" },
] as const;

export function RegionInput({ label, value, onChange, min, max, disabled }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; disabled?: boolean;
}) {
  const id = useId();
  const input = useNumericDraft({ value, onChange, min, max, step: 1, live: false });
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id} className="text-xs font-medium text-fg-2">{label}</Label>
    <Input {...input} id={id} type="text" inputMode="decimal" role="spinbutton" aria-valuenow={value}
      aria-valuemin={min} aria-valuemax={max} disabled={disabled}
      className="h-[30px] min-w-0 rounded-md bg-bg-2 px-2 text-xs md:text-xs" />
  </div>;
}

function TrackingCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <div className="flex min-w-0 items-center gap-2"><Checkbox id={id} checked={checked} onCheckedChange={value => onChange(value === true)} /><Label htmlFor={id} className="text-xs">{label}</Label></div>;
}

export function MotionTrackingSection({ clipId }: { clipId: string }) {
  const projectId = useProjectStore(state => state.project.id);
  return <MotionTrackingControls key={`${projectId}:${clipId}`} clipId={clipId} />;
}

function MotionTrackingControls({ clipId }: { clipId: string }) {
  const project = useProjectStore(state => state.project);
  const exporting = useUIStore(state => state.exportState.isExporting);
  const applyingEffect = useUIStore(state => state.effectApplicationClipId !== null);
  const playbackLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const source = project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === clipId);
  const sourceTrack = project.timeline.tracks.find(track => track.id === source?.trackId);
  const media = project.mediaLibrary.items.find(item => item.id === source?.mediaId);
  const width = media?.metadata.width ?? project.settings.width, height = media?.metadata.height ?? project.settings.height;
  const bridge = getMotionTrackingBridge();
  const analysis = readMotionTrackingAnalysis(clipId);
  const [state, setState] = useState(EMPTY_STATE);
  const [region, setRegion] = useState<Rectangle>(() => analysis?.data.region ? { ...analysis.data.region } : { x: Math.round(width / 4), y: Math.round(height / 4), width: Math.round(width / 2), height: Math.round(height / 2) });
  const [algorithm, setAlgorithm] = useState<"correlation" | "optical-flow" | "feature">("correlation");
  const [confidenceThreshold, setConfidenceThreshold] = useState(70);
  const [smoothing, setSmoothing] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [range, setRange] = useState<"clip" | "forward" | "backward">("clip");
  const fps = project.settings.frameRate;
  const frameCount = Math.max(1, Math.ceil((source?.duration ?? 0) * fps));
  // Select the frame number, not the playhead seconds, so playback does not re-render the inspector every tick.
  const frame = useTimelineStore(state => Math.max(0, Math.min(frameCount - 1, Math.round((state.playheadPosition - (source?.startTime ?? 0)) * fps))));
  const [fixX, setFixX] = useState<number | null>(null), [fixY, setFixY] = useState<number | null>(null);
  const [targetId, setTargetId] = useState(() => {
    const clips = [...project.timeline.tracks.flatMap(track => track.clips),
      ...(project.textClips ?? []), ...(project.shapeClips ?? []),
      ...(project.svgClips ?? []), ...(project.stickerClips ?? [])];
    return clips.find(candidate => {
      const saved = candidate.metadata?.[TRACKING_APPLICATION] as { version?: number; sourceClipId?: string; generatedIds?: unknown; replacedKeys?: unknown } | undefined;
      return saved?.version === 1 && saved.sourceClipId === clipId
        && Array.isArray(saved.generatedIds) && Array.isArray(saved.replacedKeys);
    })?.id ?? clipId;
  });
  const [offsetX, setOffsetX] = useState(0), [offsetY, setOffsetY] = useState(0);
  const [applyScale, setApplyScale] = useState(true), [applyRotation, setApplyRotation] = useState(true);
  const [mode, setMode] = useState<"follow" | "pin">("follow");
  const [error, setError] = useState<string | null>(null), [applying, setApplying] = useState(false);
  useEffect(() => { setFixX(null); setFixY(null); }, [frame, clipId]);
  const ownedJob = useRef(false);
  const alive = useRef(true);
  const data = analysis?.data ?? null;
  const application = readMotionTrackingApplication(targetId);
  const applied = application?.sourceClipId === clipId;
  const target = getMotionTrackingTarget(project, targetId);
  const disabled = !source || Boolean(sourceTrack?.locked) || exporting || applying || applyingEffect || playbackLocked;
  const targetLocked = !target || Boolean(project.timeline.tracks.find(track => track.id === target.clip.trackId)?.locked);
  const choices = [
    ...project.timeline.tracks.filter(track => track.type !== "audio").flatMap(track => track.clips.filter(clip => project.mediaLibrary.items.find(item => item.id === clip.mediaId)?.type !== "audio").map(clip => ({ id: clip.id, label: project.mediaLibrary.items.find(item => item.id === clip.mediaId)?.name ?? track.name, locked: track.locked }))),
    ...(project.textClips ?? []).map(clip => ({ id: clip.id, label: `Title · ${clip.text}`, locked: project.timeline.tracks.find(track => track.id === clip.trackId)?.locked })),
    ...(project.shapeClips ?? []).map(clip => ({ id: clip.id, label: `Shape · ${clip.shapeType}`, locked: project.timeline.tracks.find(track => track.id === clip.trackId)?.locked })),
    ...(project.svgClips ?? []).map(clip => ({ id: clip.id, label: "SVG", locked: project.timeline.tracks.find(track => track.id === clip.trackId)?.locked })),
    ...(project.stickerClips ?? []).map(clip => ({ id: clip.id, label: "Sticker", locked: project.timeline.tracks.find(track => track.id === clip.trackId)?.locked })),
  ];
  useEffect(() => {
    alive.current = true;
    const unsubscribe = bridge.subscribe(snapshot => {
      if (snapshot.currentJob?.clipId === clipId || (ownedJob.current && !snapshot.currentJob)) {
        setState(snapshot);
        if (!snapshot.isTracking) ownedJob.current = false;
      }
    });
    return () => {
      alive.current = false;
      unsubscribe();
      const current = bridge.getState();
      if (ownedJob.current && current.isTracking && (!current.currentJob || current.currentJob.clipId === clipId)) bridge.cancelTracking();
    };
  }, [bridge, clipId]);
  useEffect(() => {
    const options = readMotionTrackingApplication(targetId)?.options;
    if (options) { setOffsetX(options.offset.x); setOffsetY(options.offset.y); setApplyScale(options.applyScale); setApplyRotation(options.applyRotation); setSmoothing(options.smoothing); setMode(options.mode); }
  }, [targetId]);
  const start = useCallback(async () => {
    if (disabled || state.isTracking) return;
    setError(null); ownedJob.current = true;
    try {
      await bridge.startTracking(clipId, region, {
        algorithm, confidenceThreshold: confidenceThreshold / 100,
        ...(range === "clip" ? {} : { anchorFrame: frame, direction: range === "backward" ? "backward" as const : "forward" as const, merge: Boolean(readMotionTrackingAnalysis(clipId)) }),
      });
    }
    catch (failure) { ownedJob.current = false; if (alive.current) setError(failure instanceof Error ? failure.message : "Tracking failed"); }
  }, [disabled, state.isTracking, bridge, clipId, region, algorithm, confidenceThreshold, range, frame]);
  const here = data ? trackingPointAt(data, frame) : null;
  // The Program monitor shows this same region as a draggable box (see MotionTrackingOverlay): open it while this
  // section is on screen, mirror the numeric fields into it, and take its drags back into the fields.
  const overlay = useMotionTrackingOverlayStore;
  useEffect(() => {
    const analysisScale = Math.min(1, 480 / Math.max(width, height, 1));
    overlay.getState().open({ clipId, region, mediaWidth: width, mediaHeight: height, searchMargin: Math.round(16 / analysisScale) });
    return () => overlay.getState().close(clipId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once per clip; later region changes are mirrored below
  }, [clipId, width, height]);
  useEffect(() => { overlay.getState().mirror(clipId, region); }, [clipId, region, overlay]);
  const dragRevision = overlay(state => (state.clipId === clipId ? state.editRevision : 0));
  useEffect(() => {
    const dragged = overlay.getState();
    if (dragRevision > 0 && dragged.clipId === clipId && dragged.region) setRegion(previous => (
      previous.x === dragged.region!.x && previous.y === dragged.region!.y && previous.width === dragged.region!.width && previous.height === dragged.region!.height ? previous : { ...dragged.region! }));
  }, [dragRevision, clipId, overlay]);
  const herePosition = here?.position;
  useEffect(() => { overlay.getState().setPoint(clipId, herePosition ? { x: herePosition.x, y: herePosition.y } : null); }, [clipId, herePosition?.x, herePosition?.y, overlay]); // eslint-disable-line react-hooks/exhaustive-deps
  const retrack = async (direction: "forward" | "backward") => {
    if (disabled || !data || !here) return;
    const keyAt = data.keyframes.reduce((best, key) => Math.abs(key.frame - frame) < Math.abs(best.frame - frame) ? key : best, data.keyframes[0]);
    const ratio = (keyAt.scale ?? 1) / (data.keyframes[0].scale ?? 1);
    const width = data.region.width * ratio, height = data.region.height * ratio;
    setError(null); ownedJob.current = true;
    try { await bridge.startTracking(clipId, { x: here.position.x - width / 2, y: here.position.y - height / 2, width, height }, { algorithm, confidenceThreshold: confidenceThreshold / 100, anchorFrame: frame, direction, merge: true }); }
    catch (failure) { ownedJob.current = false; if (alive.current) setError(failure instanceof Error ? failure.message : "Tracking failed"); }
  };
  const correct = async () => {
    if (disabled || !here) return;
    setError(null); setApplying(true);
    try { await bridge.correctPoint(clipId, frame, { x: fixX ?? here.position.x, y: fixY ?? here.position.y }); setFixX(null); setFixY(null); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Could not correct the point"); }
    finally { if (alive.current) setApplying(false); }
  };
  const apply = async () => {
    if (disabled || targetLocked) return;
    setError(null); setApplying(true);
    try { await bridge.applyTrackingToClip(clipId, { x: offsetX, y: offsetY }, targetId, { applyScale, applyRotation, smoothing, mode }); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Could not apply tracking"); }
    finally { if (alive.current) setApplying(false); }
  };
  const remove = async () => {
    if (disabled || targetLocked) return;
    setError(null); setApplying(true);
    try { await bridge.removeAttachment(targetId); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Could not remove tracking"); }
    finally { if (alive.current) setApplying(false); }
  };

  return <div className="min-w-0 space-y-3">
    <Card className="flex items-center gap-2 rounded-md border-primary/30 bg-primary/10 p-2 shadow-none">
      <Target size={16} className="shrink-0 text-primary" aria-hidden /><div className="min-w-0"><p className="text-xs font-medium">Motion Tracking</p><p className="text-[10px] text-fg-2">Follow a region and attach clips or graphics.</p></div>
    </Card>
    <fieldset disabled={disabled || state.isTracking} className="min-w-0 space-y-3">
      <p className="text-[11px] text-fg-2">Source pixels · {width} × {height} · {Math.max(1, Math.ceil((source?.duration ?? 0) * project.settings.frameRate))} frames at {project.settings.frameRate} fps</p>
      <div className="grid grid-cols-2 gap-2">
        <RegionInput label="X Position" value={region.x} min={0} max={Math.max(0, width - 1)} onChange={x => setRegion(previous => ({ ...previous, x }))} />
        <RegionInput label="Y Position" value={region.y} min={0} max={Math.max(0, height - 1)} onChange={y => setRegion(previous => ({ ...previous, y }))} />
        <RegionInput label="Width" value={region.width} min={1} max={width} onChange={value => setRegion(previous => ({ ...previous, width: value }))} />
        <RegionInput label="Height" value={region.height} min={1} max={height} onChange={value => setRegion(previous => ({ ...previous, height: value }))} />
      </div>
      <Collapsible open={advanced} onOpenChange={setAdvanced}>
        <CollapsibleTrigger asChild><Button variant="ghost" className="h-[30px] w-full justify-start px-1 text-xs"><ChevronRight size={12} className={advanced ? "rotate-90" : ""} aria-hidden />Advanced Options</Button></CollapsibleTrigger>
        <div inert={!advanced} aria-hidden={!advanced}><CollapsibleContent><Card className="space-y-3 rounded-md bg-bg-2 p-3 shadow-none">
          <div className="space-y-1.5"><Label className="text-xs">Algorithm</Label>
            <Select value={algorithm} onValueChange={value => setAlgorithm(value as typeof algorithm)}>
              <SelectTrigger aria-label="Tracking algorithm" className="h-[30px] min-w-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ALGORITHMS.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select><p className="text-[10px] text-fg-2">{ALGORITHMS.find(item => item.id === algorithm)?.description}</p>
          </div>
          <PropertySlider label="Confidence Threshold" min={30} max={95} step={5} value={confidenceThreshold} onChange={setConfidenceThreshold} formatValue={value => `${value}%`} isDisabled={disabled || state.isTracking} />
        </Card></CollapsibleContent></div>
      </Collapsible>
      <div className="space-y-1.5"><Label className="text-xs">Track</Label>
        <ToggleGroup type="single" value={range} onValueChange={value => { if (value) setRange(value as typeof range); }} aria-label="Tracking range" className="grid grid-cols-3 gap-1">
          <ToggleGroupItem value="clip" className="h-[30px] px-1 text-[11px]">Whole clip</ToggleGroupItem>
          <ToggleGroupItem value="forward" className="h-[30px] px-1 text-[11px]">Forward ▸</ToggleGroupItem>
          <ToggleGroupItem value="backward" className="h-[30px] px-1 text-[11px]">◂ Backward</ToggleGroupItem>
        </ToggleGroup>
        {range !== "clip" && <p className="text-[10px] text-fg-2">The region above is the target at frame {frame} (playhead).</p>}
      </div>
      <Button type="button" onClick={start} disabled={disabled || state.isTracking} className="h-8 w-full text-xs"><Target size={14} aria-hidden />{data ? "Re-track with Different Settings" : "Start Tracking"}</Button>
    </fieldset>
    {state.isTracking && <div role="status" className="space-y-2 rounded-md bg-bg-2 p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs">Tracking in Progress · {Math.round(state.progress)}%</p><Button variant="ghost" size="icon-sm" aria-label="Cancel Tracking" onClick={() => bridge.cancelTracking()}><X size={14} aria-hidden /></Button></div>
      <Progress value={state.progress} aria-label="Tracking progress" />
      {state.lostFrames.length > 0 && <p className="text-[11px] text-amber-400">Lost tracking on {state.lostFrames.length} frame(s)</p>}
    </div>}
    {(error || state.error) && <Alert variant="destructive"><AlertTriangle size={14} aria-hidden /><AlertTitle>Tracking Failed</AlertTitle><AlertDescription>{error ?? state.error}</AlertDescription></Alert>}
    {data && !state.isTracking && <div className="space-y-3">
      <div role="status" className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 p-2"><Check size={14} className="text-primary" aria-hidden /><p className="text-xs">Tracking Complete · {data.keyframes.length} samples{data.lostFrames.length ? ` · ${data.lostFrames.length} frames lost` : ""}</p></div>
      {data.stats && <p className="text-[10px] text-fg-2" data-testid="motion-track-stats">Tracked {data.stats.frames} frames in {(data.stats.elapsedMs / 1000).toFixed(1)} s · {data.stats.framesPerSecond.toFixed(0)} frames/s</p>}
      <MotionTrackQualityStrip data={data} frameCount={frameCount} selectedFrame={frame} threshold={confidenceThreshold / 100}
        onSelect={next => useTimelineStore.getState().seekTo((source?.startTime ?? 0) + next / fps)} />
      {here && <div className="space-y-2 rounded-md bg-bg-2 p-2" data-testid="motion-track-frame">
        <p className="text-[11px]" data-testid="motion-track-frame-info">Frame {frame} · {Math.round(here.confidence * 100)}% · {here.state === "predicted" ? "target hidden, position predicted" : here.exact ? "tracked" : "between samples"}</p>
        <div className="grid grid-cols-2 gap-1">
          <Button type="button" variant="outline" className="h-[30px] px-1 text-[11px]" disabled={disabled} onClick={() => void retrack("forward")}>Re-track from here</Button>
          <Button type="button" variant="outline" className="h-[30px] px-1 text-[11px]" disabled={disabled} onClick={() => void retrack("backward")}>Re-track backward</Button>
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <RegionInput label="Point X" value={Math.round((fixX ?? here.position.x) * 10) / 10} onChange={setFixX} disabled={disabled} />
          <RegionInput label="Point Y" value={Math.round((fixY ?? here.position.y) * 10) / 10} onChange={setFixY} disabled={disabled} />
          <Button type="button" className="h-[30px] px-2 text-[11px]" disabled={disabled} onClick={() => void correct()}>Set point</Button>
        </div>
      </div>}
      <div className="min-w-0 space-y-3">
        <div className="space-y-1.5"><Label className="text-xs">Apply to</Label><Select value={targetId} onValueChange={setTargetId} disabled={disabled}>
          <SelectTrigger aria-label="Tracking target" className="h-[30px] min-w-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{choices.map(choice => <SelectItem key={choice.id} value={choice.id} disabled={choice.locked}>{choice.label}</SelectItem>)}</SelectContent>
        </Select></div>
        <fieldset disabled={disabled || targetLocked} className="min-w-0 space-y-3">
        <ToggleGroup type="single" value={mode} onValueChange={value => { if (value) setMode(value as typeof mode); }} aria-label="Tracking alignment" className="grid grid-cols-2 gap-1">
          <ToggleGroupItem value="follow" className="h-[30px] text-xs">Follow motion</ToggleGroupItem><ToggleGroupItem value="pin" className="h-[30px] text-xs">Pin to object</ToggleGroupItem>
        </ToggleGroup>
        <div className="grid grid-cols-2 gap-2"><RegionInput label="X Offset" value={offsetX} onChange={setOffsetX} /><RegionInput label="Y Offset" value={offsetY} onChange={setOffsetY} /></div>
        <div className="grid grid-cols-2 gap-2"><TrackingCheckbox label="Scale" checked={applyScale} onChange={setApplyScale} /><TrackingCheckbox label="Rotation" checked={applyRotation} onChange={setApplyRotation} /></div>
        <PropertySlider label="Path Smoothing" min={0} max={10} step={1} value={smoothing} onChange={setSmoothing} isDisabled={disabled || targetLocked} />
        <Button type="button" className="h-8 w-full text-xs" disabled={disabled || targetLocked} onClick={apply}>{applying ? "Applying…" : applied ? "Update Tracking" : "Apply Tracking to Clip"}</Button>
        {applied && <Button type="button" variant="outline" className="h-[30px] w-full text-xs" onClick={remove} disabled={disabled || targetLocked}>Remove Tracking</Button>}
        </fieldset>
      </div>
    </div>}
  </div>;
}


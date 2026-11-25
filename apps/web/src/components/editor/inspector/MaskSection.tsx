import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button, Card, Collapsible, CollapsibleContent, CollapsibleTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem, cn } from "@openreel/ui";
import { Square, Circle, Pentagon, Pen, Layers, Trash2, Eye, EyeOff, ChevronRight, Copy, RefreshCw, Plus, Minus, type LucideIcon } from "@/icons/lucide-compat";
import type { Mask } from "@openreel/core";
import { MASK_COMBINE_MODES, type MaskCombineMode } from "@openreel/core/video/mask-engine";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import { createEditorMask, duplicateEditorMask, editClipMasks, maskSources, type EditorMaskKind } from "../../../services/clip-masks";
import { PropertySlider } from "./shell/PropertySlider";
import { MaskPathTools, MaskPenLauncher } from "./MaskPenControls";
import { useNumericDraft } from "./shell/useNumericDraft";
import { MaskRemoveObjectControls, MaskTargetToggle, MaskTrackingControls } from "./ObjectMaskControls";

const SHAPES: Array<{ kind: EditorMaskKind; label: string; name: string; icon: LucideIcon }> = [
  { kind: "rectangle", label: "Rectangle", name: "Rectangle", icon: Square },
  { kind: "ellipse", label: "Ellipse", name: "Ellipse", icon: Circle },
  { kind: "polygon", label: "Polygon", name: "Polygon", icon: Pentagon },
  { kind: "drawn", label: "Custom", name: "Add custom path mask", icon: Pen },
  { kind: "track-matte", label: "Track Matte", name: "Use another clip as a track matte", icon: Layers },
];
type EditMask = (update: (mask: Mask) => Mask) => void;
function PathCoordinate({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const percentage = Number((value * 100).toPrecision(12));
  const input = useNumericDraft({ value: percentage, min: 0, max: 100, step: 1, live: false, onChange: value => onChange(value / 100) });
  return <Input {...input} type="text" inputMode="decimal" role="spinbutton" aria-label={label} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}
    className="h-7 min-w-0 rounded-md bg-bg-1 px-2 text-right font-mono text-[11px] md:text-[11px]" />;
}
function MatteFields({ mask, edit }: { mask: Mask; edit: EditMask }) {
  const serialized = useProjectStore(useShallow(state => maskSources(state.project, mask.clipId).map(option => JSON.stringify(option))));
  const options = useMemo(() => serialized.map(value => JSON.parse(value) as { id: string; label: string }), [serialized]);
  const missing = Boolean(mask.sourceClipId && !options.some(option => option.id === mask.sourceClipId));
  return <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2">
    <Label className="block text-[11px] text-fg-2">Matte source</Label>
    <Select value={mask.sourceClipId || "unassigned"} disabled={!options.length} onValueChange={id => {
      if (id === "unassigned" || !maskSources(useProjectStore.getState().project, mask.clipId).some(source => source.id === id)) return;
      edit(current => ({ ...current, sourceClipId: id }));
    }}><SelectTrigger aria-label="Matte source" className="h-8 min-w-0 bg-bg-1 px-2 text-[11px]"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="unassigned" disabled>Pick a clip…</SelectItem>
      {missing && <SelectItem value={mask.sourceClipId!} disabled>Missing clip</SelectItem>}
      {options.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
    </SelectContent></Select>
    <div className="space-y-1.5"><Label className="block text-[11px] text-fg-2">Channel</Label><ToggleGroup type="single" aria-label="Matte channel" value={mask.matteSource ?? "bounds"} disabled={!mask.sourceClipId} onValueChange={value => {
      if (value === "bounds" || value === "alpha" || value === "luminance") edit(current => ({ ...current, matteSource: value }));
    }} className="grid grid-cols-3 gap-1">{(["bounds", "alpha", "luminance"] as const).map(channel => <ToggleGroupItem key={channel} value={channel} aria-label={channel} className="h-7 min-w-0 border border-border px-1 text-[10px] capitalize">{channel}</ToggleGroupItem>)}</ToggleGroup></div>
    <p className="text-[10px] leading-4 text-fg-2">The chosen clip’s {mask.matteSource ?? "bounds"} drive the visible region of this clip. Animate the source clip’s transform to animate the mask.</p>
  </div>;
}
function MaskItem({ mask, index, selected, expanded, select, toggle, edit, remove, duplicate }: {
  mask: Mask; index: number; selected: boolean; expanded: boolean; select: () => void; toggle: (open: boolean) => void; edit: EditMask; remove: () => void; duplicate: () => void;
}) {
  const Icon = mask.type === "shape" ? Square : mask.type === "track-matte" ? Layers : Pen;
  const title = mask.type === "shape" ? "Shape Mask" : mask.type === "track-matte" ? "Track Matte" : "Drawn Mask";
  return <Collapsible open={expanded} onOpenChange={toggle} asChild><Card role="group" aria-label={`Mask ${index + 1}: ${title}`} onFocusCapture={select} onClickCapture={select}
    className={cn("min-w-0 overflow-hidden rounded-md border bg-bg-2 p-0 shadow-none", selected ? "border-primary/60" : "border-border")}>
    <div className="flex items-center gap-0.5 p-1">
      <CollapsibleTrigger asChild><Button type="button" variant="ghost" aria-label={expanded ? "Collapse mask" : "Expand mask"} className="h-8 min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-[11px]"><ChevronRight size={12} className={cn("shrink-0 transition-transform", expanded && "rotate-90")} aria-hidden /><Icon size={12} className="shrink-0 text-primary" aria-hidden /><span className="truncate">{title}</span></Button></CollapsibleTrigger>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={mask.inverted ? "Mask Inverted" : "Mask Normal"} aria-pressed={mask.inverted} title={mask.inverted ? "Mask Inverted" : "Mask Normal"} onClick={() => edit(current => ({ ...current, inverted: !current.inverted }))} className={cn("h-7 w-7", mask.inverted && "bg-amber-500/20 text-amber-400")}>{mask.inverted ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}</Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Duplicate Mask" title="Duplicate Mask" onClick={duplicate} className="h-7 w-7"><Copy size={12} aria-hidden /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete Mask" title="Delete Mask" onClick={remove} className="h-7 w-7 hover:text-red-400"><Trash2 size={12} aria-hidden /></Button>
    </div>
    <div inert={!expanded} aria-hidden={!expanded}><CollapsibleContent className="space-y-3 border-t border-border bg-bg-1/50 p-2 data-[state=closed]:hidden">
      {mask.type === "drawn" && <div className="space-y-2 rounded-md border border-border bg-bg-1 p-2">
        <div className="flex items-center justify-between gap-2"><Label className="text-[11px] text-fg-2">Path points</Label><Button type="button" variant="ghost" size="sm" aria-label="Add path point" onClick={() => edit(current => {
          const last = current.path.points.at(-1) ?? { x: .5, y: .5 };
          return { ...current, path: { ...current.path, points: [...current.path.points, { x: Math.min(1, last.x + .05), y: Math.min(1, last.y + .05) }] } };
        })} className="h-7 gap-1 px-1.5 text-[10px]"><Plus size={12} aria-hidden />Add point</Button></div>
        <div className="max-h-44 space-y-1.5 overflow-auto pr-0.5">{mask.path.points.map((point, pointIndex) => <div key={`${mask.id}:${pointIndex}`} className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1">
          <span className="text-[10px] text-fg-3">{pointIndex + 1}</span>
          {(["x", "y"] as const).map(axis => <PathCoordinate key={axis} label={`Point ${pointIndex + 1} ${axis.toUpperCase()} percent`} value={point[axis]} onChange={value => edit(current => ({ ...current, path: { ...current.path, points: current.path.points.map((candidate, i) => i === pointIndex ? { ...candidate, [axis]: value } : candidate) } }))} />)}
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove path point ${pointIndex + 1}`} disabled={mask.path.points.length <= 3} onClick={() => edit(current => current.path.points.length <= 3 ? current : ({ ...current, path: { ...current.path, points: current.path.points.filter((_, i) => i !== pointIndex) } }))} className="h-6 w-6"><Minus size={12} aria-hidden /></Button>
        </div>)}</div><p className="text-[10px] leading-4 text-fg-2">X and Y are composition percentages. Adjust points for precise custom cutouts.</p>
      </div>}
      {mask.type === "track-matte" ? <MatteFields mask={mask} edit={edit} /> : <MaskPathTools mask={mask} />}
      {mask.type !== "track-matte" && <MaskTrackingControls mask={mask} />}
      {mask.type !== "track-matte" && <MaskRemoveObjectControls mask={mask} />}
      <MaskTargetToggle mask={mask} edit={edit} />
      {index > 0 && <div className="space-y-1.5"><Label className="block text-[11px] text-fg-2">Combine with previous masks</Label><ToggleGroup type="single" aria-label="Mask combine mode" value={mask.combine ?? "intersect"} onValueChange={value => {
        if ((MASK_COMBINE_MODES as readonly string[]).includes(value)) edit(current => ({ ...current, combine: value as MaskCombineMode }));
      }} className="grid grid-cols-4 gap-1">{MASK_COMBINE_MODES.map(mode => <ToggleGroupItem key={mode} value={mode} aria-label={`Combine mode ${mode}`} className="h-7 min-w-0 border border-border px-1 text-[10px] capitalize">{mode}</ToggleGroupItem>)}</ToggleGroup></div>}
      <PropertySlider label="Feathering" min={0} max={100} step={1} value={mask.feathering} onChange={value => edit(current => ({ ...current, feathering: value }))} formatValue={value => `${Math.round(value)}px`} />
      <PropertySlider label="Expansion" min={-100} max={100} step={1} value={mask.expansion} onChange={value => edit(current => ({ ...current, expansion: value }))} formatValue={value => `${Math.round(value)}px`} />
      <PropertySlider label="Opacity" min={0} max={100} step={1} value={mask.opacity * 100} onChange={value => edit(current => ({ ...current, opacity: value / 100 }))} formatValue={value => `${Math.round(value)}%`} />
      <div className="flex items-center gap-2 border-t border-border pt-2"><Button type="button" variant="outline" size="sm" aria-pressed={mask.inverted} onClick={() => edit(current => ({ ...current, inverted: !current.inverted }))} className="h-7 flex-1 gap-1.5 text-[11px]">{mask.inverted ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}{mask.inverted ? "Inverted" : "Invert"}</Button><span className="text-[10px] text-fg-3">{mask.keyframes.length ? `${mask.keyframes.length} keyframes` : "No keyframes"}</span></div>
    </CollapsibleContent></div>
  </Card></Collapsible>;
}

export function MaskSection({ clipId }: { clipId: string }) {
  const projectId = useProjectStore(state => state.project.id), history = useProjectStore(state => state.actionHistory);
  const masks = useProjectStore(useShallow(state => (state.project.masks ?? []).filter(mask => mask.clipId === clipId)));
  const locked = useProjectStore(state => state.project.timeline.tracks.find(track => track.clips.some(clip => clip.id === clipId))?.locked ?? true);
  const exporting = useUIStore(state => state.exportState.isExporting), applying = useUIStore(state => state.effectApplicationClipId !== null);
  const busy = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const [selected, setSelected] = useState<string | null>(null), [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => { setSelected(null); setExpanded(new Set()); }, [projectId, clipId, history]);
  const scope = useMemo(() => ({ projectId, clipId, history }), [projectId, clipId, history]);
  const commit = useCallback((update: Parameters<typeof editClipMasks>[1]) => editClipMasks(scope, update).catch(error => { toast.error("Mask edit failed", error instanceof Error ? error.message : "Try the change again."); return false; }), [scope]);
  const reveal = (id: string) => { setSelected(id); setExpanded(current => new Set([...current, id])); };
  const add = async (kind: EditorMaskKind) => {
    const source = maskSources(useProjectStore.getState().project, clipId)[0]?.id ?? "", mask = createEditorMask(clipId, kind, source);
    if (await commit(current => [...current, mask])) reveal(mask.id);
  };
  return <fieldset disabled={locked || exporting || applying || busy} className="min-w-0 space-y-3 border-0 p-0">
    <Card className="flex items-center gap-2 rounded-md border-primary/30 bg-primary/10 p-2 shadow-none"><Square size={16} className="shrink-0 text-primary" aria-hidden /><div><h4 className="text-[12px] font-medium">Masking</h4><p className="text-[11px] leading-4 text-fg-2">Control visible regions of clip</p></div></Card>
    <div className="space-y-2"><Label className="block text-[11px] text-fg-2">Add Mask Shape</Label><div className="grid grid-cols-5 gap-1">{SHAPES.map(({ kind, label, name, icon: Icon }) => <Button key={kind} type="button" variant="outline" aria-label={name} onClick={() => { void add(kind); }} className="h-auto min-w-0 flex-col gap-1 whitespace-normal rounded-md bg-bg-2 px-1 py-2 text-[9px] leading-3 hover:border-primary/40"><Icon size={14} className="shrink-0 text-fg-2" aria-hidden /><span>{label}</span></Button>)}</div><MaskPenLauncher clipId={clipId} /></div>
    {masks.length ? <div className="space-y-2"><div className="flex items-center justify-between gap-2"><span className="text-[11px] text-fg-2">Masks ({masks.length})</span><Button type="button" variant="ghost" size="sm" aria-label="Clear All" onClick={() => { void commit(() => []); }} className="h-7 gap-1 px-1.5 text-[10px] text-red-400"><RefreshCw size={12} aria-hidden />Clear All</Button></div>
      {masks.map((mask, index) => <MaskItem key={`${projectId}:${mask.id}`} mask={mask} index={index} selected={selected === mask.id} expanded={expanded.has(mask.id)} select={() => setSelected(mask.id)} toggle={open => { if (open) setSelected(mask.id); setExpanded(current => { const next = new Set(current); if (open) next.add(mask.id); else next.delete(mask.id); return next; }); }}
        edit={update => { void commit(current => current.map(candidate => candidate.id === mask.id ? update(candidate) : candidate)); }}
        remove={() => { void commit(current => current.filter(candidate => candidate.id !== mask.id)); }}
        duplicate={() => { let duplicateId = ""; void commit(current => { const original = current.find(candidate => candidate.id === mask.id); if (!original) return current; const copy = duplicateEditorMask(original); duplicateId = copy.id; return [...current, copy]; }).then(success => { if (success) reveal(duplicateId); }); }} />)}
    </div> : <div className="py-4 text-center"><Square size={24} className="mx-auto mb-2 text-fg-3 opacity-50" aria-hidden /><p className="text-[11px] text-fg-2">No masks on this clip</p><p className="mt-1 text-[10px] text-fg-3">Click a shape above to add a mask</p></div>}
    <p className="border-t border-border pt-2 text-[10px] leading-4 text-fg-2">Masks control which parts of the clip are visible</p>
  </fieldset>;
}

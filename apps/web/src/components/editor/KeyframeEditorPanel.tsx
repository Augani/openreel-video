import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  EASING_TYPES, EASE_PRESETS, KEYFRAME_INTERPOLATION_OPS, KEYFRAME_INTERPOLATION_LABELS, KEYFRAME_INTERPOLATION_SIDE_LABELS, keyframeSideTypes, type KeyframeInterpolationOp, type KeyframeInterpolationSide, type KeyframeSideType, clampBezierHandles, effectiveBezierHandles, keyframeEngine, keyframeSpeedAt,
  type BezierHandles, type EasePresetId, type Keyframe, type Clip,
} from "@openreel/core";
import { X, Copy, Clipboard, Trash2, ChevronLeft, ChevronRight } from "@/icons/lucide-compat";
import { Button, ScrollArea, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuCheckboxItem, ContextMenuLabel, cn } from "@openreel/ui";

const PROPERTY_COLORS: Record<string, string> = {
  "position.x": "#22d3ee", "position.y": "#34d399", "scale.x": "#4ade80", "scale.y": "#86efac",
  rotation: "#f472b6", opacity: "#fbbf24", borderRadius: "#94a3b8",
};
const FALLBACK_COLORS = ["#a78bfa", "#fb923c", "#60a5fa", "#f87171", "#2dd4bf", "#e879f9"];
const GRAPH_WIDTH = 600;
const GRAPH_HEIGHT = 200;
const GRAPH_PADDING = 40;
const PAGE_SIZE = 50;
const HIT_RADIUS = 10;
const PRESET_BUTTONS: { id: EasePresetId; label: string }[] = [
  { id: "linear", label: "Linear" }, { id: "hold", label: "Hold" }, { id: "ease-in", label: "Ease in" },
  { id: "ease-out", label: "Ease out" }, { id: "ease-in-out", label: "Ease in/out" },
];
const easingLabel = (value: string) => value === "bezier" ? "Custom Bézier" : value
  .replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("-", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const typeLabel = (type: KeyframeSideType) => type in KEYFRAME_INTERPOLATION_LABELS ? KEYFRAME_INTERPOLATION_LABELS[type as KeyframeInterpolationOp] : easingLabel(type);
type SideTypes = { in?: KeyframeSideType; out?: KeyframeSideType };
/** One label for a key: a single type when both sides agree, otherwise each side named. */
function sideTypesLabel(types: SideTypes): string {
  if (types.in && types.out) return types.in === types.out ? typeLabel(types.in) : `In ${typeLabel(types.in)} · Out ${typeLabel(types.out)}`;
  const only = types.in ?? types.out;
  return only ? typeLabel(only) : "";
}

/** Premiere-style "Temporal Interpolation" context menu; applies to the clicked key, or the whole selection when it was part of it. */
function InterpolationMenu({ children, disabled, side, resolveIds, typesOf, onApply }: {
  children: React.ReactNode; disabled: boolean; side: KeyframeInterpolationSide; resolveIds: (event: React.MouseEvent) => string[];
  typesOf: (id: string) => SideTypes; onApply: (ids: string[], op: KeyframeInterpolationOp) => void;
}) {
  const ids = useRef<string[]>([]);
  const [current, setCurrent] = useState<SideTypes>({});
  const isCurrent = (op: KeyframeInterpolationOp) => {
    const wanted = side === "both" ? [current.in, current.out] : [side === "in" ? current.in : current.out];
    return op !== "ease-in" && op !== "ease-out" && wanted.some(Boolean) && wanted.filter(Boolean).every(type => type === op);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled}
        onContextMenuCapture={(event: React.MouseEvent) => {
          ids.current = resolveIds(event);
          setCurrent(ids.current.length ? typesOf(ids.current[0]) : {});
          if (!ids.current.length) event.preventDefault();
        }}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Temporal interpolation">
        <ContextMenuLabel>Temporal Interpolation ({KEYFRAME_INTERPOLATION_SIDE_LABELS[side].toLowerCase()})</ContextMenuLabel>
        {KEYFRAME_INTERPOLATION_OPS.map(op => (
          <ContextMenuCheckboxItem key={op} checked={isCurrent(op)} onSelect={() => onApply(ids.current, op)}>{KEYFRAME_INTERPOLATION_LABELS[op]}</ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
const numericKey = (key: Keyframe): key is Keyframe & { value: number } =>
  typeof key.value === "number" && Number.isFinite(key.value) && Number.isFinite(key.time);
function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(3) : String(value);
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? "—"; } catch { return String(value); }
}
function colorFor(property: string, index: number) {
  return PROPERTY_COLORS[property] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface KeyframeEditorPanelProps {
  clip: Clip | null;
  disabled?: boolean;
  /** Playhead in clip-local seconds; paste lands the first copied key here. */
  playheadTime?: number;
  onClose: () => void;
  onUpdateKeyframes: (ids: string[], updates: Partial<Keyframe>) => void;
  onApplyInterpolation?: (ids: string[], op: KeyframeInterpolationOp, side: KeyframeInterpolationSide) => void;
  onDeleteKeyframes: (ids: string[]) => void;
  onCopyKeyframes: (ids: string[]) => void;
  onPasteKeyframes: (clipId: string, time: number, targetProperty?: string) => void;
  selectedKeyframeIds: string[];
  onSelectKeyframe: (id: string, addToSelection: boolean) => void;
  copiedKeyframes: Keyframe[];
}
type NumericKey = Keyframe & { value: number };
interface PropertyGroup { property: string; keyframes: Keyframe[]; color: string }
interface Range { min: number; max: number }
interface Layer { group: PropertyGroup; keys: NumericKey[]; range: Range; curve: { time: number; value: number }[] }
type Draft =
  | { kind: "key"; id: string; time: number; value: number }
  | { kind: "handle"; id: string; handles: BezierHandles };
type DragSession = {
  clip: Clip; pointerId: number; width: number; timeRange: Range; draft: Draft | null;
} & (
  | { kind: "key"; key: NumericKey; valueRange: Range }
  | { kind: "handle"; key: NumericKey; next: NumericKey; start: BezierHandles; which: "in" | "out" }
);

/** Bounded curve sampling using the renderer's actual easing and Bézier handles. */
function sampleCurve(keys: Keyframe[], range: Range) {
  if (!keys.length) return [];
  let segment = 0;
  const points: { time: number; value: number }[] = [];
  for (let index = 0; index <= 100; index++) {
    const time = range.min + index / 100 * (range.max - range.min);
    while (segment < keys.length - 2 && time > keys[segment + 1].time) segment++;
    // Two-key sampling avoids repeatedly sorting a large property group.
    const value = keyframeEngine.getValueAtTime(keys.slice(segment, segment + 2), time).value;
    if (typeof value === "number" && Number.isFinite(value)) points.push({ time, value });
  }
  return points;
}
function speedCurve(keys: Keyframe[], range: Range) {
  const points: { time: number; value: number }[] = [];
  for (let index = 0; index <= 100; index++) {
    const time = range.min + index / 100 * (range.max - range.min);
    points.push({ time, value: Math.abs(keyframeSpeedAt(keys, time, (t, key) => keyframeEngine.easeSegment(t, key))) });
  }
  return points;
}
function rangeOf(keys: NumericKey[], curve: { value: number }[]): Range {
  const values = [...keys.map(key => key.value), ...curve.map(point => point.value)];
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 1;
  const padding = (max - min) * 0.1 || 0.1;
  return { min: min - padding, max: max + padding };
}
/** Handle positions (time, value) of the segment leaving `key`. */
function handlePoints(key: NumericKey, next: NumericKey, handles: BezierHandles) {
  const dt = next.time - key.time, span = next.value - key.value;
  return {
    in: { time: key.time + handles.in.x * dt, value: key.value + handles.in.y * span },
    out: { time: key.time + handles.out.x * dt, value: key.value + handles.out.y * span },
  };
}

export function KeyframeEditorPanel({ clip, disabled = false, playheadTime = 0, onClose, onUpdateKeyframes, onApplyInterpolation, onDeleteKeyframes,
  onCopyKeyframes, onPasteKeyframes, selectedKeyframeIds, onSelectKeyframe, copiedKeyframes }: KeyframeEditorPanelProps) {
  const [activeProperty, setActiveProperty] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<string[]>([]);
  const [mode, setMode] = useState<"value" | "speed">("value");
  const [pasteIntoActive, setPasteIntoActive] = useState(false);
  const [page, setPage] = useState(1);
  const [interpSide, setInterpSide] = useState<KeyframeInterpolationSide>("both");
  const [graphWidth, setGraphWidth] = useState(GRAPH_WIDTH);
  const [draft, setDraft] = useState<Draft | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragSession | null>(null);
  const hasClip = Boolean(clip);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const width = canvas.getBoundingClientRect().width;
      if (width > 0) setGraphWidth(Math.max(GRAPH_PADDING * 2 + 1, width));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); resize();
    return () => observer.disconnect();
  }, [hasClip]);
  const propertyGroups = useMemo(() => {
    const groups = new Map<string, Keyframe[]>();
    for (const key of clip?.keyframes ?? []) {
      const group = groups.get(key.property) ?? [];
      group.push(key); groups.set(key.property, group);
    }
    return Array.from(groups, ([property, keyframes]) => ({ property, keyframes: keyframes.sort((a, b) => a.time - b.time) }))
      .sort((a, b) => a.property.localeCompare(b.property))
      .map((group, index): PropertyGroup => ({ ...group, color: colorFor(group.property, index) }));
  }, [clip?.keyframes]);
  const activeGroup = propertyGroups.find(group => group.property === activeProperty) ?? propertyGroups[0] ?? null;
  const typesOf = useCallback((id: string): SideTypes => {
    const group = propertyGroups.find(g => g.keyframes.some(key => key.id === id));
    const index = group ? group.keyframes.findIndex(key => key.id === id) : -1;
    if (!group || index < 0) return {};
    return keyframeSideTypes(group.keyframes[index - 1], group.keyframes[index], index < group.keyframes.length - 1);
  }, [propertyGroups]);
  const selectedKeys = useMemo(() => {
    const ids = new Set(selectedKeyframeIds);
    return (clip?.keyframes ?? []).filter(key => ids.has(key.id));
  }, [clip?.keyframes, selectedKeyframeIds]);
  const selectedIds = selectedKeys.map(key => key.id);
  const selectedIdSet = useMemo(() => new Set(selectedKeys.map(key => key.id)), [selectedKeys]);
  const selectedEasing = selectedKeys.length && selectedKeys.every(key => key.easing === selectedKeys[0].easing)
    ? selectedKeys[0].easing : "";
  // Active property first so its keys win hit tests; then the overlaid properties.
  const shownGroups = useMemo(() => {
    const shown = new Set([...(activeGroup ? [activeGroup.property] : []), ...overlay]);
    return [...propertyGroups.filter(g => g.property === activeGroup?.property), ...propertyGroups.filter(g => shown.has(g.property) && g.property !== activeGroup?.property)]
      .filter(group => group.keyframes.every(numericKey));
  }, [propertyGroups, activeGroup, overlay]);
  const duration = clip?.duration ?? 1;
  const timeRange = useMemo(() => {
    const times = shownGroups.flatMap(group => group.keyframes.map(key => key.time));
    return { min: Math.min(0, ...times), max: Math.max(1, Number.isFinite(duration) ? duration : 1, ...times) };
  }, [duration, shownGroups]);
  const baseLayers = useMemo(() => shownGroups.map((group): Omit<Layer, "range"> & { range: Range } => {
    const keys = group.keyframes as NumericKey[];
    const curve = sampleCurve(keys, timeRange);
    return { group, keys, curve, range: rangeOf(keys, curve) };
  }), [shownGroups, timeRange]);
  const layers = useMemo((): Layer[] => baseLayers.map(layer => {
    if (!draft || !layer.keys.some(key => key.id === draft.id)) return layer;
    const keys = layer.keys.map(key => key.id !== draft.id ? key
      : draft.kind === "key" ? { ...key, time: draft.time, value: draft.value }
        : { ...key, easing: "bezier" as const, bezierHandles: draft.handles }).sort((a, b) => a.time - b.time);
    // Handle drags keep the axis fixed; key drags keep the range they started with.
    return { ...layer, keys, curve: sampleCurve(keys, timeRange) };
  }), [baseLayers, draft, timeRange]);
  const activeLayer = layers.find(layer => layer.group.property === activeGroup?.property) ?? null;
  const speedLayers = useMemo(() => mode === "speed" ? layers.map(layer => {
    const curve = speedCurve(layer.keys, timeRange);
    return { layer, curve, max: Math.max(1e-9, ...curve.map(point => point.value)) };
  }) : [], [mode, layers, timeRange]);
  const timeToX = useCallback((time: number) => GRAPH_PADDING + (time - timeRange.min) / (timeRange.max - timeRange.min) * (graphWidth - GRAPH_PADDING * 2), [timeRange, graphWidth]);
  const valueToY = useCallback((range: Range, value: number) => GRAPH_PADDING + (1 - (value - range.min) / (range.max - range.min)) * (GRAPH_HEIGHT - GRAPH_PADDING * 2), []);
  /** Segments whose Bézier handles are editable: those touching a selected key of the active property. */
  const handleSegments = useMemo(() => {
    if (mode !== "value" || !activeLayer) return [];
    const segments: { key: NumericKey; next: NumericKey; handles: BezierHandles }[] = [];
    activeLayer.keys.forEach((key, index) => {
      const next = activeLayer.keys[index + 1];
      if (!next || !(selectedIdSet.has(key.id) || selectedIdSet.has(next.id))) return;
      const handles = effectiveBezierHandles(key);
      if (handles && next.time > key.time) segments.push({ key, next, handles });
    });
    return segments;
  }, [mode, activeLayer, selectedIdSet]);
  const cancelDrag = useCallback(() => { drag.current = null; setDraft(null); }, []);
  useEffect(cancelDrag, [clip, disabled, graphWidth, mode, cancelDrag]);
  useEffect(() => { setPage(1); }, [clip?.id, activeGroup?.property]);

  const finishDrag = useCallback((event: PointerEvent) => {
    const session = drag.current;
    if (!session || event.pointerId !== session.pointerId) return;
    drag.current = null; setDraft(null);
    if (disabled || session.clip !== clip || !session.draft) return;
    if (session.kind === "key" && session.draft.kind === "key") {
      if (session.draft.time !== session.key.time || session.draft.value !== session.key.value) {
        onUpdateKeyframes([session.key.id], { time: session.draft.time, value: session.draft.value });
      }
    } else if (session.kind === "handle" && session.draft.kind === "handle") {
      // One gesture, one update, one undo step.
      onUpdateKeyframes([session.key.id], { easing: "bezier", bezierHandles: clampBezierHandles(session.draft.handles) });
    }
  }, [clip, disabled, onUpdateKeyframes]);
  useEffect(() => {
    const cancelPointer = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && drag.current) { event.preventDefault(); cancelDrag(); } };
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("keydown", escape);
    };
  }, [finishDrag, cancelDrag]);

  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(graphWidth * dpr); canvas.height = GRAPH_HEIGHT * dpr; ctx.scale(dpr, dpr);
    const style = getComputedStyle(canvas);
    const fg = style.getPropertyValue("--fg").trim() || "#fff";
    ctx.strokeStyle = style.getPropertyValue("--border").trim() || "#333";
    ctx.lineWidth = 1;
    for (let index = 0; index <= 10; index++) {
      const x = GRAPH_PADDING + index / 10 * (graphWidth - GRAPH_PADDING * 2);
      ctx.beginPath(); ctx.moveTo(x, GRAPH_PADDING); ctx.lineTo(x, GRAPH_HEIGHT - GRAPH_PADDING); ctx.stroke();
    }
    for (let index = 0; index <= 5; index++) {
      const y = GRAPH_PADDING + index / 5 * (GRAPH_HEIGHT - GRAPH_PADDING * 2);
      ctx.beginPath(); ctx.moveTo(GRAPH_PADDING, y); ctx.lineTo(graphWidth - GRAPH_PADDING, y); ctx.stroke();
    }
    ctx.fillStyle = style.getPropertyValue("--fg-muted").trim() || "#888";
    ctx.font = "10px sans-serif"; ctx.textAlign = "center";
    for (let index = 0; index <= 5; index++) {
      const time = timeRange.min + index / 5 * (timeRange.max - timeRange.min);
      ctx.fillText(`${time.toFixed(2)}s`, timeToX(time), GRAPH_HEIGHT - 10);
    }
    ctx.textAlign = "right";
    const axisMax = mode === "speed" ? speedLayers.find(entry => entry.layer === activeLayer)?.max ?? speedLayers[0]?.max ?? 1 : 0;
    for (let index = 0; index <= 5; index++) {
      if (mode === "speed") ctx.fillText(`${(axisMax * (1 - index / 5)).toFixed(1)}/s`, GRAPH_PADDING - 5, GRAPH_PADDING + index / 5 * (GRAPH_HEIGHT - GRAPH_PADDING * 2) + 3);
      else if (activeLayer) {
        const value = activeLayer.range.min + index / 5 * (activeLayer.range.max - activeLayer.range.min);
        ctx.fillText(value.toFixed(2), GRAPH_PADDING - 5, valueToY(activeLayer.range, value) + 3);
      }
    }
    // Playhead marker.
    if (playheadTime >= timeRange.min && playheadTime <= timeRange.max) {
      ctx.strokeStyle = fg; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(timeToX(playheadTime), GRAPH_PADDING); ctx.lineTo(timeToX(playheadTime), GRAPH_HEIGHT - GRAPH_PADDING); ctx.stroke();
    }
    const strokeCurve = (color: string, width: number, points: { x: number; y: number }[]) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      points.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
      ctx.stroke();
    };
    if (mode === "speed") {
      // Each curve is scaled to its own peak; the axis shows the active property's units per second.
      speedLayers.forEach(({ layer, curve, max }, index) => strokeCurve(layer.group.color, index === 0 ? 2 : 1.5,
        curve.map(point => ({ x: timeToX(point.time), y: GRAPH_PADDING + (1 - point.value / max) * (GRAPH_HEIGHT - GRAPH_PADDING * 2) }))));
      return;
    }
    [...layers].reverse().forEach(layer => {
      const isActive = layer === activeLayer;
      strokeCurve(layer.group.color, isActive ? 2 : 1.25, layer.curve.map(point => ({ x: timeToX(point.time), y: valueToY(layer.range, point.value) })));
      for (const key of layer.keys) {
        ctx.save(); ctx.translate(timeToX(key.time), valueToY(layer.range, key.value)); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = layer.group.color; ctx.fillRect(-6, -6, 12, 12);
        if (selectedIdSet.has(key.id)) { ctx.strokeStyle = fg; ctx.lineWidth = 1; ctx.strokeRect(-6, -6, 12, 12); }
        ctx.restore();
      }
    });
    if (activeLayer) for (const segment of handleSegments) {
      const handles = draft?.kind === "handle" && draft.id === segment.key.id ? draft.handles : segment.handles;
      const points = handlePoints(segment.key, segment.next, handles);
      const ends = [
        { from: segment.key, handle: points.in }, { from: segment.next, handle: points.out },
      ];
      ctx.strokeStyle = fg; ctx.lineWidth = 1;
      for (const end of ends) {
        ctx.beginPath(); ctx.moveTo(timeToX(end.from.time), valueToY(activeLayer.range, end.from.value));
        ctx.lineTo(timeToX(end.handle.time), valueToY(activeLayer.range, end.handle.value)); ctx.stroke();
        ctx.fillStyle = fg;
        ctx.fillRect(timeToX(end.handle.time) - 4, valueToY(activeLayer.range, end.handle.value) - 4, 8, 8);
      }
    }
  }, [activeLayer, draft, handleSegments, layers, mode, playheadTime, selectedIdSet, speedLayers, timeRange, timeToX, valueToY, graphWidth]);
  useEffect(() => { drawGraph(); }, [drawGraph]);
  useEffect(() => {
    const observer = new MutationObserver(drawGraph);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [drawGraph]);

  const pointerPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: (event.clientX - rect.left) * graphWidth / rect.width,
      y: (event.clientY - rect.top) * GRAPH_HEIGHT / rect.height } : null;
  };
  const startDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !clip || event.button !== 0 || mode !== "value" || !activeLayer) return;
    const point = pointerPoint(event); if (!point) return;
    const base = { clip, pointerId: event.pointerId, width: graphWidth, timeRange, draft: null };
    // Bézier handles first: they sit on top of the curve near their keyframes.
    for (const segment of handleSegments) {
      const points = handlePoints(segment.key, segment.next, segment.handles);
      for (const which of ["in", "out"] as const) {
        const handle = points[which];
        if (Math.hypot(point.x - timeToX(handle.time), point.y - valueToY(activeLayer.range, handle.value)) < HIT_RADIUS) {
          event.preventDefault();
          drag.current = { ...base, kind: "handle", key: segment.key, next: segment.next, start: segment.handles, which };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          return;
        }
      }
    }
    for (const layer of layers) {
      const key = layer.keys.find(key => Math.hypot(point.x - timeToX(key.time), point.y - valueToY(layer.range, key.value)) < HIT_RADIUS);
      if (!key) continue;
      event.preventDefault();
      setActiveProperty(layer.group.property);
      onSelectKeyframe(key.id, event.shiftKey || event.metaKey || event.ctrlKey);
      drag.current = { ...base, kind: "key", key, valueRange: layer.range };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
  };
  const moveDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId || session.clip !== clip || disabled) return;
    const point = pointerPoint(event); if (!point) return;
    const time = session.timeRange.min + (point.x - GRAPH_PADDING) / (session.width - GRAPH_PADDING * 2) * (session.timeRange.max - session.timeRange.min);
    if (session.kind === "key") {
      const value = session.valueRange.min + (1 - (point.y - GRAPH_PADDING) / (GRAPH_HEIGHT - GRAPH_PADDING * 2)) * (session.valueRange.max - session.valueRange.min);
      const next = { kind: "key" as const, id: session.key.id, time: Math.max(0, time), value };
      session.draft = next; setDraft(next);
      return;
    }
    const range = activeLayer?.range;
    if (!range) return;
    const value = range.min + (1 - (point.y - GRAPH_PADDING) / (GRAPH_HEIGHT - GRAPH_PADDING * 2)) * (range.max - range.min);
    const dt = session.next.time - session.key.time, span = session.next.value - session.key.value;
    const x = (time - session.key.time) / dt;
    // Flat segments have no value span to scale against; their handle y stays put.
    const y = Math.abs(span) > 1e-9 ? (value - session.key.value) / span : session.start[session.which].y;
    const handles = clampBezierHandles({ ...session.start, [session.which]: { x, y } });
    const next = { kind: "handle" as const, id: session.key.id, handles };
    session.draft = next; setDraft(next);
  };
  const toggleOverlay = (property: string) =>
    setOverlay(current => current.includes(property) ? current.filter(name => name !== property) : [...current, property]);

  if (!clip) return <div className="grid h-full min-w-0 place-items-center p-4 text-sm text-fg-muted">Select a clip with keyframes to edit</div>;
  const pageCount = Math.max(1, Math.ceil((activeGroup?.keyframes.length ?? 0) / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount);
  const rows = activeGroup?.keyframes.slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE) ?? [];
  const numericActive = Boolean(activeLayer);
  return (
    <section aria-label="Keyframe editor" className="flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-bg-1 text-fg">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-[12px] font-semibold">Keyframe Editor</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close keyframe editor"><X size={16}/></Button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-bg-2 px-3 py-2">
        <Select value={activeGroup?.property ?? ""} onValueChange={setActiveProperty} disabled={!propertyGroups.length}>
          <SelectTrigger aria-label="Property" className="mr-auto h-7 w-44 min-w-0 bg-bg-1 px-2 text-[12px]"><SelectValue placeholder="No keyframes"/></SelectTrigger>
          <SelectContent>{propertyGroups.map(group => <SelectItem key={group.property} value={group.property}>{group.property}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => onCopyKeyframes(selectedIds)} disabled={!selectedIds.length} aria-label="Copy" className="h-7 gap-1 px-2 text-[11px]"><Copy size={13}/>Copy</Button>
        <Button variant="ghost" size="sm" onClick={() => pasteIntoActive && activeGroup ? onPasteKeyframes(clip.id, playheadTime, activeGroup.property) : onPasteKeyframes(clip.id, playheadTime)}
          disabled={disabled || !copiedKeyframes.length} aria-label="Paste" title="Paste at the playhead" className="h-7 gap-1 px-2 text-[11px]"><Clipboard size={13}/>Paste</Button>
        <Button variant="ghost" size="sm" onClick={() => onDeleteKeyframes(selectedIds)} disabled={disabled || !selectedIds.length} aria-label="Delete" className="h-7 gap-1 px-2 text-[11px] text-red-400"><Trash2 size={13}/>Delete</Button>
        <label className="flex items-center gap-1 text-[10px] text-fg-muted" title="Paste copied keys into the property shown in the graph">
          <input type="checkbox" checked={pasteIntoActive} onChange={event => setPasteIntoActive(event.target.checked)} aria-label="Paste into active property"/>into {activeGroup?.property ?? "property"}
        </label>
      </div>
      <ScrollArea className="min-h-0 flex-1">
      {propertyGroups.length > 0 && <div role="group" aria-label="Overlay properties" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
        <span className="mr-1 text-[10px] text-fg-muted">Overlay</span>
        {propertyGroups.map(group => {
          const isActive = group.property === activeGroup?.property, on = isActive || overlay.includes(group.property);
          return <button key={group.property} type="button" aria-pressed={on} aria-label={`Show ${group.property} curve`} disabled={isActive}
            onClick={() => toggleOverlay(group.property)} title={isActive ? "Active property (always shown)" : `Overlay ${group.property}`}
            className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]", on ? "border-border bg-bg-3 text-fg" : "border-transparent text-fg-muted hover:bg-bg-2")}>
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: group.color, opacity: on ? 1 : 0.35 }}/>{group.property}
          </button>;
        })}
        <div className="ml-auto flex gap-1">
          {(["value", "speed"] as const).map(name => <button key={name} type="button" aria-pressed={mode === name} onClick={() => setMode(name)}
            aria-label={name === "value" ? "Value graph" : "Speed graph"}
            className={cn("rounded border px-1.5 py-0.5 text-[10px]", mode === name ? "border-border bg-bg-3 text-fg" : "border-transparent text-fg-muted hover:bg-bg-2")}>{name === "value" ? "Value" : "Speed"}</button>)}
        </div>
      </div>}
        <div className="p-3">
          <InterpolationMenu disabled={disabled || !onApplyInterpolation} side={interpSide} typesOf={typesOf} onApply={(ids, op) => onApplyInterpolation?.(ids, op, interpSide)} resolveIds={event => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            if (!activeLayer || rect.width <= 0) return selectedIds;
            const x = (event.clientX - rect.left) * graphWidth / rect.width, y = (event.clientY - rect.top) * GRAPH_HEIGHT / rect.height;
            const hit = layers.flatMap(layer => layer.keys.map(key => ({ key, layer }))).find(({ key, layer }) => Math.hypot(x - timeToX(key.time), y - valueToY(layer.range, key.value)) < HIT_RADIUS);
            if (!hit) return selectedIds;
            if (!selectedIdSet.has(hit.key.id)) onSelectKeyframe(hit.key.id, false);
            return selectedIdSet.has(hit.key.id) ? selectedIds : [hit.key.id];
          }}>
          <canvas ref={canvasRef} width={GRAPH_WIDTH} height={GRAPH_HEIGHT} data-graph-mode={mode} aria-label="Keyframe value graph" className={cn("w-full touch-none rounded-md border border-border bg-bg-1", disabled || mode === "speed" ? "cursor-default" : "cursor-crosshair")} style={{ height: GRAPH_HEIGHT }} onPointerDown={startDrag} onPointerMove={moveDrag}/>
          </InterpolationMenu>
          {!numericActive && <p className="mt-2 text-[11px] text-fg-muted">{activeGroup ? "This property has no numeric curve." : "Add keyframes in the inspector to start animating."}</p>}
          {numericActive && mode === "value" && <p className="mt-2 text-[10px] text-fg-muted">Select a keyframe to drag its Bézier handles. {layers.length > 1 ? "Overlaid curves are each scaled to their own range." : ""}</p>}
          {mode === "speed" && <p className="mt-2 text-[10px] text-fg-muted">Speed graph: rate of change per second. Each curve is scaled to its own peak.</p>}
        </div>
        {!!rows.length && <div className="border-t border-border px-2 py-1">
          <div aria-hidden className="grid grid-cols-[1fr_1fr_2fr] gap-2 px-2 py-1 text-[10px] text-fg-muted"><span>Time</span><span>Value</span><span>Easing</span></div>
          {rows.map(key => <InterpolationMenu key={key.id} disabled={disabled || !onApplyInterpolation} side={interpSide} typesOf={typesOf} onApply={(ids, op) => onApplyInterpolation?.(ids, op, interpSide)} resolveIds={() => {
            if (!selectedIdSet.has(key.id)) onSelectKeyframe(key.id, false);
            return selectedIdSet.has(key.id) ? selectedIds : [key.id];
          }}><Button variant="ghost" aria-pressed={selectedIdSet.has(key.id)} aria-label={`Keyframe at ${key.time.toFixed(3)}s, value ${formatValue(key.value)}, ${sideTypesLabel(typesOf(key.id))}`} onClick={event => onSelectKeyframe(key.id, event.shiftKey || event.metaKey || event.ctrlKey)} className={cn("grid h-auto w-full grid-cols-[1fr_1fr_2fr] gap-2 whitespace-normal rounded px-2 py-1.5 text-left text-[11px] font-normal", selectedIdSet.has(key.id) && "bg-accent/10 text-accent")}>
            <span className="font-mono">{key.time.toFixed(3)}s</span><span className="min-w-0 break-words font-mono">{formatValue(key.value)}</span><span>{sideTypesLabel(typesOf(key.id))}</span>
          </Button></InterpolationMenu>)}
          {pageCount > 1 && <div className="flex items-center justify-between py-2">
            <Button variant="ghost" size="icon-sm" aria-label="Previous keyframe page" disabled={visiblePage === 1} onClick={() => setPage(visiblePage - 1)}><ChevronLeft size={14}/></Button>
            <span className="text-[10px] text-fg-muted">Page {visiblePage} of {pageCount}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next keyframe page" disabled={visiblePage === pageCount} onClick={() => setPage(visiblePage + 1)}><ChevronRight size={14}/></Button>
          </div>}
        </div>}
      </ScrollArea>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-bg-2 px-3 py-1.5 text-[11px]">
                <Select value={selectedEasing} onValueChange={value => onUpdateKeyframes(selectedIds, { easing: value as Keyframe["easing"] })} disabled={disabled || !selectedIds.length}>
          <SelectTrigger aria-label="Easing" className="h-7 w-32 bg-bg-1 px-2 text-[12px]"><SelectValue placeholder={selectedIds.length ? "Mixed" : "Select keyframes"}/></SelectTrigger>
          <SelectContent>{EASING_TYPES.map(easing => <SelectItem key={easing} value={easing}>{easingLabel(easing)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={interpSide} onValueChange={value => setInterpSide(value as KeyframeInterpolationSide)} disabled={disabled}>
          <SelectTrigger aria-label="Interpolation side" title="Which side of each selected keyframe an interpolation type applies to" className="h-7 w-24 bg-bg-1 px-2 text-[12px]"><SelectValue/></SelectTrigger>
          <SelectContent>{(Object.keys(KEYFRAME_INTERPOLATION_SIDE_LABELS) as KeyframeInterpolationSide[]).map(sideId => <SelectItem key={sideId} value={sideId}>{KEYFRAME_INTERPOLATION_SIDE_LABELS[sideId]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value="" onValueChange={value => onApplyInterpolation?.(selectedIds, value as KeyframeInterpolationOp, interpSide)} disabled={disabled || !selectedIds.length || !onApplyInterpolation}>
          <SelectTrigger aria-label="Interpolation" className="h-7 w-32 bg-bg-1 px-2 text-[12px]"><SelectValue placeholder="Interpolation"/></SelectTrigger>
          <SelectContent>{KEYFRAME_INTERPOLATION_OPS.map(op => <SelectItem key={op} value={op}>{KEYFRAME_INTERPOLATION_LABELS[op]}</SelectItem>)}</SelectContent>
        </Select>
        <div role="group" aria-label="Ease presets" className="flex flex-wrap gap-1">
          {PRESET_BUTTONS.map(preset => <Button key={preset.id} variant="ghost" size="sm" aria-label={`Apply ${preset.label}`}
            disabled={disabled || !selectedIds.length}
            onClick={() => onUpdateKeyframes(selectedIds, { easing: EASE_PRESETS[preset.id].easing, bezierHandles: EASE_PRESETS[preset.id].bezierHandles })}
            className="h-7 px-2 text-[11px]">{preset.label}</Button>)}
        </div>
        <span className="ml-auto text-fg-muted">{selectedIds.length} keyframe{selectedIds.length !== 1 ? "s" : ""} selected</span>
      </div>
    </section>
  );
}

import React, { useCallback, useId, useMemo } from "react";
import {
  Button, Input, Label,
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem,
  cn,
} from "@openreel/ui";
import {
  applyRunStyle,
  baseFill,
  clipRuns,
  hasRunOverrides,
  rangeRunStyle,
  resolveBackgroundBox,
  resolveStrokes,
  type TextBackgroundBox,
  type TextClip,
  type TextFill,
  type TextRunStyle,
  type TextStroke,
} from "@openreel/core";
import { Bold, Italic, Underline } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { selectionForClip, useTextSelectionStore } from "../../../stores/text-selection-store";
import { ensureFontFamily } from "../../../services/project-fonts";
import { ColorSelector } from "../../../motion/components/primitives";
import { toast } from "../../../stores/notification-store";
import { FONT_CATEGORIES } from "./font-options";
import { useNumericDraft } from "./shell/useNumericDraft";

const controlClass = "flex h-7 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2 py-1 text-[12px] font-medium text-fg-2 outline-none transition-colors focus:border-accent";
const iconButtonClass = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const activeClass = "bg-accent text-accent-fg hover:bg-accent/90";
const inactiveClass = "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg";
const wordButtonClass = "h-7 rounded-[7px] px-2 text-[11px] font-medium";

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-[12px] leading-5 text-fg-2 font-normal">{label}</span>
    <div className="flex max-w-[190px] items-center">{children}</div>
  </div>
);

const Num: React.FC<{
  label: string; value: number; onChange: (value: number) => void;
  min: number; max: number; step?: number; unit?: string; mixed?: boolean;
}> = ({ label, value, onChange, min, max, step = 1, unit, mixed }) => {
  const id = useId();
  const input = useNumericDraft({ value, onChange, min, max, step, ...(mixed ? { displayValue: "" } : {}) });
  return (
    <div className="min-w-0 space-y-1 w-full">
      <Label htmlFor={id} className="block truncate text-[11px] font-medium leading-[1.4] text-text-secondary">{label}</Label>
      <div className="relative min-w-0">
        <Input {...input} id={id} type="number" inputMode="decimal" min={min} max={max} step={step}
          placeholder={mixed ? "Mixed" : undefined}
          className={cn(controlClass, "font-mono tabular-nums", unit && "pr-8")} />
        {unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-fg-muted">{unit}</span>}
      </div>
    </div>
  );
};

const Toggle: React.FC<{ label: string; pressed: boolean; onClick: () => void; children: React.ReactNode; word?: boolean }> = ({ label, pressed, onClick, children, word }) => (
  <Button type="button" aria-label={label} title={label} aria-pressed={pressed} size="icon-sm" variant="ghost"
    className={cn(word ? wordButtonClass : iconButtonClass, pressed ? activeClass : inactiveClass)} onClick={onClick}>
    {children}
  </Button>
);

const Color: React.FC<{ label: string; value: string; onChange: (color: string) => void }> = ({ label, value, onChange }) => (
  <Field label={label}>
    <ColorSelector value={value} onChange={onChange} label={`Select ${label.toLowerCase()}`} fallback="#ffffff" />
  </Field>
);

const FONT_NAMES = Object.entries(FONT_CATEGORIES);
const INHERIT = "__inherit__";
const DEFAULT_STOPS = [{ offset: 0, color: "#ffd166" }, { offset: 1, color: "#ef476f" }];

/** Fill editor shared by the clip fill and by a selected run. */
const FillEditor: React.FC<{ fill: TextFill; onChange: (fill: TextFill) => void; label: string }> = ({ fill, onChange, label }) => {
  const stops = fill.type === "solid" ? DEFAULT_STOPS : fill.stops;
  const setType = (type: string) => {
    if (type === "solid") onChange({ type: "solid", color: fill.type === "solid" ? fill.color : (fill.stops[0]?.color ?? "#ffffff") });
    else if (type === "linear") onChange({ type: "linear", angle: fill.type === "linear" ? fill.angle : 90, stops: [...stops] });
    else onChange({ type: "radial", stops: [...stops] });
  };
  const setStops = (next: typeof stops) => {
    if (fill.type === "linear") onChange({ ...fill, stops: next });
    else if (fill.type === "radial") onChange({ ...fill, stops: next });
  };
  return (
    <div className="space-y-2" data-testid="rich-text-fill">
      <Field label={label}>
        <Select value={fill.type} onValueChange={setType}>
          <SelectTrigger aria-label={`${label} type`} className={cn(controlClass, "w-[120px]")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="linear">Linear gradient</SelectItem>
            <SelectItem value="radial">Radial gradient</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {fill.type === "solid" && <Color label="Fill color" value={fill.color} onChange={(color) => onChange({ type: "solid", color })} />}
      {fill.type === "linear" && <Num label="Gradient angle" value={fill.angle} min={-360} max={360} unit="deg" onChange={(angle) => onChange({ ...fill, angle })} />}
      {fill.type !== "solid" && (
        <div className="space-y-1.5">
          {stops.map((stop, index) => (
            <div key={index} className="flex items-center gap-2" data-testid="gradient-stop">
              <ColorSelector value={stop.color} label={`Select stop ${index + 1} color`} fallback="#ffffff"
                onChange={(color) => setStops(stops.map((s, i) => (i === index ? { ...s, color } : s)))} />
              <Num label={`Stop ${index + 1}`} value={Math.round(stop.offset * 100)} min={0} max={100} unit="%"
                onChange={(percent) => setStops(stops.map((s, i) => (i === index ? { ...s, offset: percent / 100 } : s)))} />
              <Button type="button" size="sm" variant="ghost" className={cn(wordButtonClass, inactiveClass)} disabled={stops.length <= 2}
                aria-label={`Remove stop ${index + 1}`} onClick={() => setStops(stops.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className={cn(wordButtonClass, inactiveClass)} disabled={stops.length >= 8}
            onClick={() => setStops([...stops, { offset: 1, color: stops[stops.length - 1]?.color ?? "#ffffff" }])}>
            Add stop
          </Button>
        </div>
      )}
    </div>
  );
};

interface RichTextSectionProps {
  clipId: string;
  clip: TextClip;
}

/**
 * Premiere-style Essential Graphics text controls: per-character run styling
 * for the selected characters (whole text when nothing is selected), gradient
 * fill, any number of strokes, a background box and OpenType-style toggles.
 * Every change is one undoable store update; the renderer is shared with export.
 */
const RichTextSection: React.FC<RichTextSectionProps> = ({ clipId, clip }) => {
  const updateTextRuns = useProjectStore((s) => s.updateTextRuns);
  const updateTextStyle = useProjectStore((s) => s.updateTextStyle);
  // Both the Text Content field and the Program monitor's in-place editor publish here.
  const shared = useTextSelectionStore();
  const text = clip.text;
  const sel = selectionForClip(shared, clipId, text.length) ?? { start: 0, end: 0 };
  const hasSelection = sel.end > sel.start;
  const start = hasSelection ? sel.start : 0;
  const end = hasSelection ? sel.end : text.length;
  const runs = useMemo(() => clipRuns(clip), [clip]);
  const current = useMemo(() => rangeRunStyle(runs, start, end), [runs, start, end]);
  const style = clip.style;

  const apply = useCallback((patch: Partial<TextRunStyle>) => {
    updateTextRuns(clipId, applyRunStyle(runs, start, end, patch));
  }, [clipId, runs, start, end, updateTextRuns]);

  const value = <K extends keyof TextRunStyle>(key: K): Exclude<TextRunStyle[K], undefined> | "mixed" | undefined =>
    current[key] as Exclude<TextRunStyle[K], undefined> | "mixed" | undefined;
  const isMixed = (key: keyof TextRunStyle) => current[key] === "mixed";

  const weight = value("fontWeight");
  const boldNow = weight === "mixed" ? false : weight === undefined
    ? (style.fontWeight === "bold" || (typeof style.fontWeight === "number" && style.fontWeight >= 700))
    : (weight === "bold" || (typeof weight === "number" && weight >= 700));
  const italicNow = value("fontStyle") === "mixed" ? false : (value("fontStyle") ?? style.fontStyle) === "italic";
  const underlineNow = value("underline") === "mixed" ? false : (value("underline") ?? style.textDecoration === "underline") === true;
  const smallCapsNow = value("smallCaps") === true;
  const ligaturesOff = value("ligatures") === false;
  const tabularNow = value("tabularFigures") === true;
  const size = value("fontSize");
  const tracking = value("letterSpacing");
  const shift = value("baselineShift");
  const family = value("fontFamily");
  const runColor = value("color");
  const runFill = value("fill");

  const setFamily = async (next: string) => {
    if (next === INHERIT) { apply({ fontFamily: undefined }); return; }
    try { await ensureFontFamily(next, boldNow ? 700 : 400, text); } catch { toast.error("Font unavailable", `${next} could not be loaded; the fallback face is used.`); }
    apply({ fontFamily: next });
  };

  const strokes = resolveStrokes(style);
  const setStrokes = (next: TextStroke[]) => updateTextStyle(clipId, { strokes: next });
  const box = resolveBackgroundBox(style);
  const setBox = (next: TextBackgroundBox | undefined) => updateTextStyle(clipId, { backgroundBox: next });
  const fill = baseFill(style);

  return (
    <div className="space-y-3" data-testid="rich-text-section">
      <div className="space-y-2 rounded-[7px] bg-bg-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] leading-5 text-fg font-medium">Character</span>
          <span className="text-[11px] text-fg-muted" data-testid="rich-text-range">
            {hasSelection ? `Selected ${start + 1}–${end} (${end - start})` : "Whole text"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Toggle label="Bold selection" pressed={boldNow} onClick={() => apply({ fontWeight: boldNow ? 400 : 700 })}><Bold size={14} /></Toggle>
          <Toggle label="Italic selection" pressed={italicNow} onClick={() => apply({ fontStyle: italicNow ? "normal" : "italic" })}><Italic size={14} /></Toggle>
          <Toggle label="Underline selection" pressed={underlineNow} onClick={() => apply({ underline: underlineNow ? undefined : true })}><Underline size={14} /></Toggle>
          <Toggle word label="Small caps" pressed={smallCapsNow} onClick={() => apply({ smallCaps: smallCapsNow ? undefined : true })}>Sc</Toggle>
          <Toggle word label="Disable ligatures" pressed={ligaturesOff} onClick={() => apply({ ligatures: ligaturesOff ? undefined : false })}>No fi</Toggle>
          <Toggle word label="Tabular figures" pressed={tabularNow} onClick={() => apply({ tabularFigures: tabularNow ? undefined : true })}>1 0 1</Toggle>
        </div>
        <Field label="Font">
          <Select value={family === "mixed" ? "" : (family ?? INHERIT)} onValueChange={(next) => void setFamily(next)}>
            <SelectTrigger aria-label="Selection font" className={cn(controlClass, "w-[160px]")}>
              <SelectValue placeholder={isMixed("fontFamily") ? "Mixed" : undefined} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>Clip font ({style.fontFamily})</SelectItem>
              {FONT_NAMES.map(([category, fonts]) => (
                <SelectGroup key={category}>
                  <SelectLabel>{category}</SelectLabel>
                  {fonts.map((font) => <SelectItem key={font} value={font}>{font}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Num label="Character size" unit="px" min={1} max={1000} mixed={isMixed("fontSize")}
            value={typeof size === "number" ? size : style.fontSize} onChange={(next) => apply({ fontSize: next })} />
          <Num label="Character tracking" unit="px" min={-50} max={200} step={0.5} mixed={isMixed("letterSpacing")}
            value={typeof tracking === "number" ? tracking : style.letterSpacing} onChange={(next) => apply({ letterSpacing: next })} />
          <Num label="Baseline shift" unit="px" min={-500} max={500} mixed={isMixed("baselineShift")}
            value={typeof shift === "number" ? shift : 0} onChange={(next) => apply({ baselineShift: next === 0 ? undefined : next })} />
        </div>
        <Color label="Selection color" value={typeof runColor === "string" && runColor !== "mixed" ? runColor : style.color}
          onChange={(color) => apply({ color, fill: undefined })} />
        {runFill && runFill !== "mixed" && (
          <FillEditor label="Selection fill" fill={runFill} onChange={(next) => apply({ fill: next })} />
        )}
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" className={cn(wordButtonClass, inactiveClass)}
            onClick={() => apply({ fill: { type: "linear", angle: 90, stops: [...DEFAULT_STOPS] } })}>
            Gradient on selection
          </Button>
          <Button type="button" size="sm" variant="ghost" className={cn(wordButtonClass, inactiveClass)}
            disabled={!hasRunOverrides(clip.runs)} onClick={() => updateTextRuns(clipId, undefined)}>
            Clear character styles
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-[7px] bg-bg-2 p-3">
        <span className="text-[12px] leading-5 text-fg font-medium">Fill</span>
        <FillEditor label="Fill type" fill={fill} onChange={(next) => updateTextStyle(clipId, next.type === "solid" ? { fill: undefined, color: next.color } : { fill: next })} />
      </div>

      <div className="space-y-2 rounded-[7px] bg-bg-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] leading-5 text-fg font-medium">Strokes</span>
          <Button type="button" size="sm" variant="ghost" className={cn(wordButtonClass, inactiveClass)}
            onClick={() => setStrokes([...strokes, { color: strokes.length ? "#ffd166" : "#000000", width: strokes.length ? 10 : 4 }])}>
            Add stroke
          </Button>
        </div>
        {strokes.map((stroke, index) => (
          <div key={index} className="space-y-1.5 border-t border-border pt-2" data-testid="text-stroke">
            <Color label={`Stroke ${index + 1}`} value={stroke.color}
              onChange={(color) => setStrokes(strokes.map((s, i) => (i === index ? { ...s, color } : s)))} />
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <Num label="Stroke width" unit="px" min={0} max={100} step={0.5} value={stroke.width}
                onChange={(width) => setStrokes(strokes.map((s, i) => (i === index ? { ...s, width } : s)))} />
              <Toggle word label={`Stroke ${index + 1} over fill`} pressed={stroke.position === "over"}
                onClick={() => setStrokes(strokes.map((s, i) => (i === index ? { ...s, position: s.position === "over" ? undefined : "over" } : s)))}>Over</Toggle>
              <Button type="button" size="sm" variant="ghost" className={cn(wordButtonClass, inactiveClass)} aria-label={`Remove stroke ${index + 1}`}
                onClick={() => setStrokes(strokes.filter((_, i) => i !== index))}>Remove</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-[7px] bg-bg-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] leading-5 text-fg font-medium">Background box</span>
          <Toggle word label="Background box" pressed={!!style.backgroundBox}
            onClick={() => setBox(style.backgroundBox ? undefined : { color: box?.color ?? "#000000", paddingX: 24, paddingY: 12, radius: 12 })}>
            {style.backgroundBox ? "On" : "Off"}
          </Toggle>
        </div>
        {style.backgroundBox && (
          <>
            <Color label="Box color" value={style.backgroundBox.color} onChange={(color) => setBox({ ...style.backgroundBox!, color })} />
            <div className="grid grid-cols-3 gap-2">
              <Num label="Box padding X" unit="px" min={0} max={400} value={style.backgroundBox.paddingX} onChange={(paddingX) => setBox({ ...style.backgroundBox!, paddingX })} />
              <Num label="Box padding Y" unit="px" min={0} max={400} value={style.backgroundBox.paddingY} onChange={(paddingY) => setBox({ ...style.backgroundBox!, paddingY })} />
              <Num label="Box radius" unit="px" min={0} max={400} value={style.backgroundBox.radius} onChange={(radius) => setBox({ ...style.backgroundBox!, radius })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RichTextSection;

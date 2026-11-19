import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CAPTION_ANIMATION_STYLES, type CueSettings, getAnimationStyleDisplayName, type CaptionAnimationStyle, type Subtitle, type SubtitleStyle } from "@openreel/core";
import { Button, Card, ColorPicker, Input, Label, RadioGroup, RadioGroupItem, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, Textarea } from "@openreel/ui";
import { Captions, Upload } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { FONT_CATEGORIES, FONT_FILE_ACCEPT, registerCustomFont, useCustomFonts } from "./font-options";
import { DEFAULT_CAPTION_STYLE } from "@openreel/core/captions/caption-layout";
import { InspectorSection as Section } from "./shell/InspectorSection";
import { SavedStylesSection } from "./SavedStylesSection";

const DEFAULT_STYLE: SubtitleStyle = DEFAULT_CAPTION_STYLE;
const HIGHLIGHT_COLORS = ["#ffff00", "#00ff00", "#ff6b6b", "#4ecdc4", "#ff9f43", "#a55eea"];
const OPACITY_OPTIONS = [{ value: "0", label: "None" }, { value: "0.5", label: "50%" }, { value: "0.7", label: "70%" }, { value: "1", label: "100%" }];
const ANIMATION_HELP: Record<CaptionAnimationStyle, string> = {
  none: "Static text, no animation", karaoke: "Words fill with color as they're spoken",
  "word-highlight": "Current word is highlighted and scaled", "word-by-word": "Shows one word at a time",
  bounce: "Words bounce in as they appear", typewriter: "Words appear progressively like typing",
};

// Opacity presets preserve the actual RGB/alpha, including saved custom shades.
function backgroundChannels(color: string): { rgb: number[]; alpha: string } {
  if (color.trim().toLowerCase() === "transparent") return { rgb: [0, 0, 0], alpha: "0" };
  const hex = color.trim().match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length < 5 ? [...hex].map(char => char + char).join("") : hex;
    return { rgb: [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16)),
      alpha: expanded.length === 8 ? String(parseInt(expanded.slice(6), 16) / 255) : "1" };
  }
  const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  return rgba ? { rgb: rgba.slice(1, 4).map(Number), alpha: rgba[4] ?? "1" } : { rgb: [0, 0, 0], alpha: "0.7" };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-center justify-between gap-2"><span className="text-[10px] text-fg-2">{label}</span>{children}</div>;
}

/** Commit a complete caption value once, keeping partial typing out of history. */
function SubtitleNumberInput({ label, value, onCommit, min, max, step = 1 }: {
  label: string; value: number; onCommit: (value: number) => void | boolean;
  min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const editorSession = useProjectStore(state => state.actionExecutor);
  const changed = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => { setDraft(String(value)); changed.current = false; }, [value, editorSession]);
  return <Input aria-label={label} type="number" inputMode="decimal" min={min} max={max} step={step}
    className="h-7 w-20 rounded-[5px] bg-bg-2 px-2 py-1 font-mono text-xs md:text-xs" value={draft}
    onFocus={() => { cancelled.current = false; }}
    onChange={event => { changed.current = true; setDraft(event.target.value); }}
    onBlur={() => {
      const parsed = Number(draft);
      const valid = !cancelled.current && changed.current && draft.trim() !== "" && Number.isFinite(parsed) &&
        (min === undefined || parsed >= min) && (max === undefined || parsed <= max);
      changed.current = false;
      const accepted = valid && parsed !== value ? onCommit(parsed) !== false : valid;
      setDraft(String(accepted ? parsed : value));
    }}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); cancelled.current = true;
        changed.current = false; setDraft(String(value)); event.currentTarget.blur();
      }
    }} />;
}

/** Retain editing of saved timeline subtitles alongside modern caption clips. */
export function SubtitleInspector({ subtitle }: { subtitle: Subtitle }) {
  const projectId = useProjectStore(state => state.project.id);
  const owner = useProjectStore(state => state.actionExecutor);
  const customFonts = useCustomFonts();
  const fontFile = useRef<HTMLInputElement>(null);
  const fontIntent = useRef(0);
  useEffect(() => () => { fontIntent.current += 1; }, [projectId, owner, subtitle.id]);
  const style = { ...DEFAULT_STYLE, ...subtitle.style };
  const animation = subtitle.animationStyle ?? "none";
  const cue = subtitle.cueSettings ?? {};
  const background = backgroundChannels(style.backgroundColor);
  const knownOpacity = OPACITY_OPTIONS.some(option => option.value === background.alpha);
  const fontGroups = useMemo(() => {
    const seen = new Set<string>();
    return [...Object.entries(FONT_CATEGORIES), ["Custom", customFonts] as const].map(([name, families]) => ({
      name, families: families.filter(family => { if (seen.has(family)) return false; seen.add(family); return true; }),
    }));
  }, [customFonts]);
  const knownFamily = fontGroups.some(group => group.families.includes(style.fontFamily));

  const currentSubtitle = () => {
    const state = useProjectStore.getState();
    return state.project.id === projectId && state.actionExecutor === owner ? state.getSubtitle(subtitle.id) : undefined;
  };
  const update = (updates: Partial<Subtitle>) => {
    if (currentSubtitle()) useProjectStore.getState().updateSubtitle(subtitle.id, updates);
  };
  const updateCue = (changes: Partial<CueSettings>) => {
    const current = currentSubtitle();
    if (current) update({ cueSettings: { ...current.cueSettings, ...changes } });
  };
  const updateStyle = (changes: Partial<SubtitleStyle>) => {
    const current = currentSubtitle();
    if (current) update({ style: { ...DEFAULT_STYLE, ...current.style, ...changes } });
  };
  const uploadFont = async (file: File) => {
    const initial = currentSubtitle();
    if (!initial) return;
    const intent = ++fontIntent.current;
    const family = initial.style?.fontFamily;
    const isCurrent = () => intent === fontIntent.current && currentSubtitle()?.style?.fontFamily === family && Boolean(currentSubtitle());
    try {
      const result = await registerCustomFont(file);
      if (!isCurrent()) return;
      if (!result.success) { toast.error("Font upload failed", result.error ?? "Unknown error."); return; }
      updateStyle({ fontFamily: result.fontFamily });
      toast.success("Custom font uploaded", `${result.fontFamily} is ready to use.`);
    } catch (error) {
      if (isCurrent()) toast.error("Font upload failed", error instanceof Error ? error.message : "Could not read the selected font.");
    }
  };

  return <div className="min-w-0" data-subtitle-inspector>
    <Card className="mb-4 min-w-0 rounded-lg border border-accent/30 bg-accent-soft p-3 text-fg shadow-none">
      <div className="mb-1 flex items-center gap-2"><Captions size={14} className="text-accent" aria-hidden /><span className="text-xs font-bold leading-5 text-accent">Subtitle</span></div>
      <span className="block text-[10px] text-fg-3">{subtitle.startTime.toFixed(2)}s - {subtitle.endTime.toFixed(2)}s</span>
    </Card>
    <Section title="Text Content"><Textarea aria-label="Subtitle text" rows={4} placeholder="Enter subtitle text..."
      className="rounded-[5px] bg-bg-2 text-xs" value={subtitle.text} onChange={event => update({ text: event.target.value })} /></Section>
    <Section title="Timing"><div className="space-y-3">
      <Field label="Start Time"><SubtitleNumberInput label="Start Time" value={subtitle.startTime} min={0} max={subtitle.endTime} step={0.1}
        onCommit={startTime => { const current = currentSubtitle(); if (!current || startTime >= current.endTime) return false; update({ startTime }); }} /></Field>
      <Field label="End Time"><SubtitleNumberInput label="End Time" value={subtitle.endTime} min={subtitle.startTime} step={0.1}
        onCommit={endTime => { const current = currentSubtitle(); if (!current || endTime <= current.startTime) return false; update({ endTime }); }} /></Field>
    </div></Section>
    <Section title="Position"><RadioGroup aria-label="Subtitle position" value={style.position}
      onValueChange={position => updateStyle({ position: position as SubtitleStyle["position"] })} className="grid grid-cols-3 gap-2">
      {(["top", "center", "bottom"] as const).map(position => <Label key={position}
        className="relative cursor-pointer rounded-[7px] border border-transparent bg-bg-2 p-2 text-center text-xs font-normal capitalize text-fg has-[:checked]:border-accent has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:bg-selected focus-within:ring-2 focus-within:ring-ring hover:bg-bg-3">
        <RadioGroupItem aria-label={position} value={position} className="sr-only" />{position}
      </Label>)}
    </RadioGroup></Section>
    <Section title="Animation"><div className="space-y-3">
      <Field label="Style"><Select value={animation} onValueChange={value => update({ animationStyle: value as CaptionAnimationStyle })}>
        <SelectTrigger aria-label="Animation style" className="h-7 w-[140px] rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{CAPTION_ANIMATION_STYLES.map(value => <SelectItem key={value} value={value}>{getAnimationStyleDisplayName(value)}</SelectItem>)}</SelectContent>
      </Select></Field>
      <p className="text-[9px] text-fg-2">{ANIMATION_HELP[animation]}</p>
      {animation !== "none" && !subtitle.words?.length && <Card className="rounded-[7px] border-transparent bg-amber-400/10 p-2 text-[9px] text-amber-400 shadow-none">No word-level timing data. Re-generate captions to enable animation.</Card>}
      {animation !== "none" && animation !== "typewriter" && animation !== "word-by-word" && <div className="space-y-2 border-t border-border pt-2">
        <Field label="Highlight Color"><ColorPicker label="Select highlight color" value={style.highlightColor ?? "#ffff00"}
          showAlpha onChange={highlightColor => updateStyle({ highlightColor })} className="h-7 w-32 min-w-0 text-xs" /></Field>
        <div className="grid grid-cols-6 gap-1">{HIGHLIGHT_COLORS.map(color => <Button key={color} type="button" aria-label={color}
          aria-pressed={(style.highlightColor ?? "#ffff00") === color} title={color} style={{ backgroundColor: color }}
          onClick={() => updateStyle({ highlightColor: color })}
          className="h-6 w-6 rounded border-2 border-transparent p-0 hover:scale-110 aria-pressed:border-white" />)}</div>
      </div>}
    </div></Section>
    <Section title="Font"><div className="space-y-3">
      <Field label="Font Family"><Select value={style.fontFamily} onValueChange={fontFamily => { fontIntent.current += 1; updateStyle({ fontFamily }); }}>
        <SelectTrigger aria-label="Font family" className="h-7 w-40 min-w-0 rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{!knownFamily && <SelectItem value={style.fontFamily}>{style.fontFamily}</SelectItem>}
          {fontGroups.filter(group => group.families.length > 0).map(group => <SelectGroup key={group.name}><SelectLabel>{group.name}</SelectLabel>
            {group.families.map(family => <SelectItem key={family} value={family}>{family}</SelectItem>)}
          </SelectGroup>)}
        </SelectContent>
      </Select></Field>
      <Input ref={fontFile} type="file" aria-label="Subtitle font file" accept={FONT_FILE_ACCEPT} className="sr-only" tabIndex={-1}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFont(file); }} />
      <Button type="button" variant="outline" className="h-8 w-full gap-2 text-xs" onClick={() => fontFile.current?.click()}><Upload size={13} aria-hidden />Upload Custom Font</Button>
      <Field label="Font Size"><SubtitleNumberInput label="Font Size" value={style.fontSize} min={12} max={72} onCommit={fontSize => updateStyle({ fontSize })} /></Field>
    </div></Section>
    <Section title="Colors"><div className="space-y-3">
      <Field label="Text Color"><ColorPicker label="Select subtitle text color" value={style.color} showAlpha
        onChange={color => updateStyle({ color })} className="h-7 w-32 min-w-0 text-xs" /></Field>
      <Field label="Background"><div className="flex min-w-0 items-center gap-2">
        <ColorPicker label="Select subtitle background color" value={style.backgroundColor} showAlpha allowTransparent
          onChange={backgroundColor => updateStyle({ backgroundColor })} className="h-7 w-24 min-w-0 text-xs" />
        <Select value={background.alpha} onValueChange={alpha => {
          const current = currentSubtitle();
          if (current) { const { rgb } = backgroundChannels(current.style?.backgroundColor ?? DEFAULT_STYLE.backgroundColor);
            updateStyle({ backgroundColor: `rgba(${rgb.join(", ")}, ${alpha})` }); }
        }}>
          <SelectTrigger aria-label="Background opacity" className="h-7 w-20 rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{!knownOpacity && <SelectItem value={background.alpha}>{Math.round(Number(background.alpha) * 100)}%</SelectItem>}
            {OPACITY_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div></Field>
    </div></Section>
    <Section title="Outline & Shadow"><div className="space-y-3">
      <Field label="Outline Color"><ColorPicker label="Select caption outline color" value={style.strokeColor ?? "#000000"}
        onChange={strokeColor => updateStyle({ strokeColor })} className="h-7 w-32 min-w-0 text-xs" /></Field>
      <Field label="Outline Width"><SubtitleNumberInput label="Outline Width" value={style.strokeWidth ?? 0} min={0} max={20} step={0.5} onCommit={strokeWidth => updateStyle({ strokeWidth })} /></Field>
      <Field label="Shadow Color"><ColorPicker label="Select caption shadow color" value={style.shadowColor ?? "#000000"} showAlpha
        onChange={shadowColor => updateStyle({ shadowColor })} className="h-7 w-32 min-w-0 text-xs" /></Field>
      <Field label="Shadow Blur"><SubtitleNumberInput label="Shadow Blur" value={style.shadowBlur ?? 0} min={0} max={40} onCommit={shadowBlur => updateStyle({ shadowBlur })} /></Field>
      <Field label="Shadow X"><SubtitleNumberInput label="Shadow X" value={style.shadowOffsetX ?? 0} min={-40} max={40} onCommit={shadowOffsetX => updateStyle({ shadowOffsetX })} /></Field>
      <Field label="Shadow Y"><SubtitleNumberInput label="Shadow Y" value={style.shadowOffsetY ?? 0} min={-40} max={40} onCommit={shadowOffsetY => updateStyle({ shadowOffsetY })} /></Field>
      {(style.shadowColor || style.strokeWidth) && <Button type="button" variant="ghost" className="h-7 w-full text-xs"
        onClick={() => updateStyle({ strokeColor: undefined, strokeWidth: undefined, shadowColor: undefined, shadowBlur: undefined, shadowOffsetX: undefined, shadowOffsetY: undefined })}>Remove outline and shadow</Button>}
    </div></Section>
    <Section title="Box & Safe Area"><div className="space-y-3">
      <Field label="Box Padding X"><SubtitleNumberInput label="Box Padding X" value={style.boxPaddingX ?? 10} min={0} max={80} onCommit={boxPaddingX => updateStyle({ boxPaddingX })} /></Field>
      <Field label="Box Padding Y"><SubtitleNumberInput label="Box Padding Y" value={style.boxPaddingY ?? 0} min={0} max={80} onCommit={boxPaddingY => updateStyle({ boxPaddingY })} /></Field>
      <Field label="Corner Radius"><SubtitleNumberInput label="Corner Radius" value={style.boxRadius ?? 0} min={0} max={80} onCommit={boxRadius => updateStyle({ boxRadius })} /></Field>
      <Field label="Safe Margin %"><SubtitleNumberInput label="Safe Margin percent" value={Math.round((style.safeMargin ?? 0) * 1000) / 10} min={0} max={25} step={0.5}
        onCommit={percent => updateStyle({ safeMargin: percent / 100 })} /></Field>
      <p className="text-[9px] text-fg-2">Keeps the caption this far from every edge (title-safe is 5 to 10 percent).</p>
    </div></Section>
    <Section title="WebVTT Cue Settings"><div className="space-y-3">
      <Field label="Line"><SubtitleNumberInput label="Cue line" value={cue.line ?? 0} min={-20} max={100} step={1}
        onCommit={line => updateCue({ line })} /></Field>
      <Field label="Line unit"><Select value={cue.snapToLines === false ? "percent" : "lines"} onValueChange={value => updateCue({ snapToLines: value === "lines" })}>
        <SelectTrigger aria-label="Cue line unit" className="h-7 w-28 rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="lines">Lines</SelectItem><SelectItem value="percent">Percent</SelectItem></SelectContent>
      </Select></Field>
      <Field label="Position %"><SubtitleNumberInput label="Cue position" value={cue.position ?? 50} min={0} max={100} onCommit={position => updateCue({ position })} /></Field>
      <Field label="Size %"><SubtitleNumberInput label="Cue size" value={cue.size ?? 100} min={1} max={100} onCommit={size => updateCue({ size })} /></Field>
      <Field label="Align"><Select value={cue.align ?? "center"} onValueChange={value => updateCue({ align: value as CueSettings["align"] })}>
        <SelectTrigger aria-label="Cue align" className="h-7 w-28 rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{(["start", "center", "end", "left", "right"] as const).map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
      </Select></Field>
      {subtitle.cueSettings && <Button type="button" variant="ghost" className="h-7 w-full text-xs" onClick={() => update({ cueSettings: undefined })}>Clear cue settings</Button>}
      <p className="text-[9px] text-fg-2">Overrides the position above and is written to WebVTT export. SRT cannot store cue settings.</p>
    </div></Section>
    <Section title="Saved Styles"><SavedStylesSection kind="caption" targetId={subtitle.id} /></Section>
    <div className="border-t border-border pt-4"><Button type="button" variant="destructive" className="h-8 w-full text-xs"
      onClick={() => { if (currentSubtitle()) useProjectStore.getState().removeSubtitle(subtitle.id); }}>Delete Subtitle</Button></div>
  </div>;
}

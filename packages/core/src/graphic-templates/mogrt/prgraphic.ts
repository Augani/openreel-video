import { gunzip, looksLikeGzip } from "../../interchange/prproj";
import { parseXml, type XmlElement } from "../../interchange/xml";
import { parseMogrtColor } from "./definition";

/**
 * Premiere graphic (`*.prgraphic`, or the graphic inside `project.prproj`) reader.
 *
 * HONEST STATUS: Adobe does not document this format, and no Premiere-written file was available here. The layout
 * below follows the object style of the .prproj documents the importer already reads (see interchange/prproj.ts):
 * gzip XML, `<PremiereData>` root, times in 254016000000 ticks per second, and per-layer elements with a transform
 * and (for editable properties) a `ControlID` attribute that ties them to a definition.json control. Names are read
 * case-insensitively, a value may be an attribute or a child element, and a few spellings of each are accepted.
 * Whatever is not understood lands in `PrgLayer.unsupported` / `PrgGraphic.notes` and from there in the import
 * report; nothing is dropped silently.
 *
 *   <PremiereData Version="3">
 *     <Graphic Name="..."> <Width/> <Height/> <FrameRate/> <Duration/> (ticks) | <DurationSeconds/>
 *       <ResponsiveTime IntroDuration="..." OutroDuration="..."/>        (seconds)
 *       <Layers Order="TopToBottom">                                     (panel order; BottomToTop also read)
 *         <TextLayer Name ID Visible> <Bounds X Y Width Height/> <Transform> <Position/> <Anchor/> <Scale/> <Rotation/>
 *           <Opacity/> </Transform> <Text ControlID/> <Font/> <FontStyle/> <FontSize/> <FillColor/> <Alignment/>
 *           <Tracking/> <Leading/> <Stroke/> <Shadow/> ...
 *         <ShapeLayer Type="Rectangle|Ellipse|Path"> <Fill/> <Stroke/> <CornerRadius/> <Shadow/> ...
 *         <ImageLayer> <Source>media/logo.png</Source> ...
 *         <GroupLayer> (child layers)
 */

const TICKS_PER_SECOND = 254_016_000_000;

export interface PrgKey {
  readonly t: number;
  readonly v: readonly number[];
  readonly interp: string;
}

export interface PrgProp {
  readonly value?: readonly number[];
  readonly keys: readonly PrgKey[];
}

export interface PrgShadow {
  readonly color: string;
  readonly opacity: number;
  readonly angle: number;
  readonly distance: number;
  readonly blur: number;
}

/** One styled stretch of a text layer; absent fields inherit the layer's style. */
export interface PrgTextRun {
  readonly text: string;
  readonly fontFamily?: string;
  readonly fontStyle?: string;
  readonly fontSize?: number;
  readonly color?: string;
  readonly tracking?: number;
  readonly baselineShift?: number;
  readonly underline?: boolean;
  readonly allCaps?: boolean;
}

export interface PrgText {
  readonly text: string;
  /** Present only when the runs differ in styling. */
  readonly runs?: readonly PrgTextRun[];
  readonly fontFamily?: string;
  readonly fontStyle?: string;
  readonly fontSize?: number;
  readonly color?: string;
  readonly align?: string;
  readonly tracking?: number;
  readonly leading?: number;
  readonly allCaps?: boolean;
  readonly underline?: boolean;
  readonly stroke?: { readonly color: string; readonly width: number };
  readonly shadow?: PrgShadow;
}

export interface PrgGradient {
  readonly type: "linear" | "radial";
  readonly angle: number;
  readonly stops: readonly { readonly offset: number; readonly color: string }[];
}

export interface PrgShape {
  readonly type: "rectangle" | "ellipse";
  readonly fill?: string;
  readonly gradient?: PrgGradient;
  readonly stroke?: { readonly color: string; readonly width: number };
  readonly cornerRadius?: number;
  readonly shadow?: PrgShadow;
}

export type PrgLayerKind = "text" | "shape" | "image" | "unsupported";

export interface PrgLayer {
  readonly id: string;
  readonly name: string;
  readonly kind: PrgLayerKind;
  /** Element name as found, for the report. */
  readonly tag: string;
  readonly visible: boolean;
  /** Layer-local box. */
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly position?: PrgProp;
  readonly anchor?: readonly number[];
  readonly scale?: PrgProp;
  readonly rotation?: PrgProp;
  readonly opacity?: PrgProp;
  /** Offset / opacity inherited from group layers (rotation and scale of groups are reported, not applied). */
  readonly groupOffset: { readonly x: number; readonly y: number };
  readonly groupOpacity: number;
  readonly text?: PrgText;
  readonly shape?: PrgShape;
  readonly imageSource?: string;
  /** Normalised property name -> definition.json control id. */
  readonly controls: Readonly<Record<string, string>>;
  readonly unsupported: readonly string[];
}

export interface PrgGraphic {
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly fps?: number;
  /** Seconds. */
  readonly duration?: number;
  readonly introDuration?: number;
  readonly outroDuration?: number;
  /** Bottom to top, the order the template paints them. */
  readonly layers: readonly PrgLayer[];
  readonly notes: readonly string[];
}

// ── XML helpers ─────────────────────────────────────────────────────────────

const lower = (s: string): string => s.toLowerCase();

function attr(el: XmlElement, ...names: string[]): string | undefined {
  const wanted = names.map(lower);
  for (const [key, value] of Object.entries(el.attrs)) if (wanted.includes(lower(key))) return value;
  return undefined;
}

function child(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  if (!el) return undefined;
  const wanted = names.map(lower);
  return el.children.find((c) => wanted.includes(lower(c.name)));
}

/** First of `names` that is an attribute or child of `el` (or of its Transform child). */
function find(el: XmlElement, ...names: string[]): XmlElement | undefined {
  const direct = child(el, ...names);
  if (direct) return direct;
  const transform = child(el, "Transform", "Transformation", "Motion");
  return child(transform, ...names);
}

/** Scalar text of a property: attribute `Value`, own text, or a `Value` child. */
function raw(el: XmlElement | undefined): string | undefined {
  if (!el) return undefined;
  const a = attr(el, "Value", "Val");
  if (a !== undefined) return a;
  if (el.text) return el.text;
  const v = child(el, "Value");
  return v ? raw(v) : undefined;
}

function str(el: XmlElement, ...names: string[]): string | undefined {
  const a = attr(el, ...names);
  if (a !== undefined) return a;
  return raw(child(el, ...names));
}

function numberOf(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text.trim().replace(/%$/, ""));
  return Number.isFinite(n) ? n : undefined;
}

function num(el: XmlElement, ...names: string[]): number | undefined {
  return numberOf(str(el, ...names));
}

function bool(text: string | undefined): boolean | undefined {
  if (text === undefined) return undefined;
  const t = text.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(t)) return true;
  if (["false", "0", "no", "off"].includes(t)) return false;
  return undefined;
}

function numbers(el: XmlElement | undefined): number[] | undefined {
  if (!el) return undefined;
  const x = attr(el, "X");
  const y = attr(el, "Y");
  if (x !== undefined && y !== undefined && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) return [Number(x), Number(y)];
  const text = raw(el);
  if (text !== undefined) {
    const parts = text.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (parts.length > 0 && parts.every(Number.isFinite)) return parts;
  }
  const cx = child(el, "X");
  const cy = child(el, "Y");
  if (cx && cy) {
    const a = Number(raw(cx));
    const b = Number(raw(cy));
    if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
  }
  return undefined;
}

function readTime(el: XmlElement): number | undefined {
  const seconds = attr(el, "TimeSeconds", "Seconds") ?? raw(child(el, "TimeSeconds", "Seconds"));
  if (seconds !== undefined && Number.isFinite(Number(seconds))) return Number(seconds);
  const ticks = attr(el, "Time", "Ticks") ?? raw(child(el, "Time", "Ticks"));
  if (ticks !== undefined && /^-?\d+$/.test(ticks.trim())) return Number(BigInt(ticks.trim())) / TICKS_PER_SECOND;
  return undefined;
}

function readProp(el: XmlElement | undefined): PrgProp | undefined {
  if (!el) return undefined;
  const keyEls = el.children.filter((c) => /^(keyframe|key)$/i.test(c.name)).concat(
    el.children.filter((c) => /^keyframes$/i.test(c.name)).flatMap((k) => k.children.filter((c) => /^(keyframe|key)$/i.test(c.name))),
  );
  const keys: PrgKey[] = [];
  for (const k of keyEls) {
    const t = readTime(k);
    const v = numbers(k);
    if (t === undefined || !v) continue;
    keys.push({ t, v, interp: (attr(k, "Interpolation", "Interp", "Type") ?? "linear").toLowerCase() });
  }
  keys.sort((a, b) => a.t - b.t);
  const value = numbers(el);
  return keys.length || value ? { ...(value ? { value } : {}), keys } : undefined;
}

export function colorOf(el: XmlElement | undefined): string | undefined {
  if (!el) return undefined;
  const text = raw(el) ?? attr(el, "Color", "Hex");
  if (text) {
    const hex = parseMogrtColor(text);
    if (hex) return hex;
    const parts = text.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) return parseMogrtColor(parts);
  }
  const channel = (...names: string[]) => {
    const own = names.map((n) => attr(el, n)).find((v) => v !== undefined);
    const nested = own ?? raw(child(el, ...names));
    return nested === undefined ? undefined : Number(nested);
  };
  const r = channel("Red", "R");
  const g = channel("Green", "G");
  const b = channel("Blue", "B");
  const a = channel("Alpha", "A");
  if (r !== undefined && g !== undefined && b !== undefined && [r, g, b].every(Number.isFinite)) {
    return parseMogrtColor(a !== undefined && Number.isFinite(a) ? [r, g, b, a] : [r, g, b]);
  }
  const inner = child(el, "Color", "FillColor");
  return inner && inner !== el ? colorOf(inner) : undefined;
}

function readShadow(el: XmlElement | undefined): PrgShadow | undefined {
  if (!el) return undefined;
  if (bool(attr(el, "Enabled", "Visible")) === false) return undefined;
  return {
    color: colorOf(child(el, "Color")) ?? parseMogrtColor(attr(el, "Color") ?? "") ?? "#000000",
    opacity: (num(el, "Opacity") ?? 75) / 100,
    angle: num(el, "Angle", "Direction") ?? 135,
    distance: num(el, "Distance") ?? 5,
    blur: num(el, "Blur", "Size") ?? 5,
  };
}

function readStroke(el: XmlElement | undefined): { color: string; width: number } | undefined {
  if (!el) return undefined;
  if (bool(attr(el, "Enabled", "Visible")) === false) return undefined;
  const width = num(el, "Width", "Size") ?? 0;
  if (!(width > 0)) return undefined;
  return { color: colorOf(child(el, "Color")) ?? parseMogrtColor(attr(el, "Color") ?? "") ?? "#000000", width };
}

const CONTROL_PROPS: Record<string, string> = {
  text: "text", sourcetext: "text", fillcolor: "fillColor", fill: "fillColor", color: "fillColor",
  strokecolor: "strokeColor", strokewidth: "strokeWidth", stroke: "strokeColor", fontsize: "fontSize", size: "fontSize",
  font: "font", fontfamily: "font", position: "position", scale: "scale", rotation: "rotation", opacity: "opacity",
  visible: "visible", visibility: "visible",
};

function collectControls(layer: XmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (el: XmlElement, depth: number) => {
    for (const c of el.children) {
      const id = attr(c, "ControlID", "ClientControlID", "ControlId", "ExposedAs");
      const prop = CONTROL_PROPS[lower(c.name)];
      if (id && prop && !(prop in out)) out[prop] = id;
      if (depth < 1 && /^(transform|transformation|motion)$/i.test(c.name)) visit(c, depth + 1);
    }
  };
  visit(layer, 0);
  return out;
}

function mapKind(tag: string, el: XmlElement): { kind: PrgLayerKind; shapeType?: PrgShape["type"]; label?: string } {
  const t = lower(tag);
  const declared = lower(attr(el, "Type", "ShapeType") ?? "");
  if (/text/.test(t)) return { kind: "text" };
  if (/image|picture|media|bitmap/.test(t)) return { kind: "image" };
  if (/ellipse|oval|circle/.test(t) || /ellipse|oval|circle/.test(declared)) return { kind: "shape", shapeType: "ellipse" };
  if (/rect/.test(t) || /^rect/.test(declared)) return { kind: "shape", shapeType: "rectangle" };
  if (/shape/.test(t) && declared === "") return { kind: "shape", shapeType: "rectangle" };
  return { kind: "unsupported", label: attr(el, "Type") ?? tag.replace(/Layer$/i, "") };
}

const LAYER_TAG = /^[A-Za-z]*(Layer|GraphicItem)$/;

function readText(el: XmlElement, _notes: string[]): PrgText {
  const runs = (child(el, "Runs", "TextRuns")?.children ?? []).filter((r) => /^(run|textrun)$/i.test(r.name));
  const source = runs.length ? runs[0] : el;
  const textEl = child(el, "Text", "SourceText", "Content", "String");
  let text = runs.length ? runs.map((r) => str(r, "Text", "Content") ?? r.text).join("") : (textEl ? (attr(textEl, "Value") ?? textEl.text) : str(el, "Text")) ?? "";
  text = text.replace(/\r\n?/g, "\n");
  let styledRuns: PrgTextRun[] | undefined;
  if (runs.length > 1) {
    const sig = (r: XmlElement) => [str(r, "Font", "FontFamily"), str(r, "FontStyle"), str(r, "FontSize"), colorOf(child(r, "FillColor", "Fill", "Color")), str(r, "Tracking", "Kerning"), str(r, "BaselineShift"), str(r, "Underline"), str(r, "AllCaps", "Caps")].join("|");
    if (new Set(runs.map(sig)).size > 1) {
      styledRuns = runs.map((r): PrgTextRun => {
        const fill = colorOf(child(r, "FillColor", "Fill", "Color"));
        const family = str(r, "Font", "FontFamily");
        const fontStyle = str(r, "FontStyle", "FontStyleName");
        const size = numberOf(str(r, "FontSize", "Size"));
        const tracking = numberOf(str(r, "Tracking", "Kerning"));
        const shift = numberOf(str(r, "BaselineShift"));
        return {
          text: (str(r, "Text", "Content") ?? r.text).replace(/\r\n?/g, "\n"),
          ...(family ? { fontFamily: family } : {}),
          ...(fontStyle ? { fontStyle } : {}),
          ...(size !== undefined ? { fontSize: size } : {}),
          ...(fill ? { color: fill } : {}),
          ...(tracking !== undefined ? { tracking } : {}),
          ...(shift !== undefined ? { baselineShift: shift } : {}),
          ...(bool(str(r, "Underline")) ? { underline: true } : {}),
          ...(bool(str(r, "AllCaps", "Caps")) ? { allCaps: true } : {}),
        };
      });
    }
  }
  const get = (...names: string[]) => str(source, ...names) ?? str(el, ...names);
  const strokeEl = child(source, "Stroke") ?? child(el, "Stroke");
  const underline = bool(get("Underline"));
  return {
    text,
    ...(styledRuns ? { runs: styledRuns } : {}),
    ...(get("Font", "FontFamily") ? { fontFamily: get("Font", "FontFamily") } : {}),
    ...(get("FontStyle", "FontStyleName") ? { fontStyle: get("FontStyle", "FontStyleName") } : {}),
    ...(numberOf(get("FontSize", "Size")) !== undefined ? { fontSize: numberOf(get("FontSize", "Size")) } : {}),
    ...(colorOf(child(source, "FillColor", "Fill", "Color") ?? child(el, "FillColor", "Fill", "Color")) ? { color: colorOf(child(source, "FillColor", "Fill", "Color") ?? child(el, "FillColor", "Fill", "Color")) } : {}),
    ...(get("Alignment", "Align", "Justification") ? { align: get("Alignment", "Align", "Justification")!.toLowerCase() } : {}),
    ...(numberOf(get("Tracking", "Kerning")) !== undefined ? { tracking: numberOf(get("Tracking", "Kerning")) } : {}),
    ...(numberOf(get("Leading", "LineSpacing")) !== undefined ? { leading: numberOf(get("Leading", "LineSpacing")) } : {}),
    ...(bool(get("AllCaps", "Caps")) ? { allCaps: true } : {}),
    ...(underline ? { underline } : {}),
    ...(readStroke(strokeEl) ? { stroke: readStroke(strokeEl) } : {}),
    ...(readShadow(child(el, "Shadow", "DropShadow")) ? { shadow: readShadow(child(el, "Shadow", "DropShadow")) } : {}),
  };
}

function readGradient(el: XmlElement): PrgGradient | undefined {
  const stops = (el.children.filter((c) => /^(stop|colorstop)$/i.test(c.name)))
    .map((s) => ({ offset: Math.min(1, Math.max(0, (num(s, "Offset", "Position") ?? 0) > 1 ? (num(s, "Offset", "Position") ?? 0) / 100 : (num(s, "Offset", "Position") ?? 0))), color: colorOf(child(s, "Color")) ?? parseMogrtColor(attr(s, "Color") ?? "") }))
    .filter((s): s is { offset: number; color: string } => typeof s.color === "string");
  if (stops.length < 2) return undefined;
  return { type: /radial/i.test(attr(el, "Type", "Kind") ?? "") ? "radial" : "linear", angle: num(el, "Angle") ?? 0, stops };
}

function readShape(el: XmlElement, shapeType: PrgShape["type"], notes: string[]): PrgShape {
  const fillEl = child(el, "Fill", "FillColor");
  const gradEl = fillEl ? child(fillEl, "Gradient") ?? (/gradient/i.test(attr(fillEl, "Type") ?? "") ? fillEl : undefined) : child(el, "Gradient");
  const gradient = gradEl ? readGradient(gradEl) : undefined;
  if (gradEl && !gradient) notes.push("fill gradient could not be read; solid fill used");
  const fillEnabled = fillEl ? bool(attr(fillEl, "Enabled", "Visible")) !== false : true;
  const fill = fillEnabled && !gradient ? colorOf(fillEl && child(fillEl, "Color") ? child(fillEl, "Color") : fillEl) : undefined;
  return {
    type: shapeType,
    ...(fill ? { fill } : {}),
    ...(gradient ? { gradient } : {}),
    ...(readStroke(child(el, "Stroke")) ? { stroke: readStroke(child(el, "Stroke")) } : {}),
    ...(num(el, "CornerRadius", "Roundness", "Radius") !== undefined ? { cornerRadius: num(el, "CornerRadius", "Roundness", "Radius") } : {}),
    ...(readShadow(child(el, "Shadow", "DropShadow")) ? { shadow: readShadow(child(el, "Shadow", "DropShadow")) } : {}),
  };
}

function unsupportedFeatures(el: XmlElement): string[] {
  const out: string[] = [];
  if (child(el, "Mask", "Masks")) out.push("mask");
  if (child(el, "Effects", "Effect")) out.push("effects");
  const blend = str(el, "BlendMode");
  if (blend && !/^normal$/i.test(blend)) out.push(`blend mode ${blend}`);
  if (child(el, "TrackMatte", "Matte")) out.push("track matte");
  if (child(el, "ResponsiveLayout", "ResponsiveDesign", "Pin", "Pins")) out.push("responsive design (position pins)");
  if (child(el, "Animator", "Animators", "TextAnimator")) out.push("text animators");
  if (child(el, "Path") && !/rect|ellipse/i.test(el.name)) out.push("path data");
  return out;
}

function readLayer(el: XmlElement, index: number, parent: { x: number; y: number; opacity: number }, layers: PrgLayer[], notes: string[]): void {
  const name = attr(el, "Name") ?? str(el, "Name", "LayerName") ?? `Layer ${index + 1}`;
  const id = attr(el, "ID", "ObjectUID", "ObjectID", "UID") ?? `layer-${layers.length + 1}`;
  const visible = bool(attr(el, "Visible", "Enabled") ?? raw(child(el, "Visible", "Enabled"))) ?? true;

  if (/group/i.test(el.name)) {
    const pos = numbers(find(el, "Position")) ?? [0, 0];
    const anchor = numbers(find(el, "Anchor", "AnchorPoint")) ?? [0, 0];
    const scale = numbers(find(el, "Scale")) ?? [100, 100];
    const rotation = num(el, "Rotation") ?? numberOf(raw(find(el, "Rotation"))) ?? 0;
    if (Math.abs(scale[0] - 100) > 0.01 || Math.abs((scale[1] ?? scale[0]) - 100) > 0.01 || Math.abs(rotation) > 0.01) {
      notes.push(`group "${name}": its scale / rotation are not applied to the layers inside it (only position and opacity are)`);
    }
    const opacity = (numberOf(raw(find(el, "Opacity"))) ?? 100) / 100;
    const inner = { x: parent.x + pos[0] - anchor[0], y: parent.y + pos[1] - anchor[1], opacity: parent.opacity * opacity };
    const holder = child(el, "Layers", "Children") ?? el;
    const flip = /^bottom/i.test(attr(holder, "Order") ?? "");
    const kids = holder.children.filter((c) => LAYER_TAG.test(c.name));
    (flip ? kids : [...kids].reverse()).forEach((k, i) => readLayer(k, i, inner, layers, notes));
    if (!visible) notes.push(`group "${name}" is hidden: its layers are imported hidden`);
    return;
  }

  const { kind, shapeType, label } = mapKind(el.name, el);
  const unsupported = unsupportedFeatures(el);
  const b = child(el, "Bounds", "Box", "Frame");
  const bounds = {
    x: b ? (num(b, "X", "Left") ?? 0) : 0,
    y: b ? (num(b, "Y", "Top") ?? 0) : 0,
    w: b ? (num(b, "Width", "W") ?? 0) : (num(el, "Width") ?? 0),
    h: b ? (num(b, "Height", "H") ?? 0) : (num(el, "Height") ?? 0),
  };
  const textNotes: string[] = [];
  const layer: PrgLayer = {
    id,
    name,
    kind,
    tag: label ?? el.name,
    visible,
    bounds,
    ...(readProp(find(el, "Position")) ? { position: readProp(find(el, "Position")) } : {}),
    ...(numbers(find(el, "Anchor", "AnchorPoint")) ? { anchor: numbers(find(el, "Anchor", "AnchorPoint")) } : {}),
    ...(readProp(find(el, "Scale")) ? { scale: readProp(find(el, "Scale")) } : {}),
    ...(readProp(find(el, "Rotation")) ? { rotation: readProp(find(el, "Rotation")) } : {}),
    ...(readProp(find(el, "Opacity")) ? { opacity: readProp(find(el, "Opacity")) } : {}),
    groupOffset: { x: parent.x, y: parent.y },
    groupOpacity: parent.opacity,
    ...(kind === "text" ? { text: readText(el, textNotes) } : {}),
    ...(kind === "shape" && shapeType ? { shape: readShape(el, shapeType, textNotes) } : {}),
    ...(kind === "image" ? { imageSource: str(el, "Source", "File", "Path", "Href") ?? raw(child(el, "Source", "File", "Path")) } : {}),
    controls: collectControls(el),
    unsupported: [...unsupported, ...textNotes],
  };
  layers.push(layer);
}

/** Parse graphic XML text (already gunzipped). */
export function parsePrgraphicXml(xml: string): PrgGraphic {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    throw new Error(`The graphic XML could not be read: ${error instanceof Error ? error.message : "parse error"}`);
  }
  const notes: string[] = [];
  // The graphic root: an element named *Graphic*/Document holding a Layers list, else the root itself.
  const holders: XmlElement[] = [];
  const walk = (el: XmlElement) => {
    if (/^layers$/i.test(el.name) && el.children.some((c) => LAYER_TAG.test(c.name))) holders.push(el);
    else el.children.forEach(walk);
  };
  walk(root);
  const holder = holders[0];
  if (holders.length > 1) notes.push(`the file holds ${holders.length} layer lists; the first one is imported`);
  const owner = findOwner(root, holder) ?? root;
  const out: PrgLayer[] = [];
  if (holder) {
    const kids = holder.children.filter((c) => LAYER_TAG.test(c.name));
    const bottomFirst = /^bottom/i.test(attr(holder, "Order") ?? "");
    (bottomFirst ? kids : [...kids].reverse()).forEach((k, i) => readLayer(k, i, { x: 0, y: 0, opacity: 1 }, out, notes));
  }
  const responsive = [owner, ...owner.children].find((c) => /^responsivetime$/i.test(c.name));
  const durationSeconds = num(owner, "DurationSeconds");
  const durationTicks = str(owner, "Duration");
  const duration = durationSeconds ?? (durationTicks && /^\d+$/.test(durationTicks.trim()) ? Number(BigInt(durationTicks.trim())) / TICKS_PER_SECOND : numberOf(durationTicks));
  return {
    ...(str(owner, "Name") ? { name: str(owner, "Name") } : {}),
    width: num(owner, "Width") ?? 1920,
    height: num(owner, "Height") ?? 1080,
    ...(num(owner, "FrameRate", "Fps") !== undefined ? { fps: num(owner, "FrameRate", "Fps") } : {}),
    ...(duration !== undefined && duration > 0 ? { duration } : {}),
    ...(responsive && num(responsive, "IntroDuration") !== undefined ? { introDuration: num(responsive, "IntroDuration") } : {}),
    ...(responsive && num(responsive, "OutroDuration") !== undefined ? { outroDuration: num(responsive, "OutroDuration") } : {}),
    layers: out,
    notes,
  };
}

function findOwner(root: XmlElement, holder: XmlElement | undefined): XmlElement | undefined {
  if (!holder) return undefined;
  const path = (el: XmlElement, trail: XmlElement[]): XmlElement[] | undefined => {
    if (el === holder) return trail;
    for (const c of el.children) {
      const found = path(c, [...trail, el]);
      if (found) return found;
    }
    return undefined;
  };
  const trail = path(root, []);
  return trail ? trail[trail.length - 1] : undefined;
}

/** Parse a `.prgraphic` / graphic-bearing `.prproj` (gzip XML or plain XML). */
export async function parsePrgraphic(bytes: Uint8Array): Promise<PrgGraphic> {
  const xmlBytes = looksLikeGzip(bytes) ? await gunzip(bytes) : bytes;
  return parsePrgraphicXml(new TextDecoder("utf-8").decode(xmlBytes));
}

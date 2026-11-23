import type { CueSettings, Subtitle, SubtitleStyle } from "../types/timeline";
import type { CaptionFormatIssue } from "./scc";
import { DEFAULT_CAPTION_STYLE } from "./caption-layout";
import { timecodeProblem, timecodeToFrames } from "./caption-timecode";

/**
 * TTML / DFXP / IMSC1 import. A small tolerant XML tokenizer (no DOMParser, so
 * it runs in workers, Node and the desktop shell alike) feeds a TTML reader:
 * media / clock / smpte time bases, clock-time, offset-time (h m s ms f t) and
 * frame expressions, begin / end / dur with parent-relative timing, `<style>`
 * and `<region>` resolution (referential and inline), and `ttm:agent` speakers.
 * Colours, alignment, display alignment, region origin / extent, outline,
 * italic / bold / underline are mapped onto the caption style model.
 */

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: Array<XmlNode | string>;
  line: number;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** Parse into a tree of elements keyed by their local (prefix-free) names; attributes too. */
function parseXml(source: string): XmlNode | undefined {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], line: 1 };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let line = 1;
  let counted = 0;
  const lineAt = (index: number) => {
    for (; counted < index; counted++) if (source.charCodeAt(counted) === 10) line++;
    return line;
  };
  const text = (value: string) => {
    if (value) stack[stack.length - 1].children.push(decode(value));
  };
  for (let m = re.exec(source); m; m = re.exec(source)) {
    text(source.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) {
      stack[stack.length - 1].children.push(m[1]);
    } else if (m[2] !== undefined) {
      const name = localName(m[2]);
      // Close to the nearest matching open element; stray closers are ignored.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      for (let a = attrRe.exec(m[4] ?? ""); a; a = attrRe.exec(m[4] ?? "")) {
        const key = a[1].startsWith("xmlns") ? a[1] : localName(a[1]);
        attrs[key] = decode(a[2] ?? a[3] ?? a[4] ?? "");
      }
      const node: XmlNode = { name: localName(m[3]), attrs, children: [], line: lineAt(m.index) };
      stack[stack.length - 1].children.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  text(source.slice(last));
  return root.children.find((c): c is XmlNode => typeof c !== "string" && c.name === "tt");
}

/**
 * A TTML document starts with an XML prolog / comments / doctype and then a `<tt>` root.
 * Anchoring to the start keeps an SRT whose cue text contains `<tt>` (teletype) or other
 * inline markup from being mistaken for TTML.
 */
export function isTtmlContent(content: string): boolean {
  const head = content.replace(/^\uFEFF/, "").slice(0, 8192);
  return /^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<(?:[A-Za-z_][\w.-]*:)?tt[\s>]/.test(head);
}

interface TimeContext {
  timeBase: "media" | "smpte" | "clock";
  frameRate: number;
  tickRate: number;
  /** `ttp:dropMode="dropNTSC"` (smpte time base): HH:MM:SS:FF labels skip frames 0-1 each minute except every tenth. */
  dropNtsc?: boolean;
  /** Timecode base (frames per second label), e.g. 30 for 29.97. */
  nominalRate?: number;
}

function parseTime(raw: string | undefined, ctx: TimeContext): number | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  let m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)(?::(\d+)(?:\.(\d+))?)?$/.exec(v);
  if (m) {
    if (m[4] && ctx.dropNtsc && ctx.timeBase === "smpte" && /^\d+$/.test(m[3])) {
      const nominal = ctx.nominalRate ?? Math.round(ctx.frameRate);
      const dropRate = { fps: ctx.frameRate, nominal, dropFrame: true };
      const label = `${m[1]}:${m[2]}:${m[3]};${m[4].padStart(2, "0")}`;
      const f = timecodeToFrames(label, dropRate);
      if (f !== null) return f / ctx.frameRate;
      // A dropped label (00:01:00:02 is fine, 00:01:00:00 is not) is invalid: report it instead of guessing.
      if (timecodeProblem(label, dropRate)?.includes("dropped")) {
        return NaN;
      }
    }
    if (m[4] && ctx.timeBase === "smpte" && /^\d+$/.test(m[3])) {
      // SMPTE labels count frames at the nominal base (30 for 29.97) and the clock runs at the effective rate.
      const nominal = ctx.nominalRate ?? Math.round(ctx.frameRate);
      return ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * nominal + Number(m[4])) / ctx.frameRate;
    }
    const frames = m[4] ? Number(m[4]) / ctx.frameRate : 0;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frames;
  }
  m = /^(\d+(?:\.\d+)?|\.\d+)(h|ms|m|s|f|t)$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    switch (m[2]) {
      case "h": return n * 3600;
      case "m": return n * 60;
      case "s": return n;
      case "ms": return n / 1000;
      case "f": return n / ctx.frameRate;
      case "t": return n / ctx.tickRate;
    }
  }
  // Bare numbers are seconds in the wild, even though the spec wants a metric.
  if (/^\d+(?:\.\d+)?$/.test(v)) return Number(v);
  return NaN;
}

type Attrs = Record<string, string>;

/** `#RGB`, `#RRGGBB`, `#RRGGBBAA`, `rgb()/rgba()` and CSS names -> a CSS colour string. */
function colour(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (/^transparent$/i.test(v)) return "rgba(0,0,0,0)";
  if (/^#[0-9a-f]{8}$/i.test(v)) {
    const a = parseInt(v.slice(7, 9), 16) / 255;
    return `rgba(${parseInt(v.slice(1, 3), 16)},${parseInt(v.slice(3, 5), 16)},${parseInt(v.slice(5, 7), 16)},${Math.round(a * 100) / 100})`;
  }
  if (/^#[0-9a-f]{6}$/i.test(v) || /^#[0-9a-f]{3}$/i.test(v)) return v;
  if (/^rgba?\(/i.test(v) || /^[a-z]+$/i.test(v)) return v.toLowerCase();
  return undefined;
}

const GENERIC_FONTS: Record<string, string> = {
  default: "sans-serif",
  monospace: "monospace",
  sansserif: "sans-serif",
  serif: "serif",
  monospacesansserif: "monospace",
  monospaceserif: "monospace",
  proportionalsansserif: "sans-serif",
  proportionalserif: "serif",
};

const percent = (raw: string | undefined): number | undefined => {
  const m = /^(-?\d+(?:\.\d+)?)%$/.exec((raw ?? "").trim());
  return m ? Number(m[1]) : undefined;
};

export interface TtmlParseOptions {
  language?: string;
  captionTrackId?: string;
  /** Seconds subtracted from every time (e.g. a 01:00:00:00 programme start). */
  offsetSeconds?: number;
  /** Frame rate for frame-based times when the file declares none. */
  frameRate?: number;
  /** Keep <i> / <b> / <u> for styled runs (default: strip). */
  styleTags?: "keep" | "strip";
}

export interface TtmlParseResult {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  issues: CaptionFormatIssue[];
}

let counter = 0;

export function parseTtml(content: string, options: TtmlParseOptions = {}): TtmlParseResult {
  const errors: TtmlParseResult["errors"] = [];
  const issues: CaptionFormatIssue[] = [];
  const empty = { subtitles: [], errors, issues };
  const source = content.replace(/^\uFEFF/, "");
  const tt = parseXml(source);
  if (!tt) {
    errors.push({ line: 1, message: "Not a TTML document: no <tt> root element was found." });
    return empty;
  }
  const child = (n: XmlNode, name: string) => n.children.find((c): c is XmlNode => typeof c !== "string" && c.name === name);
  const kids = (n: XmlNode, name: string) => n.children.filter((c): c is XmlNode => typeof c !== "string" && c.name === name);
  const descendants = (n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] => {
    for (const c of n.children) if (typeof c !== "string") {
      if (c.name === name) out.push(c);
      descendants(c, name, out);
    }
    return out;
  };

  const rate = Number(tt.attrs.frameRate) || options.frameRate || 30;
  const mult = /^(\d+)\s+(\d+)$/.exec((tt.attrs.frameRateMultiplier ?? "").trim());
  const ctx: TimeContext = {
    timeBase: tt.attrs.timeBase === "smpte" ? "smpte" : tt.attrs.timeBase === "clock" ? "clock" : "media",
    frameRate: mult ? (rate * Number(mult[1])) / Number(mult[2]) : rate,
    dropNtsc: /^dropNTSC$/i.test((tt.attrs.dropMode ?? "").trim()),
    nominalRate: rate,
    tickRate: Number(tt.attrs.tickRate) || (tt.attrs.frameRate ? rate * (Number(tt.attrs.subFrameRate) || 1) : 1),
  };
  if (ctx.timeBase === "clock") issues.push({ severity: "warning", code: "ttml-clock", message: "Wall-clock time base: times are read as media times." });
  const language = options.language ?? (tt.attrs.lang || undefined);

  const head = child(tt, "head");
  const styles = new Map<string, Attrs>();
  const regions = new Map<string, Attrs>();
  const agents = new Map<string, string>();
  if (head) {
    for (const s of descendants(head, "style")) if (s.attrs.id) styles.set(s.attrs.id, s.attrs);
    for (const r of descendants(head, "region")) {
      if (!r.attrs.id) continue;
      // Styles nested in a region apply to it.
      // Referential styles (`style="s1"`) first, then nested <style> children, then the region's own attributes.
      const merged: Attrs = resolveStyle(r.attrs);
      for (const s of kids(r, "style")) Object.assign(merged, resolveStyle(s.attrs));
      Object.assign(merged, r.attrs, { style: merged.style });
      regions.set(r.attrs.id, merged);
    }
    for (const a of descendants(head, "agent")) {
      const id = a.attrs.id;
      const name = kids(a, "name")[0]?.children.filter((c): c is string => typeof c === "string").join("").trim();
      if (id && name) agents.set(id, name);
    }
  }
  function resolveStyle(attrs: Attrs, seen = new Set<string>()): Attrs {
    const out: Attrs = {};
    for (const ref of (attrs.style ?? "").split(/\s+/).filter(Boolean)) {
      const target = styles.get(ref);
      if (target && !seen.has(ref)) Object.assign(out, resolveStyle(target, new Set(seen).add(ref)));
    }
    return Object.assign(out, attrs);
  }

  interface Inherited { style: Attrs; begin: number; end: number; region?: string; agent?: string }
  const subtitles: Subtitle[] = [];
  const unsupported = new Set<string>();

  const readText = (node: XmlNode, inherited: Attrs, keep: boolean, runs?: Array<string | undefined>): string => {
    let out = "";
    for (const c of node.children) {
      if (typeof c === "string") {
        out += c.replace(/\s+/g, " ");
        if (runs && c.trim()) runs.push(colour(inherited.color));
      }
      else if (c.name === "br") out += "\n";
      else if (c.name === "span" || c.name === "p") {
        const st = { ...inherited, ...resolveStyle(c.attrs) };
        let inner = readText(c, st, keep, runs);
        if (keep && inner.trim()) {
          if (st.fontStyle === "italic" || st.fontStyle === "oblique") inner = `<i>${inner}</i>`;
          if (st.fontWeight === "bold") inner = `<b>${inner}</b>`;
          if (/underline/.test(st.textDecoration ?? "")) inner = `<u>${inner}</u>`;
        }
        out += inner;
      } else if (c.name === "set" || c.name === "animate" || c.name === "metadata") {
        if (c.name !== "metadata") unsupported.add("animation");
      }
    }
    return out;
  };

  const walk = (node: XmlNode, inh: Inherited) => {
    const style = { ...inh.style, ...resolveStyle(node.attrs) };
    const b = parseTime(node.attrs.begin, ctx);
    const e = parseTime(node.attrs.end, ctx);
    const d = parseTime(node.attrs.dur, ctx);
    let unreadable = false;
    for (const [label, v] of [["begin", b], ["end", e], ["dur", d]] as const) {
      if (v !== undefined && Number.isNaN(v)) {
        unreadable = true;
        errors.push({ line: node.line, message: `Unreadable ${label} time "${node.attrs[label]}"${/^\d+:\d\d:\d\d:\d+/.test(node.attrs[label] ?? "") && ctx.dropNtsc ? " (a dropped drop-frame label, or out of range)" : ""}.` });
      }
    }
    if (unreadable) return;
    const begin = inh.begin + (b !== undefined && !Number.isNaN(b) ? b : 0);
    let end = inh.end;
    if (e !== undefined && !Number.isNaN(e)) end = inh.begin + e;
    else if (d !== undefined && !Number.isNaN(d)) end = begin + d;
    const next: Inherited = {
      style,
      begin,
      end,
      region: node.attrs.region ?? inh.region,
      agent: node.attrs.agent ?? inh.agent,
    };
    if (node.name !== "p") {
      for (const c of node.children) if (typeof c !== "string" && ["body", "div", "p"].includes(c.name)) walk(c, next);
      return;
    }
    const spans = descendants(node, "span");
    let start = begin;
    let stop = end;
    if (stop === Infinity) {
      // `<p>` without its own end: take the extent of its timed spans.
      const times = spans.map((s) => [parseTime(s.attrs.begin, ctx), parseTime(s.attrs.end, ctx)] as const);
      const begins = times.map((t) => t[0]).filter((t): t is number => t !== undefined && !Number.isNaN(t));
      const ends = times.map((t) => t[1]).filter((t): t is number => t !== undefined && !Number.isNaN(t));
      if (begins.length && ends.length) {
        start = begin + Math.min(...begins);
        stop = begin + Math.max(...ends);
      }
    }
    if (!Number.isFinite(stop) || !Number.isFinite(start)) {
      errors.push({ line: node.line, message: "Paragraph has no timing (begin / end / dur)." });
      return;
    }
    const region = (next.region ? regions.get(next.region) : undefined) ?? undefined;
    if (next.region && !region && !node.attrs.origin) unsupported.add(`missing region "${next.region}"`);
    const runColours: Array<string | undefined> = [];
    const text = readText(node, { ...(region ? regionOf(region) : {}), ...style }, options.styleTags === "keep", runColours)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) {
      errors.push({ line: node.line, message: "Paragraph has no text." });
      return;
    }
    const offset = options.offsetSeconds ?? 0;
    const startTime = Math.max(0, Math.round((start - offset) * 1000) / 1000);
    const endTime = Math.max(0, Math.round((stop - offset) * 1000) / 1000);
    if (!(endTime > startTime)) {
      errors.push({ line: node.line, message: "Paragraph ends before it starts." });
      return;
    }
    // A colour set on spans (`<span tts:color=...>`) becomes the cue colour when every text run shares it;
    // a cue that mixes colours cannot be represented by one style, so say so instead of silently flattening.
    const distinct = new Set(runColours.map((c) => c ?? ""));
    const merged: Attrs = { ...style, ...(region ? regionOf(region) : {}) };
    if (distinct.size === 1) {
      const only = [...runColours][0];
      if (only) merged.color = only;
    } else if (distinct.size > 1) {
      unsupported.add("multi-colour text within one cue (the first colour is used)");
      const first = runColours.find(Boolean);
      if (first) merged.color = first;
    }
    const { cueStyle, cueSettings } = mapLayout(merged, node.attrs);
    const speaker = next.agent ? agents.get(next.agent) : undefined;
    subtitles.push({
      id: `cue-ttml-${Date.now().toString(36)}-${(counter++).toString(36)}`,
      text,
      startTime,
      endTime,
      ...(speaker ? { speaker } : {}),
      ...(cueStyle ? { style: cueStyle } : {}),
      ...(cueSettings ? { cueSettings } : {}),
      ...(language ? { language } : {}),
      ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
    });
  };
  const regionOf = (r: Attrs): Attrs => r;

  const body = child(tt, "body");
  if (!body) {
    errors.push({ line: tt.line, message: "TTML document has no <body>." });
    return empty;
  }
  walk(body, { style: {}, begin: 0, end: Infinity });
  for (const u of unsupported) issues.push({ severity: "info", code: "ttml-unsupported", message: `TTML ${u} is not supported and was ignored.` });
  if (!subtitles.length && !errors.length) errors.push({ line: 1, message: "No timed paragraphs were found in the TTML file." });
  return { subtitles, errors, issues };
}

function mapLayout(s: Attrs, pAttrs: Attrs): { cueStyle?: SubtitleStyle; cueSettings?: CueSettings } {
  const style: Record<string, unknown> = {};
  const color = colour(s.color);
  const bg = colour(s.backgroundColor);
  if (color) style.color = color;
  if (bg) style.backgroundColor = bg;
  if (s.fontFamily) {
    const first = s.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    style.fontFamily = GENERIC_FONTS[first.toLowerCase()] ?? first;
  }
  const px = /^(\d+(?:\.\d+)?)px$/.exec((s.fontSize ?? "").trim());
  if (px) style.fontSize = Number(px[1]);
  const outline = /^(?:(\S+)\s+)?(\d+(?:\.\d+)?)(?:px)?(?:\s+\S+)?$/.exec((s.textOutline ?? "").trim());
  if (outline && s.textOutline !== "none") {
    const oc = colour(outline[1]);
    if (oc) style.strokeColor = oc;
    style.strokeWidth = Number(outline[2]);
  }
  const align = s.displayAlign === "before" ? "top" : s.displayAlign === "center" ? "center" : s.displayAlign === "after" ? "bottom" : undefined;
  const origin = (pAttrs.origin ?? s.origin ?? "").trim().split(/\s+/);
  const extent = (pAttrs.extent ?? s.extent ?? "").trim().split(/\s+/);
  const ox = percent(origin[0]);
  const oy = percent(origin[1]);
  const ew = percent(extent[0]);
  const eh = percent(extent[1]);
  const settings: Record<string, unknown> = {};
  const ta = s.textAlign;
  if (ta === "left" || ta === "right" || ta === "center" || ta === "start" || ta === "end") settings.align = ta;
  if (oy !== undefined) {
    // Regions anchor text to the top / bottom of their box; WebVTT `line` is the box edge of that anchor.
    const height = eh ?? 0;
    const line = align === "bottom" || !align ? oy + height : align === "center" ? oy + height / 2 : oy;
    settings.line = Math.round(Math.min(100, Math.max(0, line)) * 100) / 100;
    settings.snapToLines = false;
    settings.lineAlign = align === "bottom" || !align ? "end" : align === "center" ? "center" : "start";
  }
  if (ew !== undefined) {
    settings.size = ew;
    if (ox !== undefined) settings.position = Math.round(Math.min(100, Math.max(0, ox + ew / 2)) * 100) / 100;
    settings.positionAlign = "center";
  }
  const position = oy !== undefined
    ? (oy + (eh ?? 0) / 2 < 33 ? "top" : oy + (eh ?? 0) / 2 < 66 ? "center" : "bottom")
    : align;
  const cueStyle: SubtitleStyle | undefined = Object.keys(style).length > 0
    ? ({
        ...DEFAULT_CAPTION_STYLE,
        position: position ?? DEFAULT_CAPTION_STYLE.position,
        ...style,
      } as SubtitleStyle)
    : undefined;
  return { cueStyle, cueSettings: Object.keys(settings).length ? (settings as CueSettings) : undefined };
}

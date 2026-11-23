/**
 * XMP metadata: a small namespace-aware XML/RDF reader and writer, the packet finders for the
 * containers cameras and editors use (MP4/MOV `uuid` and `XMP_` boxes, JPEG APP1, sidecar `.xmp`), and
 * the mapping between the Dublin Core / xmpDM fields the Metadata panel edits and a media item.
 *
 * Pure: no DOM, no Node. The same code runs in the renderer, the desktop main process and the tests.
 * The model keeps every property it reads (including namespaces it does not know), so writing a sidecar
 * for a file that already has one never drops the other fields.
 */

export const XMP_NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xml: "http://www.w3.org/XML/1998/namespace",
  dc: "http://purl.org/dc/elements/1.1/",
  xmp: "http://ns.adobe.com/xap/1.0/",
  xmpDM: "http://ns.adobe.com/xmp/1.0/DynamicMedia/",
  xmpRights: "http://ns.adobe.com/xap/1.0/rights/",
  xmpMM: "http://ns.adobe.com/xap/1.0/mm/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/",
  Iptc4xmpCore: "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
  tiff: "http://ns.adobe.com/tiff/1.0/",
  exif: "http://ns.adobe.com/exif/1.0/",
  stRef: "http://ns.adobe.com/xap/1.0/sType/ResourceRef#",
  stEvt: "http://ns.adobe.com/xap/1.0/sType/ResourceEvent#",
} as const;

const DEFAULT_PREFIXES: Record<string, string> = Object.fromEntries(Object.entries(XMP_NS).map(([prefix, uri]) => [uri, prefix]));

export type XmpArrayType = "Bag" | "Seq" | "Alt";

export type XmpValue =
  | { kind: "text"; text: string; lang?: string }
  | { kind: "array"; type: XmpArrayType; items: XmpValue[] }
  | { kind: "struct"; fields: XmpProperty[] };

export interface XmpProperty {
  /** Namespace URI. */
  ns: string;
  /** Local name. */
  name: string;
  value: XmpValue;
}

export interface XmpDocument {
  properties: XmpProperty[];
  /** Namespace URI -> prefix, as the source declared them (used again when writing). */
  prefixes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// XML tokenizer / tree
// ---------------------------------------------------------------------------

interface XmlElement {
  /** Namespace URI ("" when none). */
  ns: string;
  local: string;
  attrs: Array<{ ns: string; local: string; value: string }>;
  children: XmlNode[];
}
type XmlNode = XmlElement | string;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

interface RawElement {
  name: string;
  attrs: Array<{ name: string; value: string }>;
  children: Array<RawElement | string>;
}

function tokenize(source: string): RawElement {
  const root: RawElement = { name: "#root", attrs: [], children: [] };
  const stack: RawElement[] = [root];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].children.push(decodeEntities(source.slice(i)));
      break;
    }
    if (lt > i) stack[stack.length - 1].children.push(decodeEntities(source.slice(i, lt)));
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      stack[stack.length - 1].children.push(source.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
    } else if (source.startsWith("<?", lt) || source.startsWith("<!", lt)) {
      const end = source.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
    } else if (source[lt + 1] === "/") {
      const end = source.indexOf(">", lt + 2);
      if (stack.length > 1) stack.pop();
      i = end < 0 ? n : end + 1;
    } else {
      let j = lt + 1;
      while (j < n && !/[\s/>]/.test(source[j])) j++;
      const element: RawElement = { name: source.slice(lt + 1, j), attrs: [], children: [] };
      let selfClosing = false;
      for (;;) {
        while (j < n && /\s/.test(source[j])) j++;
        if (j >= n) break;
        if (source[j] === ">") {
          j++;
          break;
        }
        if (source[j] === "/") {
          selfClosing = true;
          j++;
          continue;
        }
        const nameStart = j;
        while (j < n && !/[\s=/>]/.test(source[j])) j++;
        const attrName = source.slice(nameStart, j);
        while (j < n && /\s/.test(source[j])) j++;
        let value = "";
        if (source[j] === "=") {
          j++;
          while (j < n && /\s/.test(source[j])) j++;
          const quote = source[j];
          if (quote === '"' || quote === "'") {
            const close = source.indexOf(quote, j + 1);
            value = decodeEntities(source.slice(j + 1, close < 0 ? n : close));
            j = close < 0 ? n : close + 1;
          } else {
            const valueStart = j;
            while (j < n && !/[\s>]/.test(source[j])) j++;
            value = decodeEntities(source.slice(valueStart, j));
          }
        }
        if (attrName) element.attrs.push({ name: attrName, value });
      }
      stack[stack.length - 1].children.push(element);
      if (!selfClosing) stack.push(element);
      i = j;
    }
  }
  return root;
}

function resolveTree(raw: RawElement, scope: Map<string, string>, declared: Record<string, string>): XmlElement {
  const local = new Map(scope);
  for (const attr of raw.attrs) {
    if (attr.name === "xmlns") local.set("", attr.value);
    else if (attr.name.startsWith("xmlns:")) {
      const prefix = attr.name.slice(6);
      local.set(prefix, attr.value);
      if (!(attr.value in declared)) declared[attr.value] = prefix;
    }
  }
  const split = (qname: string, useDefault: boolean): { ns: string; local: string } => {
    const colon = qname.indexOf(":");
    if (colon < 0) return { ns: useDefault ? (local.get("") ?? "") : "", local: qname };
    const prefix = qname.slice(0, colon);
    return { ns: prefix === "xml" ? XMP_NS.xml : (local.get(prefix) ?? ""), local: qname.slice(colon + 1) };
  };
  const { ns, local: name } = split(raw.name, true);
  const attrs: XmlElement["attrs"] = [];
  for (const attr of raw.attrs) {
    if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
    const q = split(attr.name, false);
    attrs.push({ ns: q.ns, local: q.local, value: attr.value });
  }
  return {
    ns,
    local: name,
    attrs,
    children: raw.children.map((child) => (typeof child === "string" ? child : resolveTree(child, local, declared))),
  };
}

// ---------------------------------------------------------------------------
// RDF reading
// ---------------------------------------------------------------------------

const isElement = (node: XmlNode): node is XmlElement => typeof node !== "string";
const isRdf = (el: XmlElement, local: string): boolean => el.ns === XMP_NS.rdf && el.local === local;
const elementsOf = (el: XmlElement): XmlElement[] => el.children.filter(isElement);
const textOf = (el: XmlElement): string => el.children.filter((c): c is string => typeof c === "string").join("");
const attrOf = (el: XmlElement, ns: string, local: string): string | undefined => el.attrs.find((a) => a.ns === ns && a.local === local)?.value;

function findElement(el: XmlElement, ns: string, local: string): XmlElement | undefined {
  if (el.ns === ns && el.local === local) return el;
  for (const child of elementsOf(el)) {
    const found = findElement(child, ns, local);
    if (found) return found;
  }
  return undefined;
}

/** Attributes that carry property values (everything but rdf:/xml: plumbing). */
function propertyAttrs(el: XmlElement): XmlElement["attrs"] {
  return el.attrs.filter((a) => a.ns !== XMP_NS.rdf && a.ns !== XMP_NS.xml && a.ns !== "");
}

function readStructFields(el: XmlElement): XmpProperty[] {
  const fields: XmpProperty[] = [];
  for (const attr of propertyAttrs(el)) fields.push({ ns: attr.ns, name: attr.local, value: { kind: "text", text: attr.value } });
  for (const child of elementsOf(el)) fields.push(readPropertyElement(child));
  return fields;
}

function readValueElement(el: XmlElement): XmlValueResult {
  const lang = attrOf(el, XMP_NS.xml, "lang");
  const parseType = attrOf(el, XMP_NS.rdf, "parseType");
  const kids = elementsOf(el);
  if (parseType === "Resource") return { kind: "struct", fields: readStructFields(el) };
  if (kids.length === 1) {
    const only = kids[0];
    if (isRdf(only, "Bag") || isRdf(only, "Seq") || isRdf(only, "Alt")) {
      return { kind: "array", type: only.local as XmpArrayType, items: elementsOf(only).filter((li) => isRdf(li, "li")).map(readValueElement) };
    }
    if (isRdf(only, "Description")) return { kind: "struct", fields: readStructFields(only) };
  }
  if (kids.length === 0 && propertyAttrs(el).length > 0 && textOf(el).trim() === "") return { kind: "struct", fields: readStructFields(el) };
  const text = textOf(el);
  return lang ? { kind: "text", text, lang } : { kind: "text", text };
}
type XmlValueResult = XmpValue;

function readPropertyElement(el: XmlElement): XmpProperty {
  return { ns: el.ns, name: el.local, value: readValueElement(el) };
}

/** Parse an XMP packet (or bare `rdf:RDF` / `x:xmpmeta` XML). Returns null when no RDF is found. */
export function parseXmp(source: string): XmpDocument | null {
  const text = source.replace(/^﻿/, "");
  const declared: Record<string, string> = {};
  let tree: XmlElement;
  try {
    const raw = tokenize(text);
    const top = raw.children.find((c): c is RawElement => typeof c !== "string");
    if (!top) return null;
    tree = resolveTree(top, new Map(), declared);
  } catch {
    return null;
  }
  const rdf = findElement(tree, XMP_NS.rdf, "RDF");
  if (!rdf) return null;
  const properties: XmpProperty[] = [];
  for (const description of elementsOf(rdf)) {
    if (!isRdf(description, "Description")) continue;
    properties.push(...readStructFields(description));
  }
  const prefixes: Record<string, string> = {};
  for (const [uri, prefix] of Object.entries(declared)) if (uri !== XMP_NS.xml) prefixes[uri] = prefix;
  return { properties, prefixes };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function collectNamespaces(properties: readonly XmpProperty[], into: Set<string>): void {
  for (const property of properties) {
    into.add(property.ns);
    collectValueNamespaces(property.value, into);
  }
}
function collectValueNamespaces(value: XmpValue, into: Set<string>): void {
  if (value.kind === "struct") collectNamespaces(value.fields, into);
  else if (value.kind === "array") for (const item of value.items) collectValueNamespaces(item, into);
}

function serializeValue(value: XmpValue, indent: string, prefixOf: (ns: string) => string): string {
  if (value.kind === "text") return escapeText(value.text);
  if (value.kind === "struct") {
    const inner = value.fields.map((field) => serializeProperty(field, indent + "  ", prefixOf)).join("");
    return `\n${indent}  <rdf:Description>\n${inner}${indent}  </rdf:Description>\n${indent}`;
  }
  const items = value.items
    .map((item) => {
      const lang = item.kind === "text" && item.lang ? ` xml:lang="${escapeAttr(item.lang)}"` : "";
      return `${indent}    <rdf:li${lang}>${serializeValue(item, indent + "    ", prefixOf)}</rdf:li>\n`;
    })
    .join("");
  return `\n${indent}  <rdf:${value.type}>\n${items}${indent}  </rdf:${value.type}>\n${indent}`;
}

function serializeProperty(property: XmpProperty, indent: string, prefixOf: (ns: string) => string): string {
  const qname = `${prefixOf(property.ns)}:${property.name}`;
  const lang = property.value.kind === "text" && property.value.lang ? ` xml:lang="${escapeAttr(property.value.lang)}"` : "";
  return `${indent}<${qname}${lang}>${serializeValue(property.value, indent, prefixOf)}</${qname}>\n`;
}

/** Serialize to a complete XMP packet (`<?xpacket ...?>` wrapper, one `rdf:Description`). */
export function serializeXmp(doc: XmpDocument): string {
  const used = new Set<string>();
  collectNamespaces(doc.properties, used);
  const taken = new Set<string>(["x", "rdf", "xml"]);
  const prefixFor = new Map<string, string>();
  const assign = (uri: string): string => {
    const known = prefixFor.get(uri);
    if (known) return known;
    let prefix = doc.prefixes[uri] ?? DEFAULT_PREFIXES[uri] ?? "";
    if (!prefix || (taken.has(prefix) && prefixFor.get(uri) !== prefix)) {
      let count = 1;
      const base = prefix || "ns";
      prefix = `${base}${count}`;
      while (taken.has(prefix)) prefix = `${base}${++count}`;
    }
    taken.add(prefix);
    prefixFor.set(uri, prefix);
    return prefix;
  };
  // Assign in a stable order: known prefixes first so they are not displaced by generated ones.
  for (const uri of [...used].sort()) if (doc.prefixes[uri] || DEFAULT_PREFIXES[uri]) assign(uri);
  for (const uri of [...used].sort()) assign(uri);
  const declarations = [...used]
    .sort()
    .map((uri) => `\n    xmlns:${prefixFor.get(uri)}="${escapeAttr(uri)}"`)
    .join("");
  const body = doc.properties.map((property) => serializeProperty(property, "   ", (ns) => prefixFor.get(ns) ?? assign(ns))).join("");
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="${XMP_NS.x}" x:xmptk="OpenReel">\n` +
    ` <rdf:RDF xmlns:rdf="${XMP_NS.rdf}">\n` +
    `  <rdf:Description rdf:about=""${declarations}>\n` +
    body +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}

// ---------------------------------------------------------------------------
// Fields the Metadata panel edits
// ---------------------------------------------------------------------------

export interface XmpFields {
  title?: string;
  description?: string;
  creator?: string;
  rights?: string;
  keywords?: string[];
  scene?: string;
  shot?: string;
  take?: string;
  good?: boolean;
  logComment?: string;
  reel?: string;
}

const find = (doc: XmpDocument, ns: string, name: string): XmpProperty | undefined => doc.properties.find((p) => p.ns === ns && p.name === name);

function scalar(value: XmpValue | undefined): string | undefined {
  if (!value) return undefined;
  if (value.kind === "text") return value.text;
  if (value.kind === "array") {
    const preferred = value.items.find((i) => i.kind === "text" && i.lang === "x-default") ?? value.items[0];
    return scalar(preferred);
  }
  return undefined;
}
function textList(value: XmpValue | undefined): string[] {
  if (!value) return [];
  if (value.kind === "text") return value.text.trim() ? [value.text] : [];
  if (value.kind === "array") return value.items.flatMap((i) => (i.kind === "text" && i.text.trim() ? [i.text] : []));
  return [];
}

/** Split free text ("a, b; c") into trimmed, de-duplicated (case-insensitive) keywords. */
export function parseKeywordText(text: string): string[] {
  return normalizeKeywords(text.split(/[,;\n]/));
}
export function normalizeKeywords(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const word = raw.trim().replace(/\s+/g, " ");
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

/** The Dublin Core / xmpDM fields of a document. Empty values are left out. */
export function readXmpFields(doc: XmpDocument): XmpFields {
  const out: XmpFields = {};
  const set = <K extends keyof XmpFields>(key: K, value: XmpFields[K] | undefined): void => {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return;
    out[key] = value;
  };
  set("title", scalar(find(doc, XMP_NS.dc, "title")?.value));
  set("description", scalar(find(doc, XMP_NS.dc, "description")?.value));
  set("creator", textList(find(doc, XMP_NS.dc, "creator")?.value).join(", "));
  set("rights", scalar(find(doc, XMP_NS.dc, "rights")?.value));
  set("keywords", normalizeKeywords(textList(find(doc, XMP_NS.dc, "subject")?.value)));
  set("scene", scalar(find(doc, XMP_NS.xmpDM, "scene")?.value));
  set("shot", scalar(find(doc, XMP_NS.xmpDM, "shotName")?.value) ?? scalar(find(doc, XMP_NS.xmpDM, "shotNumber")?.value));
  set("take", scalar(find(doc, XMP_NS.xmpDM, "takeNumber")?.value));
  const good = scalar(find(doc, XMP_NS.xmpDM, "good")?.value);
  if (good !== undefined) out.good = /^true$/i.test(good.trim());
  set("logComment", scalar(find(doc, XMP_NS.xmpDM, "logComment")?.value));
  set("reel", scalar(find(doc, XMP_NS.xmpDM, "tapeName")?.value) ?? scalar(find(doc, XMP_NS.xmpDM, "reel")?.value));
  return out;
}

const emptyDoc = (): XmpDocument => ({ properties: [], prefixes: {} });
const text = (value: string): XmpValue => ({ kind: "text", text: value });
const alt = (value: string): XmpValue => ({ kind: "array", type: "Alt", items: [{ kind: "text", text: value, lang: "x-default" }] });
const array = (type: XmpArrayType, items: readonly string[]): XmpValue => ({ kind: "array", type, items: items.map(text) });

/**
 * A language alternative with its x-default item set to `value`. Alternatives in other languages that the
 * document already carries are kept; an unchanged x-default leaves the property as it was.
 */
function altKeeping(existing: XmpValue | undefined, value: string): XmpValue {
  if (existing?.kind !== "array" || existing.type !== "Alt") return alt(value);
  const others = existing.items.filter((i) => !(i.kind === "text" && (i.lang === "x-default" || i.lang === undefined)));
  const current = existing.items.find((i) => i.kind === "text" && i.lang === "x-default");
  if (current?.kind === "text" && current.text === value) return existing;
  const first = existing.items[0];
  if (!current && first?.kind === "text" && first.text === value) return existing;
  return { kind: "array", type: "Alt", items: [{ kind: "text", text: value, lang: "x-default" }, ...others] };
}

function setProperty(properties: XmpProperty[], ns: string, name: string, value: XmpValue | null): void {
  const index = properties.findIndex((p) => p.ns === ns && p.name === name);
  if (value === null) {
    if (index >= 0) properties.splice(index, 1);
    return;
  }
  if (index >= 0) properties[index] = { ns, name, value };
  else properties.push({ ns, name, value });
}

/**
 * Write `fields` into a copy of `base` (or a new document). A key present in `fields` replaces that
 * property (empty string / empty list / `undefined` value removes it); a key that is absent leaves the
 * document's property alone. Properties this function does not know about are always kept.
 */
export function applyXmpFields(base: XmpDocument | null, fields: XmpFields): XmpDocument {
  const doc: XmpDocument = base ? { properties: structuredClone(base.properties), prefixes: { ...base.prefixes } } : emptyDoc();
  const has = (key: keyof XmpFields): boolean => Object.prototype.hasOwnProperty.call(fields, key);
  const str = (key: "title" | "description" | "rights" | "scene" | "shot" | "take" | "logComment" | "reel"): string | undefined => {
    const value = fields[key];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };
  if (has("title")) setProperty(doc.properties, XMP_NS.dc, "title", str("title") ? altKeeping(doc.properties.find((p) => p.ns === XMP_NS.dc && p.name === "title")?.value, str("title")!) : null);
  if (has("description")) setProperty(doc.properties, XMP_NS.dc, "description", str("description") ? altKeeping(doc.properties.find((p) => p.ns === XMP_NS.dc && p.name === "description")?.value, str("description")!) : null);
  if (has("rights")) setProperty(doc.properties, XMP_NS.dc, "rights", str("rights") ? altKeeping(doc.properties.find((p) => p.ns === XMP_NS.dc && p.name === "rights")?.value, str("rights")!) : null);
  if (has("creator")) {
    const names = (fields.creator ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    setProperty(doc.properties, XMP_NS.dc, "creator", names.length ? array("Seq", names) : null);
  }
  if (has("keywords")) {
    const words = normalizeKeywords(fields.keywords ?? []);
    setProperty(doc.properties, XMP_NS.dc, "subject", words.length ? array("Bag", words) : null);
  }
  if (has("scene")) setProperty(doc.properties, XMP_NS.xmpDM, "scene", str("scene") ? text(str("scene")!) : null);
  if (has("shot")) {
    setProperty(doc.properties, XMP_NS.xmpDM, "shotName", str("shot") ? text(str("shot")!) : null);
    setProperty(doc.properties, XMP_NS.xmpDM, "shotNumber", null);
  }
  if (has("take")) setProperty(doc.properties, XMP_NS.xmpDM, "takeNumber", str("take") ? text(str("take")!) : null);
  if (has("good")) setProperty(doc.properties, XMP_NS.xmpDM, "good", fields.good === undefined ? null : text(fields.good ? "True" : "False"));
  if (has("logComment")) setProperty(doc.properties, XMP_NS.xmpDM, "logComment", str("logComment") ? text(str("logComment")!) : null);
  if (has("reel")) {
    setProperty(doc.properties, XMP_NS.xmpDM, "tapeName", str("reel") ? text(str("reel")!) : null);
    setProperty(doc.properties, XMP_NS.xmpDM, "reel", null);
  }
  return doc;
}

/** Sidecar file name for a media file: `clip.mov` -> `clip.xmp` (the Adobe convention). */
export function sidecarXmpName(mediaName: string): string {
  const dot = mediaName.lastIndexOf(".");
  return `${dot > 0 ? mediaName.slice(0, dot) : mediaName}.xmp`;
}

/** Later sources win field by field; keywords are unioned (xmpFieldsFromPackets lets a sidecar replace them). */
export function mergeXmpFields(...sources: Array<XmpFields | undefined>): XmpFields {
  const merged: XmpFields = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source) as Array<[keyof XmpFields, unknown]>) {
      if (value === undefined) continue;
      if (key === "keywords") merged.keywords = normalizeKeywords([...(merged.keywords ?? []), ...((value as string[]) ?? [])]);
      else (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Finding the packet inside a file
// ---------------------------------------------------------------------------

/** Random-access reader (a File slice in the browser, a file handle in Node). */
export interface XmpByteReader {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** The XMP uuid of ISO base media files (Adobe's `BE7ACFCB-97A9-42E8-9C71-999491E3AFAC`). */
export const XMP_UUID = Uint8Array.from([0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac]);
const MAX_PACKET = 8 * 1024 * 1024;

const decoder = (): TextDecoder => new TextDecoder("utf-8");
const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i] ?? 0);
  return s;
};

/** Find an XMP packet anywhere in `bytes` (`<?xpacket begin` ... `<?xpacket end`, else `<x:xmpmeta` ... `</x:xmpmeta>`). */
export function scanForXmpPacket(bytes: Uint8Array): string | null {
  const latin = ascii(bytes, 0, bytes.length);
  let start = latin.indexOf("<?xpacket begin");
  let endMarker = "<?xpacket end";
  if (start < 0) {
    start = latin.indexOf("<x:xmpmeta");
    endMarker = "</x:xmpmeta>";
  }
  if (start < 0) return null;
  const end = latin.indexOf(endMarker, start);
  if (end < 0) return null;
  let stop = end + endMarker.length;
  if (endMarker.startsWith("<?")) {
    const close = latin.indexOf("?>", stop);
    stop = close < 0 ? stop : close + 2;
  }
  return decoder().decode(bytes.subarray(start, stop));
}

/** JPEG: the APP1 segment that starts with the XMP namespace header. */
export function extractXmpFromJpeg(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const header = "http://ns.adobe.com/xap/1.0/\0";
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1 && ascii(bytes, offset + 4, header.length) === header) {
      return decoder().decode(bytes.subarray(offset + 4 + header.length, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return null;
}

const CONTAINER_BOXES = new Set(["moov", "udta"]);

/** MP4 / MOV / M4V: a top-level (or `moov/udta`) `uuid` box with the XMP uuid, or a QuickTime `XMP_` atom. */
export async function extractXmpFromIsoBmff(reader: XmpByteReader): Promise<string | null> {
  const walk = async (start: number, end: number, depth: number): Promise<string | null> => {
    let offset = start;
    while (offset + 8 <= end) {
      const head = await reader.read(offset, 16);
      if (head.length < 8) return null;
      const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
      let size = view.getUint32(0);
      const type = ascii(head, 4, 4);
      let header = 8;
      if (size === 1) {
        if (head.length < 16) return null;
        size = Number(view.getBigUint64(8));
        header = 16;
      } else if (size === 0) size = end - offset;
      if (size < header || offset + size > end + 0) size = Math.min(Math.max(size, header), end - offset);
      if (size < header) return null;
      if (type === "uuid") {
        const uuid = await reader.read(offset + header, 16);
        if (uuid.length === 16 && uuid.every((b, i) => b === XMP_UUID[i])) {
          const length = Math.min(size - header - 16, MAX_PACKET);
          return decoder().decode(await reader.read(offset + header + 16, length));
        }
      } else if (type === "XMP_") {
        return decoder().decode(await reader.read(offset + header, Math.min(size - header, MAX_PACKET)));
      } else if (CONTAINER_BOXES.has(type) && depth < 3) {
        const inner = await walk(offset + header, offset + size, depth + 1);
        if (inner) return inner;
      }
      offset += size;
    }
    return null;
  };
  return walk(0, reader.size, 0);
}

const lowerExt = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const ISO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "qt", "3gp", "3g2", "m4a", "mj2"]);

/** Read the embedded XMP packet of a media file (by container), or null. Never rewrites the file. */
export async function readEmbeddedXmpPacket(name: string, reader: XmpByteReader): Promise<string | null> {
  const ext = lowerExt(name);
  if (ext === "jpg" || ext === "jpeg") {
    // XMP sits in the first segments; 256 KB covers real files, then fall back to a scan.
    const head = await reader.read(0, Math.min(reader.size, 1024 * 1024));
    return extractXmpFromJpeg(head) ?? scanForXmpPacket(head);
  }
  if (ISO_EXTENSIONS.has(ext)) return extractXmpFromIsoBmff(reader);
  if (ext === "xmp") return decoder().decode(await reader.read(0, Math.min(reader.size, MAX_PACKET)));
  // Other containers (PNG, TIFF, WAV, ...): look at the head and the tail, where writers put the packet.
  const headLength = Math.min(reader.size, 512 * 1024);
  const head = await reader.read(0, headLength);
  const fromHead = scanForXmpPacket(head);
  if (fromHead || reader.size <= headLength) return fromHead;
  const tailLength = Math.min(reader.size - headLength, 512 * 1024);
  return scanForXmpPacket(await reader.read(reader.size - tailLength, tailLength));
}

/** Fields from the embedded packet and the sidecar (sidecar wins). Either may be absent. */
export function xmpFieldsFromPackets(embedded: string | null | undefined, sidecar: string | null | undefined): XmpFields | null {
  const a = embedded ? parseXmp(embedded) : null;
  const b = sidecar ? parseXmp(sidecar) : null;
  if (!a && !b) return null;
  const embeddedFields = a ? readXmpFields(a) : undefined;
  const sidecarFields = b ? readXmpFields(b) : undefined;
  const merged = mergeXmpFields(embeddedFields, sidecarFields);
  // The sidecar is what this app (and Adobe tools) write when keywords are edited: its list replaces the embedded one, so removed keywords stay removed.
  if (sidecarFields?.keywords?.length) merged.keywords = sidecarFields.keywords;
  return merged;
}

// ---------------------------------------------------------------------------
// Media item mapping
// ---------------------------------------------------------------------------

/** The slice of a media item the XMP fields map onto. */
export interface XmpMediaFields {
  description?: string;
  scene?: string;
  shot?: string;
  take?: string;
  goodTake?: boolean;
  keywords?: string[];
  logComment?: string;
  reel?: string;
}

/** Media patch from XMP fields (only what the XMP actually had; `title`, `creator`, `rights` are not item fields). */
export function xmpFieldsToMediaFields(fields: XmpFields): XmpMediaFields {
  const out: XmpMediaFields = {};
  if (fields.description) out.description = fields.description;
  if (fields.scene) out.scene = fields.scene;
  if (fields.shot) out.shot = fields.shot;
  if (fields.take) out.take = fields.take;
  if (fields.good !== undefined) out.goodTake = fields.good;
  if (fields.keywords?.length) out.keywords = fields.keywords;
  if (fields.logComment) out.logComment = fields.logComment;
  if (fields.reel) out.reel = fields.reel;
  return out;
}

/** XMP fields for a media item, every field present (an empty one clears the property when applied). */
export function mediaFieldsToXmpFields(item: XmpMediaFields): XmpFields {
  return {
    description: item.description ?? "",
    scene: item.scene ?? "",
    shot: item.shot ?? "",
    take: item.take ?? "",
    good: item.goodTake ? true : undefined,
    keywords: item.keywords ?? [],
    logComment: item.logComment ?? "",
    reel: item.reel ?? "",
  };
}

/** Plain-text summary lines for exports (only fields that have a value). */
export function describeMediaMetadata(item: XmpMediaFields): string[] {
  const lines: string[] = [];
  if (item.description) lines.push(`Description: ${item.description}`);
  if (item.keywords?.length) lines.push(`Keywords: ${item.keywords.join(", ")}`);
  const logging = [item.scene && `Scene ${item.scene}`, item.shot && `Shot ${item.shot}`, item.take && `Take ${item.take}`, item.goodTake && "Good take"].filter(Boolean);
  if (logging.length) lines.push(logging.join(" / "));
  if (item.reel) lines.push(`Reel: ${item.reel}`);
  if (item.logComment) lines.push(`Log comment: ${item.logComment}`);
  return lines;
}

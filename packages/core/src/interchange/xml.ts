/**
 * Minimal dependency-free XML reader/writer for timeline interchange. It runs
 * unchanged in the browser, Electron main/renderer, Node and Workers (no
 * DOMParser). Supports elements, attributes, text, CDATA, comments, processing
 * instructions, DOCTYPE and the five predefined entities plus numeric refs.
 */

export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Concatenated direct text content (trimmed of surrounding whitespace). */
  readonly text: string;
}

export class XmlParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (at offset ${offset})`);
    this.name = "XmlParseError";
  }
}

const ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function decode(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

interface MutableElement {
  name: string;
  attrs: Record<string, string>;
  children: MutableElement[];
  text: string;
}

export function parseXml(source: string): XmlElement {
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = source.length;
  const stack: MutableElement[] = [];
  let root: MutableElement | null = null;

  const skipUntil = (token: string, label: string): void => {
    const at = source.indexOf(token, i);
    if (at < 0) throw new XmlParseError(`Unterminated ${label}`, i);
    i = at + token.length;
  };

  while (i < n && !root) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      if (stack.length) throw new XmlParseError("Unexpected end of document", i);
      break;
    }
    if (lt > i && stack.length) {
      stack[stack.length - 1].text += decode(source.slice(i, lt));
    }
    i = lt;
    if (source.startsWith("<!--", i)) {
      i += 4;
      skipUntil("-->", "comment");
    } else if (source.startsWith("<![CDATA[", i)) {
      const start = i + 9;
      skipUntil("]]>", "CDATA section");
      if (stack.length) stack[stack.length - 1].text += source.slice(start, i - 3);
    } else if (source.startsWith("<?", i)) {
      i += 2;
      skipUntil("?>", "processing instruction");
    } else if (source.startsWith("<!", i)) {
      // DOCTYPE, possibly with an internal subset in [...]
      let depth = 0;
      i += 2;
      while (i < n) {
        const ch = source[i++];
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        else if (ch === ">" && depth <= 0) break;
      }
    } else if (source.startsWith("</", i)) {
      const end = source.indexOf(">", i);
      if (end < 0) throw new XmlParseError("Unterminated closing tag", i);
      const name = source.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name)
        throw new XmlParseError(`Mismatched closing tag </${name}>`, i);
      i = end + 1;
      if (!stack.length) root = open;
    } else {
      i++;
      const nameMatch = /^[^\s/>]+/.exec(source.slice(i, i + 256));
      if (!nameMatch) throw new XmlParseError("Malformed tag", i);
      const element: MutableElement = { name: nameMatch[0], attrs: {}, children: [], text: "" };
      i += nameMatch[0].length;
      let selfClosing = false;
      for (;;) {
        while (i < n && /\s/.test(source[i])) i++;
        if (i >= n) throw new XmlParseError("Unterminated tag", i);
        if (source[i] === ">") {
          i++;
          break;
        }
        if (source[i] === "/" && source[i + 1] === ">") {
          selfClosing = true;
          i += 2;
          break;
        }
        const attr = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(source.slice(i, i + 4096));
        if (!attr) throw new XmlParseError("Malformed attribute", i);
        element.attrs[attr[1]] = decode(attr[3] ?? attr[4] ?? "");
        i += attr[0].length;
      }
      if (stack.length) stack[stack.length - 1].children.push(element);
      if (selfClosing) {
        if (!stack.length) root = element;
      } else {
        stack.push(element);
      }
    }
  }
  if (stack.length) throw new XmlParseError(`Unclosed element <${stack[stack.length - 1].name}>`, n);
  if (!root) throw new XmlParseError("No root element", 0);
  return finalize(root);
}

function finalize(element: MutableElement): XmlElement {
  return {
    name: element.name,
    attrs: element.attrs,
    children: element.children.map(finalize),
    text: element.text.trim(),
  };
}

export const child = (element: XmlElement | undefined, name: string): XmlElement | undefined =>
  element?.children.find((c) => c.name === name);
export const childrenNamed = (element: XmlElement | undefined, name: string): XmlElement[] =>
  element ? element.children.filter((c) => c.name === name) : [];
export const childText = (element: XmlElement | undefined, name: string): string | undefined =>
  child(element, name)?.text;
export function childNumber(element: XmlElement | undefined, name: string): number | undefined {
  const text = childText(element, name);
  if (text === undefined || text === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // strip characters XML 1.0 forbids
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  );
}

type Attrs = Record<string, string | number | undefined>;

/** Tiny indenting XML writer. */
export class XmlWriter {
  private readonly lines: string[] = [];
  private depth = 0;

  raw(line: string): this {
    this.lines.push("  ".repeat(this.depth) + line);
    return this;
  }

  private attrString(attrs?: Attrs): string {
    if (!attrs) return "";
    return Object.entries(attrs)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
      .join("");
  }

  open(name: string, attrs?: Attrs): this {
    this.raw(`<${name}${this.attrString(attrs)}>`);
    this.depth++;
    return this;
  }

  close(name: string): this {
    this.depth--;
    return this.raw(`</${name}>`);
  }

  leaf(name: string, text: string | number, attrs?: Attrs): this {
    return this.raw(`<${name}${this.attrString(attrs)}>${escapeXml(String(text))}</${name}>`);
  }

  empty(name: string, attrs?: Attrs): this {
    return this.raw(`<${name}${this.attrString(attrs)}/>`);
  }

  toString(header: string[] = []): string {
    return [...header, ...this.lines].join("\n") + "\n";
  }
}

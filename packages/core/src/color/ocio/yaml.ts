/**
 * A YAML reader for the subset OpenColorIO configs use (block mappings and sequences, flow mappings / sequences that may
 * span lines, `!<Tag>` tags, `|` and `>` block scalars, quoted and plain scalars). It does not do anchors, merge keys,
 * multi-document streams or complex keys; those are reported as errors rather than misread.
 *
 * A tagged node becomes `{ $tag, ...fields }` for mappings, `{ $tag, $value }` for anything else. Numbers and booleans are
 * converted from plain scalars; quoted scalars are always strings.
 */

export class YamlError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `${message} (line ${line})` : message);
  }
}

export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  readonly raw: string;
  readonly indent: number;
  /** Content without the comment and trailing space ("" for blank lines). */
  readonly text: string;
  readonly no: number;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      // A quote only opens a string at the start of a token.
      if (i === 0 || /[\s[{,:]/.test(line[i - 1])) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

const NUMBER = /^[-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)$/;

function plainScalar(text: string): YamlValue {
  const t = text.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true" || t === "True" || t === "TRUE") return true;
  if (t === "false" || t === "False" || t === "FALSE") return false;
  if (NUMBER.test(t)) return Number(t);
  if (/^[-+]?\.inf$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  return t;
}

function unescapeDouble(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_m, e: string) => {
    if (e[0] === "u" || e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
    switch (e) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "0": return "\0";
      default: return e;
    }
  });
}

class FlowReader {
  private i = 0;
  constructor(private readonly s: string, private readonly line: number) {}

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  atEnd(): boolean {
    this.ws();
    return this.i >= this.s.length;
  }

  value(): YamlValue {
    this.ws();
    const c = this.s[this.i];
    let tag: string | null = null;
    if (c === "!") {
      const m = /^!<([^>]*)>|^!([^\s,\]}]*)/.exec(this.s.slice(this.i));
      if (!m) throw new YamlError("Bad tag", this.line);
      tag = m[1] ?? m[2];
      this.i += m[0].length;
      this.ws();
    }
    let v: YamlValue;
    const d = this.s[this.i];
    if (d === "{") v = this.map();
    else if (d === "[") v = this.seq();
    else v = this.scalar();
    if (tag === null) return v;
    return v && typeof v === "object" && !Array.isArray(v) ? { $tag: tag, ...v } : { $tag: tag, $value: v };
  }

  private scalar(): YamlValue {
    this.ws();
    const c = this.s[this.i];
    if (c === '"' || c === "'") {
      let out = "";
      this.i++;
      for (; this.i < this.s.length; this.i++) {
        const ch = this.s[this.i];
        if (c === '"' && ch === "\\") {
          out += this.s.slice(this.i, this.i + 2);
          this.i++;
        } else if (ch === c) {
          if (c === "'" && this.s[this.i + 1] === "'") {
            out += "'";
            this.i++;
          } else {
            this.i++;
            return c === '"' ? unescapeDouble(out) : out;
          }
        } else out += ch;
      }
      throw new YamlError("Unterminated string", this.line);
    }
    const start = this.i;
    while (this.i < this.s.length && !",]}".includes(this.s[this.i])) {
      // A ": " inside a flow scalar ends a key.
      if (this.s[this.i] === ":" && (this.i + 1 >= this.s.length || /[\s,\]}]/.test(this.s[this.i + 1]))) break;
      this.i++;
    }
    return plainScalar(this.s.slice(start, this.i));
  }

  private seq(): YamlValue {
    this.i++; // [
    const out: YamlValue[] = [];
    for (;;) {
      this.ws();
      if (this.s[this.i] === "]") {
        this.i++;
        return out;
      }
      if (this.i >= this.s.length) throw new YamlError("Unterminated list", this.line);
      out.push(this.value());
      this.ws();
      if (this.s[this.i] === ",") this.i++;
    }
  }

  private map(): YamlValue {
    this.i++; // {
    const out: { [key: string]: YamlValue } = {};
    for (;;) {
      this.ws();
      if (this.s[this.i] === "}") {
        this.i++;
        return out;
      }
      if (this.i >= this.s.length) throw new YamlError("Unterminated mapping", this.line);
      const keyValue = this.scalar();
      this.ws();
      if (this.s[this.i] !== ":") throw new YamlError("Expected ':' in flow mapping", this.line);
      this.i++;
      this.ws();
      const key = String(keyValue);
      out[key] = this.s[this.i] === "," || this.s[this.i] === "}" ? null : this.value();
      this.ws();
      if (this.s[this.i] === ",") this.i++;
    }
  }
}

function balanced(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[{,:]/.test(text[i - 1])) quote = c;
    } else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth <= 0;
}

/** Splits `key: rest` at the first unquoted ": " (or a trailing ":"). Returns null when the text is not a mapping entry. */
function splitKey(text: string): { key: string; rest: string } | null {
  let quote: string | null = null;
  if (text[0] === '"' || text[0] === "'") {
    const q = text[0];
    let i = 1;
    for (; i < text.length; i++) {
      if (q === '"' && text[i] === "\\") i++;
      else if (text[i] === q) {
        if (q === "'" && text[i + 1] === "'") i++;
        else break;
      }
    }
    if (i >= text.length) return null;
    const after = text.slice(i + 1);
    if (!/^\s*:(\s|$)/.test(after)) return null;
    const key = q === '"' ? unescapeDouble(text.slice(1, i)) : text.slice(1, i).replace(/''/g, "'");
    return { key, rest: after.replace(/^\s*:/, "").trim() };
  }
  if (text[0] === "[" || text[0] === "{" || text[0] === "!" ) return null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === ":" && (i + 1 === text.length || text[i + 1] === " ")) {
      return { key: text.slice(0, i).trim(), rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

export function parseYaml(source: string): YamlValue {
  const rawLines = source.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  const lines: Line[] = rawLines.map((raw, i) => {
    let indent = 0;
    while (indent < raw.length && raw[indent] === " ") indent++;
    if (raw[indent] === "\t") throw new YamlError("Tabs are not allowed for indentation", i + 1);
    return { raw, indent, text: stripComment(raw).trimEnd().trim(), no: i + 1 };
  });
  let pos = 0;

  const skipBlank = (): void => {
    while (pos < lines.length && (lines[pos].text === "" || lines[pos].text === "---")) pos++;
  };

  /** Reads a flow value that may continue over following lines. */
  const flowValue = (first: string, startLine: number): YamlValue => {
    let text = first;
    while (!balanced(text)) {
      if (pos >= lines.length) throw new YamlError("Unterminated flow collection", startLine);
      text += " " + lines[pos].text;
      pos++;
    }
    const reader = new FlowReader(text, startLine);
    const v = reader.value();
    if (!reader.atEnd()) throw new YamlError("Unexpected text after flow collection", startLine);
    return v;
  };

  const blockScalar = (header: string, parentIndent: number): string => {
    const fold = header.startsWith(">");
    const body: string[] = [];
    let blockIndent = -1;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.raw.trim() === "") {
        body.push("");
        pos++;
        continue;
      }
      if (blockIndent < 0) blockIndent = l.indent;
      if (l.indent <= parentIndent || l.indent < blockIndent) break;
      body.push(l.raw.slice(blockIndent));
      pos++;
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    const keep = header.includes("-") ? "" : "\n";
    return (fold ? body.join(" ") : body.join("\n")) + (body.length ? keep : "");
  };

  /** The value after `key:` or `- `. `parentIndent` is the indent of the entry that owns it. */
  const valueAfter = (rest: string, parentIndent: number, line: Line, dashList: boolean): YamlValue => {
    let tag: string | null = null;
    let r = rest.trim();
    const tm = /^!<([^>]*)>|^!([^\s]+)/.exec(r);
    if (tm) {
      tag = tm[1] ?? tm[2];
      r = r.slice(tm[0].length).trim();
    }
    let v: YamlValue;
    if (r === "") {
      skipBlank();
      const next = lines[pos];
      if (next && (next.indent > parentIndent || (next.indent === parentIndent && next.text.startsWith("- ") && !dashList && tag === null))) {
        v = block(next.indent);
      } else if (next && dashList && next.indent > parentIndent) v = block(next.indent);
      else v = null;
    } else if (r[0] === "|" || r[0] === ">") v = blockScalar(r, parentIndent);
    else if (r[0] === "[" || r[0] === "{") v = flowValue(r, line.no);
    else if (r[0] === '"' || r[0] === "'") {
      const reader = new FlowReader(r, line.no);
      v = reader.value();
    } else v = plainScalar(r);
    if (tag === null) return v;
    return v && typeof v === "object" && !Array.isArray(v) ? { $tag: tag, ...v } : { $tag: tag, $value: v };
  };

  const block = (indent: number): YamlValue => {
    skipBlank();
    const first = lines[pos];
    if (!first) return null;
    if (first.text.startsWith("- ") || first.text === "-") return sequence(first.indent);
    if (splitKey(first.text)) return mapping(first.indent);
    // A bare scalar or flow value.
    pos++;
    return valueAfter(first.text, indent - 1, first, false);
  };

  const sequence = (indent: number): YamlValue => {
    const out: YamlValue[] = [];
    for (;;) {
      skipBlank();
      const l = lines[pos];
      if (!l || l.indent !== indent || !(l.text.startsWith("- ") || l.text === "-")) break;
      pos++;
      const rest = l.text === "-" ? "" : l.text.slice(2);
      const itemIndent = indent + 2 + (l.text.length - 2 - l.text.slice(2).trimStart().length);
      const tm = /^(!<[^>]*>|![^\s]+)\s*(.*)$/.exec(rest.trim());
      const inner = tm ? tm[2] : rest.trim();
      if (!tm && splitKey(inner) && inner[0] !== "[" && inner[0] !== "{") {
        // "- key: value": a mapping that starts on the dash line; its other keys sit at the key's column.
        const col = l.raw.indexOf(inner, indent + 1);
        const synthetic: Line = { raw: " ".repeat(col) + inner, indent: col, text: inner, no: l.no };
        lines[pos - 1] = synthetic;
        pos--;
        out.push(mapping(col));
      } else if (tm && tm[2] === "") {
        // "- !<Tag>" with the mapping on the following lines.
        skipBlank();
        const next = lines[pos];
        let v: YamlValue = null;
        if (next && next.indent > indent) v = block(next.indent);
        const tag = tm[1].replace(/^!<|>$/g, "").replace(/^!/, "");
        out.push(v && typeof v === "object" && !Array.isArray(v) ? { $tag: tag, ...v } : { $tag: tag, $value: v });
      } else {
        void itemIndent;
        out.push(valueAfter(rest, indent, l, true));
      }
    }
    return out;
  };

  const mapping = (indent: number): YamlValue => {
    const out: { [key: string]: YamlValue } = {};
    for (;;) {
      skipBlank();
      const l = lines[pos];
      if (!l || l.indent !== indent) {
        if (l && l.indent > indent) throw new YamlError("Unexpected indentation", l.no);
        break;
      }
      if (l.text.startsWith("- ")) break;
      const kv = splitKey(l.text);
      if (!kv) throw new YamlError(`Expected "key: value", found "${l.text.slice(0, 40)}"`, l.no);
      pos++;
      if (Object.prototype.hasOwnProperty.call(out, kv.key)) throw new YamlError(`Duplicate key "${kv.key}"`, l.no);
      out[kv.key] = valueAfter(kv.rest, indent, l, false);
    }
    return out;
  };

  skipBlank();
  if (pos >= lines.length) return null;
  const root = block(lines[pos].indent);
  skipBlank();
  if (pos < lines.length) throw new YamlError("Unexpected content after the document", lines[pos].no);
  return root;
}

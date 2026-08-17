#!/usr/bin/env node
// Codemod: wrap user-facing strings with i18next t() for localization.
//
// Strategy (English copy doubles as the translation key, so untranslated
// strings automatically fall back to English):
//   1. JSX text            -> {t("...")}            (HTML entities decoded, JSX whitespace semantics preserved)
//   2. JSX display attrs   -> label={t("...")}      (label/title/placeholder/aria-label/...)
//      - string-literal values and no-substitution template literals
//      - ternary branches whose arms are string literals
//      - display-ish property reads -> label={t(item.label)} (t() is the identity for unknown keys)
//   3. Object display fields inside functions -> label: t("...")
//      Module-level constant tables are intentionally left in English and
//      localized at the render boundary via rule 2 instead, so they never go
//      stale after a language switch.
//
// useTranslation() is injected into enclosing components; non-component scopes
// (module scope, helpers, class components, .ts files) import t from src/i18n.
//
// Usage:
//   node scripts/extract-i18n.mjs            # dry-run: report + candidate strings (no changes)
//   node scripts/extract-i18n.mjs --apply    # rewrite sources in place
//   node scripts/extract-i18n.mjs --file components/editor/Toolbar
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require(path.resolve("apps/web/node_modules/typescript"));

const APPLY = process.argv.includes("--apply");
const FILE_FILTER = process.argv.includes("--file")
  ? process.argv[process.argv.indexOf("--file") + 1]
  : null;
const ROOT = path.resolve("apps/web/src");
const I18N_DIR = path.join(ROOT, "i18n");

// JSX attributes whose string values are user-facing copy.
const DISPLAY_ATTRS = new Set([
  "label", "title", "placeholder", "aria-label", "ariaLabel", "alt",
  "description", "helperText", "emptyText", "emptyTitle", "confirmText",
  "cancelText", "heading", "subheading", "subtitle", "searchPlaceholder",
  "tooltip", "hint",
]);
// Object fields (inside functions) whose string values are user-facing copy.
// NOTE: "name" is excluded - it is widely used as a lookup key, not display text.
const OBJ_WRAP_KEYS = new Set([
  "label", "title", "placeholder", "description", "helperText", "emptyText",
  "emptyTitle", "confirmText", "cancelText", "heading", "subheading", "subtitle",
  "tooltip", "hint",
]);
// Object fields collected as translation candidates (module-level tables included).
const OBJ_CANDIDATE_KEYS = new Set([...OBJ_WRAP_KEYS, "name", "text"]);
// Property reads wrapped at the render boundary: t(x.label) is a no-op unless
// the value has a translation, so this is safe for dynamic values.
const LABEL_PROPS = new Set(["label", "title", "name"]);

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0",
  middot: "\u00B7", hellip: "\u2026", mdash: "\u2014", ndash: "\u2013",
  times: "\u00D7", bull: "\u2022", copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
  deg: "\u00B0", larr: "\u2190", rarr: "\u2192", uarr: "\u2191", darr: "\u2193",
  check: "\u2713", cross: "\u2715", plus: "+", minus: "\u2212", pm: "\u00B1",
  cent: "\u00A2", pound: "\u00A3", euro: "\u20AC", sect: "\u00A7", dagger: "\u2020",
  laquo: "\u00AB", raquo: "\u00BB", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201C", rdquo: "\u201D", sbquo: "\u201A", oline: "\u203E", frasl: "\u2044",
};

function decodeEntities(text) {
  let ok = true;
  const out = text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (_m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) { ok = false; return body; }
      return String.fromCodePoint(code);
    }
    const decoded = ENTITIES[body.toLowerCase()];
    if (decoded === undefined) { ok = false; return body; }
    return decoded;
  });
  return ok ? out : null;
}

// Strings that are never localized: symbols, numbers with units, colors, URLs...
function isNonTranslatable(s) {
  if (!/[A-Za-z]/.test(s)) return true;
  if (s.length <= 2) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true;
  if (/^(\.[a-z0-9]+)(\s*\/\s*\.[a-z0-9]+)*$/i.test(s)) return true;
  if (/^[\d.,:\s%()\u00D7x*+\-]+$/i.test(s)) return true;
  const compact = s.replace(/\s+/g, "");
  if (/^[+\-]?\d[\d.,:]*(fps|p|k|x|\u00D7|ms|hz|kbps|mbps|kb|mb|gb|s|m|h)?$/i.test(compact)) return true;
  if (/^v\d+(\.\d+)+/i.test(s)) return true;
  return false;
}

// Mirror JSX whitespace semantics: lines are trimmed and joined with single
// spaces, blank lines disappear. Spaces next to inline siblings are kept by
// the caller so the English rendering stays identical.
function jsxLinesToKey(text) {
  return text.split(/\r?\n/).map((l) => l.replace(/^[\t ]+|[\t ]+$/g, "")).filter(Boolean).join(" ");
}

function walkFiles(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) files.push(...walkFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) files.push(full);
  }
  return files;
}

function isTestFile(file) {
  return /\.(test|spec)\.(ts|tsx)$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`);
}

function relFromRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function functionName(fn) {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  let cur = fn.parent;
  // Climb wrappers like memo(...) / forwardRef(...) to the variable being assigned.
  while (cur && !ts.isSourceFile(cur) && !isFunctionLike(cur)) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isPropertyAssignment(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isBinaryExpression(cur) || ts.isCallExpression(cur) || ts.isParenthesizedExpression(cur)) {
      cur = cur.parent;
      continue;
    }
    return null;
  }
  return null;
}

function containsJsx(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) || ts.isMethodDeclaration(node);
}

function functionChain(node) {
  const chain = [];
  let cur = node.parent;
  while (cur) {
    if (isFunctionLike(cur)) chain.push(cur);
    cur = cur.parent;
  }
  return chain; // innermost -> outermost
}

// Outermost uppercase JSX-bearing function = the React component; the hook
// lives there and closures make t() visible at the usage site.
function findComponentTarget(node) {
  const chain = functionChain(node); // innermost -> outermost
  for (let i = chain.length - 1; i >= 0; i--) {
    const fn = chain[i];
    const name = functionName(fn);
    if (name && /^[A-Z]/.test(name) && containsJsx(fn)) return fn;
  }
  return null;
}

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function withinPreOrCode(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isJsxElement(cur)) {
      const tag = cur.openingElement.tagName.getText();
      if (tag === "pre" || tag === "code" || tag === "textarea") return true;
    }
    cur = cur.parent;
  }
  return false;
}

const stats = {
  filesConsidered: 0, filesChanged: 0, filesErrored: 0,
  jsxText: 0, attrLiteral: 0, attrPropRead: 0, objLiteral: 0, objPropRead: 0, jsxPropRead: 0,
  skippedNonTranslatable: 0, skippedUndecodable: 0,
  exprBodyConversions: 0, hookInjections: 0, moduleTImports: 0,
  conflicts: [], overlaps: [],
  attrInventory: new Map(),
};
const candidates = new Map(); // text -> { occurrences, files: Set, categories: Set }

function addCandidate(text, file, category) {
  if (isNonTranslatable(text)) return;
  const entry = candidates.get(text) ?? { occurrences: 0, files: new Set(), categories: new Set() };
  entry.occurrences++;
  entry.files.add(relFromRoot(file));
  entry.categories.add(category);
  candidates.set(text, entry);
}

function processFile(file) {
  const sourceText = fs.readFileSync(file, "utf8");
  const isTsx = file.endsWith(".tsx");
  const EOL = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const setParents = (node) => {
    ts.forEachChild(node, (c) => { c.parent = node; setParents(c); });
  };
  setParents(sf);

  const fileOps = []; // {start, end, make: (names) => text}
  const hookTargets = new Set(); // function nodes needing useTranslation()
  let needsModuleT = false;
  let hasLocalTBinding = false;
  const rel = path.relative(path.dirname(file), I18N_DIR).split(path.sep).join("/");
  const i18nImportPath = rel.startsWith(".") ? rel : "./" + rel;

  const visit = (node) => {
    // Detect pre-existing `t` bindings so generated names never get shadowed.
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isImportSpecifier(node)) &&
        ts.isIdentifier(node.name) && node.name.text === "t") hasLocalTBinding = true;

    if (ts.isJsxText(node) && !withinPreOrCode(node)) {
      const raw = node.text;
      const decoded = decodeEntities(raw);
      const collapsed = decoded === null ? null : jsxLinesToKey(decoded);
      if (collapsed === null) {
        stats.skippedUndecodable++;
      } else if (/[A-Za-z]/.test(collapsed)) {
        if (isNonTranslatable(collapsed)) { stats.skippedNonTranslatable++; }
        else {
          const parent = node.parent;
          const idx = parent.children.indexOf(node);
          const prevInline = idx > 0 && !ts.isJsxText(parent.children[idx - 1]);
          const nextInline = idx >= 0 && idx < parent.children.length - 1 && !ts.isJsxText(parent.children[idx + 1]);
          const lead = prevInline && /^[ \t]/.test(raw) ? " " : "";
          const trail = nextInline && /[ \t]$/.test(raw) ? " " : "";
          const key = lead + collapsed + trail;
          addCandidate(key, file, "jsx");
          const start = node.getStart(sf), end = node.end;
          const target = findComponentTarget(node);
          if (target) hookTargets.add(target); else needsModuleT = true;
          stats.jsxText++;
          fileOps.push({ start, end, make: (n) => (target ? `{${n.hook}(${JSON.stringify(key)})}` : `{${n.module}(${JSON.stringify(key)})}`) });
        }
      }
    }

    if (ts.isJsxAttribute(node) && DISPLAY_ATTRS.has(node.name.text)) {
      const attrName = node.name.text;
      const init = node.initializer;
      const registerLiteral = (lit, posNode) => {
        addCandidate(lit.text, file, `attr:${attrName}`);
        const s = posNode.getStart(sf), e = posNode.end;
        const target = findComponentTarget(node);
        if (target) hookTargets.add(target); else needsModuleT = true;
        stats.attrLiteral++;
        // A literal used directly as the attribute value needs an expression container.
        const braces = ts.isJsxAttribute(lit.parent) ? ["{", "}"] : ["", ""];
        fileOps.push({ start: s, end: e, make: (n) => (target ? `${braces[0]}${n.hook}(${JSON.stringify(lit.text)})${braces[1]}` : `${braces[0]}${n.module}(${JSON.stringify(lit.text)})${braces[1]}`) });
      };
      if (init && ts.isStringLiteral(init) && !isNonTranslatable(init.text)) {
        registerLiteral(init, init);
      } else if (init && ts.isJsxExpression(init) && init.expression) {
        const expr = init.expression;
        if (isStringLike(expr) && !isNonTranslatable(expr.text)) {
          registerLiteral(expr, expr);
        } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name) && LABEL_PROPS.has(expr.name.text)) {
          const s = expr.getStart(sf), e = expr.end;
          const target = findComponentTarget(node);
          if (target) hookTargets.add(target); else needsModuleT = true;
          stats.attrPropRead++;
          const text = expr.getText(sf);
          fileOps.push({ start: s, end: e, make: (n) => (target ? `${n.hook}(${text})` : `${n.module}(${text})`) });
        } else if (ts.isConditionalExpression(expr)) {
          const arms = [];
          const collectArms = (c) => {
            if (isStringLike(c) && !isNonTranslatable(c.text)) arms.push(c);
            else if (ts.isConditionalExpression(c)) { collectArms(c.whenTrue); collectArms(c.whenFalse); }
          };
          collectArms(expr.whenTrue);
          collectArms(expr.whenFalse);
          for (const arm of arms) registerLiteral(arm, arm);
        }
      }
    }

    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && OBJ_WRAP_KEYS.has(node.name.text)) {
      const keyName = node.name.text;
      const inFunction = functionChain(node).length > 0;
      const init = node.initializer;
      if (inFunction && isStringLike(init) && !isNonTranslatable(init.text)) {
        addCandidate(init.text, file, `obj:${keyName}`);
        const s = init.getStart(sf), e = init.end;
        const target = findComponentTarget(node);
        if (target) hookTargets.add(target); else needsModuleT = true;
        stats.objLiteral++;
        fileOps.push({ start: s, end: e, make: (n) => (target ? `${n.hook}(${JSON.stringify(init.text)})` : `${n.module}(${JSON.stringify(init.text)})`) });
      } else if (inFunction && ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.name) && LABEL_PROPS.has(init.name.text)) {
        const s = init.getStart(sf), e = init.end;
        const target = findComponentTarget(node);
        if (target) hookTargets.add(target); else needsModuleT = true;
        stats.objPropRead++;
        const text = init.getText(sf);
        fileOps.push({ start: s, end: e, make: (n) => (target ? `${n.hook}(${text})` : `${n.module}(${text})`) });
      }
    }

    // Candidate collection from constant tables (module level included) + name/text fields.
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && OBJ_CANDIDATE_KEYS.has(node.name.text) && isStringLike(node.initializer)) {
      addCandidate(node.initializer.text, file, `registry:${node.name.text}`);
    }

    // {item.label} rendered as a JSX child (not inside <pre>/<code>).
    if (node.kind === ts.SyntaxKind.JsxExpression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const expr = node.expression;
      if (expr && ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name) &&
          (expr.name.text === "label" || expr.name.text === "title") && !withinPreOrCode(node)) {
        const s = expr.getStart(sf), e = expr.end;
        const target = findComponentTarget(node);
        if (target) hookTargets.add(target); else needsModuleT = true;
        stats.jsxPropRead++;
        const text = expr.getText(sf);
        fileOps.push({ start: s, end: e, make: (n) => (target ? `${n.hook}(${text})` : `${n.module}(${text})`) });
      }
    }

    // Attribute-name inventory (for calibrating DISPLAY_ATTRS).
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) &&
        /[A-Za-z]/.test(node.initializer.text) && !DISPLAY_ATTRS.has(node.name.text) &&
        /label|title|placeholder|desc|hint|tooltip|message/i.test(node.name.text)) {
      stats.attrInventory.set(node.name.text, (stats.attrInventory.get(node.name.text) ?? 0) + 1);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (fileOps.length === 0) return;

  // ---- decide generated names ------------------------------------------------
  const useTranslationImported = /import\s*\{[^}]*useTranslation[^}]*\}\s*from\s*["']react-i18next["']/.test(sourceText);
  const existingHookMatch = sourceText.match(/const\s*\{\s*(\w+)\s*\}\s*=\s*useTranslation\s*\(/);
  const names = {
    hook: existingHookMatch ? existingHookMatch[1] : (hasLocalTBinding ? "tr" : "t"),
    module: hasLocalTBinding && !existingHookMatch ? "ti" : "t",
  };

  // ---- build insertions ------------------------------------------------------
  const insertions = []; // {start, end, text}
  const moduleImportExists = new RegExp(`from\\s*["']${i18nImportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(sourceText);

  for (const fn of hookTargets) {
    const body = fn.body;
    if (!body) continue;
    if (ts.isBlock(body)) {
      const bodyText = sourceText.slice(body.getStart(sf), body.end);
      if (bodyText.includes("useTranslation(")) continue; // already injected
      const first = body.statements[0];
      const indent = first
        ? sourceText.slice(sourceText.lastIndexOf(EOL, first.getStart(sf)) + EOL.length, first.getStart(sf)).match(/^[ \t]*/)[0]
        : "  ";
      const pos = body.getStart(sf) + 1; // right after "{"
      const destructure = names.hook === "t" ? "t" : `t: ${names.hook}`;
      insertions.push({ start: pos, end: pos, text: `${EOL}${indent}const { ${destructure} } = useTranslation();` });
      stats.hookInjections++;
    } else {
      // Expression-bodied arrow: convert to a block via edge insertions so any
      // nested edits inside the body apply untouched.
      stats.exprBodyConversions++;
      stats.hookInjections++;
      const bs = body.getStart(sf), be = body.end;
      const indent = sourceText.slice(sourceText.lastIndexOf(EOL, bs) + EOL.length, bs).match(/^[ \t]*/)[0];
      const inner = indent + "  ";
      // An already-parenthesized body keeps its own parentheses.
      const paren = ts.isParenthesizedExpression(body);
      const open = paren
        ? `{${EOL}${inner}const { ${names.hook === "t" ? "t" : `t: ${names.hook}`} } = useTranslation();${EOL}${inner}return `
        : `{${EOL}${inner}const { ${names.hook === "t" ? "t" : `t: ${names.hook}`} } = useTranslation();${EOL}${inner}return (${EOL}${inner}  `;
      const close = paren ? `;${EOL}${indent}}` : `${EOL}${inner});${EOL}${indent}}`;
      insertions.push({ start: bs, end: bs, text: open });
      insertions.push({ start: be, end: be, text: close });
    }
  }

  const lastImport = sf.statements.filter(ts.isImportDeclaration).pop();
  const importPos = lastImport ? lastImport.end : 0;
  const importPrefix = lastImport ? EOL : "";
  if (!useTranslationImported && hookTargets.size > 0) {
    insertions.push({ start: importPos, end: importPos, text: `${importPrefix}import { useTranslation } from "react-i18next";` });
  }
  if (needsModuleT && !moduleImportExists) {
    insertions.push({ start: importPos, end: importPos, text: `${importPrefix}import { t${names.module !== "t" ? ` as ${names.module}` : ""} } from "${i18nImportPath}";` });
    stats.moduleTImports++;
  }

  // ---- splice ----------------------------------------------------------------
  const allOps = [
    ...fileOps.map((op) => ({ start: op.start, end: op.end, text: op.make(names) })),
    ...insertions,
  ].sort((a, b) => b.start - a.start || b.end - a.end);

  let out = sourceText;
  let prevStart = Number.POSITIVE_INFINITY;
  let prevEnd = Number.POSITIVE_INFINITY;
  for (const op of allOps) {
    if (op.start < prevStart && op.end > prevStart) {
      stats.overlaps.push(`${relFromRoot(file)} @${op.start}`);
      continue;
    }
    out = out.slice(0, op.start) + op.text + out.slice(op.end);
    prevStart = op.start;
    prevEnd = Math.min(prevEnd, op.start);
  }
  void prevEnd;

  // Safety: the rewritten file must still parse cleanly.
  const check = ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (check.parseDiagnostics.length > 0) {
    stats.filesErrored++;
    if (process.env.I18N_DEBUG) fs.writeFileSync(path.join(os.tmpdir(), "i18n-debug-" + path.basename(file)), out, "utf8");
    stats.conflicts.push(`${relFromRoot(file)}: PARSE ERROR after rewrite, file skipped (${String(check.parseDiagnostics[0].messageText).slice(0, 120)})`);
    return;
  }

  stats.filesChanged++;
  if (APPLY) fs.writeFileSync(file, out, "utf8");
}

// ---- main --------------------------------------------------------------------
const files = walkFiles(ROOT).filter((f) => {
  if (isTestFile(f)) return false;
  const rel = relFromRoot(f);
  if (rel.startsWith("test/") || rel.startsWith("i18n/")) return false;
  if (FILE_FILTER && !rel.includes(FILE_FILTER)) return false;
  return true;
});
stats.filesConsidered = files.length;
for (const file of files) processFile(file);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "oreel-i18n-"));
const candidateList = [...candidates.entries()]
  .map(([text, info]) => ({ text, occurrences: info.occurrences, files: [...info.files], categories: [...info.categories] }))
  .sort((a, b) => b.occurrences - a.occurrences || a.text.localeCompare(b.text));
fs.writeFileSync(path.join(outDir, "candidates.json"), JSON.stringify(candidateList, null, 2));

console.log(`mode: ${APPLY ? "APPLY (sources rewritten)" : "DRY RUN (no changes)"}`);
console.log(`files considered: ${stats.filesConsidered}, files with edits: ${stats.filesChanged}, errored: ${stats.filesErrored}`);
console.log(`edits: jsxText=${stats.jsxText} attrLiteral=${stats.attrLiteral} attrPropRead=${stats.attrPropRead} objLiteral=${stats.objLiteral} objPropRead=${stats.objPropRead} jsxPropRead=${stats.jsxPropRead}`);
console.log(`injections: hooks=${stats.hookInjections} exprBodyConversions=${stats.exprBodyConversions} moduleTImports=${stats.moduleTImports}`);
console.log(`skipped: nonTranslatable=${stats.skippedNonTranslatable} undecodable=${stats.skippedUndecodable}`);
console.log(`candidates (unique translatable strings): ${candidateList.length}`);
console.log(`overlaps dropped: ${stats.overlaps.length}, conflicts: ${stats.conflicts.length}`);
if (stats.attrInventory.size) console.log(`unhandled display-ish attr names: ${[...stats.attrInventory.entries()].map(([k, v]) => `${k}:${v}`).join(", ")}`);
if (stats.conflicts.length) {
  console.log("conflicts:");
  for (const c of stats.conflicts.slice(0, 40)) console.log(`  - ${c}`);
}
console.log(`candidates.json -> ${path.join(outDir, "candidates.json")}`);

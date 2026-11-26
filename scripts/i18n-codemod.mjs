#!/usr/bin/env node
// One-off codemod: add useT() and wrap static UI strings in t().
// Usage: node scripts/i18n-codemod.mjs --paths dir1,dir2 [--write]
// Review every change; expression-bodied components and template strings with
// substitutions are reported and left for manual handling.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { isUiCopy, loadAllowlist, root } from "./i18n-scan.mjs";

const require = createRequire(import.meta.url);
const ts = require(require.resolve("typescript", { paths: [path.join(root, "packages/i18n")] }));

const ATTRIBUTES = new Set([
  "title",
  "aria-label",
  "aria-description",
  "placeholder",
  "alt",
  "aria-valuetext",
]);
const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const write = args.includes("--write");
const dirs = (valueOf("--paths") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
if (dirs.length === 0) {
  console.error("usage: node scripts/i18n-codemod.mjs --paths dir1,dir2 [--write]");
  process.exit(2);
}

const allowlist = loadAllowlist();
const SKIP_DIRS = new Set(["node_modules", "dist", "release", ".git", ".cache", "test-results"]);

function walk(target, files) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(path.join(target, entry), files);
    }
    return;
  }
  if (/\.(ts|tsx)$/u.test(target) && !/\.d\.ts$/u.test(target) && !/\.(test|spec)\.[cm]?[jt]sx?$/u.test(target)) {
    files.push(target);
  }
}

const decodeEntities = (text) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

const normalize = (text) => decodeEntities(text).replace(/\s+/g, " ").trim();

function transformFile(file) {
  const text = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = text.split("\n");
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const isIgnored = (line) =>
    (lines[line - 1] ?? "").includes("i18n-ignore") ||
    (lines[line - 2] ?? "").includes("i18n-ignore");

  const components = [];
  const skipped = [];
  const collectComponents = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/u.test(node.name.text) && node.body) {
      components.push({ fn: node, body: node.body, name: node.name.text });
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z]/u.test(node.name.text)) {
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        if (ts.isBlock(init.body)) {
          components.push({ fn: init, body: init.body, name: node.name.text });
        } else if (init.body) {
          skipped.push(`${lineOf(node)}  ${node.name.text}: expression-bodied component`);
        }
      }
    }
    ts.forEachChild(node, collectComponents);
  };
  collectComponents(sourceFile);
  const componentNodes = new Set(components.map((component) => component.fn));

  const edits = [];
  let addedHook = false;

  const hasTranslationBinding = (component) => {
    if (component.fn.parameters?.some((param) => ts.isIdentifier(param.name) && param.name.text === "t")) {
      return true;
    }
    let found = false;
    const search = (node) => {
      if (found) return;
      if (node !== component.fn && componentNodes.has(node)) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "t") {
        found = true;
        return;
      }
      if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === "t") {
        found = true;
        return;
      }
      ts.forEachChild(node, search);
    };
    search(component.body);
    return found;
  };

  const addEdit = (start, end, replacement) => edits.push({ start, end, replacement });

  const collectExpressionStrings = (expression) => {
    const visitExpression = (node) => {
      if (!node) return;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const line = lineOf(node);
        if (isUiCopy(node.text, allowlist) && !isIgnored(line)) {
          addEdit(node.getStart(sourceFile), node.getEnd(), `t(${JSON.stringify(node.text)})`);
        }
      } else if (ts.isConditionalExpression(node)) {
        visitExpression(node.whenTrue);
        visitExpression(node.whenFalse);
      } else if (ts.isParenthesizedExpression(node)) {
        visitExpression(node.expression);
      } else if (
        ts.isBinaryExpression(node) &&
        ["+", "??", "||", "&&"].includes(node.operatorToken.getText(sourceFile))
      ) {
        visitExpression(node.left);
        visitExpression(node.right);
      } else if (ts.isTemplateExpression(node)) {
        skipped.push(`${lineOf(node)}  template string with substitutions`);
      }
    };
    visitExpression(expression);
  };

  for (const component of components) {
    const before = edits.length;
    const visit = (node) => {
      if (node !== component.fn && componentNodes.has(node)) return;
      if (ts.isJsxText(node)) {
        const raw = node.getText(sourceFile);
        const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
        const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
        const core = raw.slice(leading, raw.length - trailing);
        const line = lineOf(node);
        const key = normalize(core);
        if (key && isUiCopy(key, allowlist) && !isIgnored(line)) {
          const start = node.getStart(sourceFile) + leading;
          const end = node.getStart(sourceFile) + raw.length - trailing;
          addEdit(start, end, `{t(${JSON.stringify(key)})}`);
        }
      } else if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(sourceFile);
        const initializer = node.initializer;
        if (
          ATTRIBUTES.has(name) &&
          initializer &&
          (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer))
        ) {
          const line = lineOf(node);
          if (isUiCopy(initializer.text, allowlist) && !isIgnored(line)) {
            addEdit(initializer.getStart(sourceFile), initializer.getEnd(), `{t(${JSON.stringify(initializer.text)})}`);
          }
        }
      } else if (ts.isJsxExpression(node)) {
        const parent = node.parent;
        if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
          collectExpressionStrings(node.expression);
        } else if (ts.isJsxAttribute(parent) && ATTRIBUTES.has(parent.name.getText(sourceFile))) {
          collectExpressionStrings(node.expression);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(component.body);
    if (edits.length > before && !hasTranslationBinding(component)) {
      const bodyStart = component.body.getStart(sourceFile) + 1;
      const first = component.body.statements[0];
      const firstLine = first
        ? lines[sourceFile.getLineAndCharacterOfPosition(first.getStart(sourceFile)).line] ?? ""
        : lines[sourceFile.getLineAndCharacterOfPosition(component.body.getStart(sourceFile)).line] ?? "";
      const indent = `${firstLine.match(/^\s*/u)?.[0] ?? ""}`;
      addEdit(bodyStart, bodyStart, `\n${indent}const t = useT();`);
      addedHook = true;
    }
  }

  if (edits.length === 0) return { file, applied: 0, skipped };

  if (!text.includes("useT")) {
    const imports = sourceFile.statements.filter(ts.isImportDeclaration);
    const position = imports.length > 0 ? imports[imports.length - 1].getEnd() : 0;
    addEdit(position, position, `\nimport { useT } from "@openreel/i18n/react";`);
  }

  const unique = [...new Map(edits.map((edit) => [`${edit.start}:${edit.end}:${edit.replacement}`, edit])).values()];
  unique.sort((a, b) => b.start - a.start);
  let output = text;
  let lastStart = Number.POSITIVE_INFINITY;
  let applied = 0;
  for (const edit of unique) {
    if (edit.end > lastStart) continue;
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    lastStart = edit.start;
    applied += 1;
  }
  if (write) writeFileSync(file, output);
  return { file, applied, skipped, addedHook };
}

const files = [];
for (const dir of dirs) walk(path.resolve(root, dir), files);
let total = 0;
let skippedTotal = 0;
for (const file of files) {
  const result = transformFile(file);
  if (result.applied > 0) {
    total += result.applied;
    console.log(`${String(result.applied).padStart(4)}  ${path.relative(root, file)}`);
  }
  for (const note of result.skipped ?? []) {
    skippedTotal += 1;
    console.log(`  SKIP ${path.relative(root, file)}:${note}`);
  }
}
console.log(`${write ? "wrote" : "would write"} ${total} edit(s) in ${files.length} file(s); ${skippedTotal} manual item(s)`);

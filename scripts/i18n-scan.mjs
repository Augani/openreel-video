#!/usr/bin/env node
// Shared scanner for user-visible strings. The inventory reports every
// candidate; the checker's --ui mode fails on candidates that are still raw.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsPath = require.resolve("typescript", { paths: [path.join(root, "packages/i18n")] });
const ts = require(tsPath);

export const DEFAULT_DIRS = {
  web: ["apps/web/src"],
  studio: ["apps/studio/src"],
  image: ["apps/image/src"],
  desktop: ["apps/desktop/src"],
};

const ATTRIBUTES = new Set([
  "title",
  "aria-label",
  "aria-description",
  "placeholder",
  "alt",
  "aria-valuetext",
]);
const CALL_FNS = new Set(["t", "translate", "translateNow"]);
const PROPERTY_NAMES = new Set([
  "label",
  "title",
  "description",
  "heading",
  "subtitle",
  "tooltip",
  "emptyText",
]);

let cachedAllowlist = null;

export function loadAllowlist(rootDir = root) {
  if (cachedAllowlist) return cachedAllowlist;
  let data = { exact: [], patterns: [] };
  try {
    data = JSON.parse(readFileSync(path.join(rootDir, "scripts/i18n-allowlist.json"), "utf8"));
  } catch {
    // No allowlist is a valid configuration.
  }
  cachedAllowlist = {
    exact: new Set(data.exact ?? []),
    patterns: (data.patterns ?? []).map((pattern) => new RegExp(pattern, "u")),
  };
  return cachedAllowlist;
}

export function isUiCopy(text, allowlist = loadAllowlist()) {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return false;
  if (!/[A-Za-z]{2}/u.test(value)) return false;
  if (allowlist.exact.has(value)) return false;
  for (const pattern of allowlist.patterns) {
    if (pattern.test(value)) return false;
  }
  return true;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isIgnored(lines, lineNumber) {
  const same = lines[lineNumber - 1] ?? "";
  const previous = lines[lineNumber - 2] ?? "";
  return same.includes("i18n-ignore") || previous.includes("i18n-ignore");
}

function stringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

export function scanFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = text.split("\n");
  const result = { jsxText: [], attributes: [], expressions: [], properties: [], calls: [] };
  const allowlist = loadAllowlist();

  const collectDisplayStrings = (expression) => {
    const add = (literal) => {
      const line = lineOf(sourceFile, literal);
      if (isUiCopy(literal.text, allowlist) && !isIgnored(lines, line)) {
        result.expressions.push({ line, text: literal.text });
      }
    };
    const walkExpression = (node) => {
      if (!node) return;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        add(node);
      } else if (ts.isConditionalExpression(node)) {
        walkExpression(node.whenTrue);
        walkExpression(node.whenFalse);
      } else if (ts.isParenthesizedExpression(node)) {
        walkExpression(node.expression);
      } else if (
        ts.isBinaryExpression(node) &&
        ["+", "??", "||", "&&"].includes(node.operatorToken.getText(sourceFile))
      ) {
        walkExpression(node.left);
        walkExpression(node.right);
      }
    };
    walkExpression(expression);
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const value = node.getText(sourceFile).replace(/\s+/g, " ").trim();
      const line = lineOf(sourceFile, node);
      if (isUiCopy(value, allowlist) && !isIgnored(lines, line)) {
        result.jsxText.push({ line, text: value });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      const value = node.initializer ? stringValue(node.initializer) : null;
      const line = lineOf(sourceFile, node);
      if (ATTRIBUTES.has(name) && value !== null && isUiCopy(value, allowlist) && !isIgnored(lines, line)) {
        result.attributes.push({ line, name, text: value });
      }
    } else if (ts.isJsxExpression(node)) {
      const parent = node.parent;
      if (
        ts.isJsxElement(parent) ||
        ts.isJsxFragment(parent) ||
        (ts.isJsxAttribute(parent) && ATTRIBUTES.has(parent.name.getText(sourceFile)))
      ) {
        collectDisplayStrings(node.expression);
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      if (CALL_FNS.has(fn)) {
        const index = fn === "translate" ? 1 : 0;
        const argument = node.arguments[index];
        const key = argument ? stringValue(argument) : null;
        const line = lineOf(sourceFile, node);
        if (key !== null && !isIgnored(lines, line)) result.calls.push({ line, key, fn });
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
        ? node.name.text
        : null;
      const value = stringValue(node.initializer);
      const line = lineOf(sourceFile, node);
      if (name && PROPERTY_NAMES.has(name) && value !== null && isUiCopy(value, allowlist) && !isIgnored(lines, line)) {
        result.properties.push({ line, name, text: value });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "release",
  ".git",
  ".cache",
  "test-results",
  "build",
  "coverage",
]);

function isSource(file) {
  if (!/\.(ts|tsx)$/u.test(file)) return false;
  if (/\.d\.ts$/u.test(file)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/u.test(file)) return false;
  return true;
}

function walk(target, files) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(path.join(target, entry), files);
    }
    return;
  }
  if (isSource(target)) files.push(target);
}

export function scanProject(rootDir = root, dirs = Object.values(DEFAULT_DIRS).flat()) {
  const files = [];
  for (const entry of dirs) {
    const target = path.isAbsolute(entry) ? entry : path.join(rootDir, entry);
    try {
      walk(target, files);
    } catch {
      // A missing scope is fine; callers report zero.
    }
  }
  return files.map((file) => ({
    file: path.relative(rootDir, file),
    ...scanFile(file),
  }));
}

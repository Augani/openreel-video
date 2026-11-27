#!/usr/bin/env node
// Static completeness check.
// - default: every literal key passed to t()/translate()/translateNow() exists;
//   placeholder sets match, values are non-empty and keys are unique.
// - --ui: additionally fail on user-visible JSX text/attributes that are still
//   raw (not wrapped in t()), excluding the allowlist and i18n-ignore lines.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_DIRS, root, scanProject } from "./i18n-scan.mjs";

const uiMode = process.argv.includes("--ui");
const dictionaryPath = path.join(root, "packages/i18n/src/zh-CN.json");
const rawDictionary = readFileSync(dictionaryPath, "utf8");
const dictionary = JSON.parse(rawDictionary);

const problems = [];
const pairs = [];
const keyCounts = new Map();
const pairPattern = /^\s{2}"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?$/gmu;
let match;
while ((match = pairPattern.exec(rawDictionary)) !== null) {
  const key = JSON.parse(`"${match[1]}"`);
  const value = JSON.parse(`"${match[2]}"`);
  pairs.push([key, value]);
  keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
}
for (const [key, count] of keyCounts) {
  if (count > 1) problems.push(`duplicate key ${JSON.stringify(key)} (${count})`);
}
const placeholders = (text) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((entry) => entry[1]).sort().join(",");
for (const [key, value] of pairs) {
  if (value.length === 0) problems.push(`empty value for ${JSON.stringify(key)}`);
  if (placeholders(key) !== placeholders(value)) {
    problems.push(`placeholder mismatch ${JSON.stringify(key)}: {${placeholders(key)}} vs {${placeholders(value)}}`);
  }
}

const scanned = scanProject(root, Object.values(DEFAULT_DIRS).flat());

const missing = [];
for (const entry of scanned) {
  for (const call of entry.calls) {
    if (!Object.prototype.hasOwnProperty.call(dictionary, call.key)) {
      missing.push(`${entry.file}:${call.line}  ${JSON.stringify(call.key)} (${call.fn})`);
    }
  }
}

const rawUi = [];
if (uiMode) {
  for (const entry of scanned) {
    for (const item of entry.jsxText) {
      rawUi.push(`${entry.file}:${item.line}  JSX  ${JSON.stringify(item.text)}`);
    }
    for (const item of entry.attributes) {
      rawUi.push(`${entry.file}:${item.line}  ${item.name}  ${JSON.stringify(item.text)}`);
    }
    for (const item of entry.expressions) {
      rawUi.push(`${entry.file}:${item.line}  EXPR  ${JSON.stringify(item.text)}`);
    }
  }
}

const unique = (entries) => [...new Set(entries)];
const failures = [
  ...unique(problems),
  ...unique(missing),
  ...unique(rawUi),
];

if (failures.length > 0) {
  console.error(`i18n check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(uiMode
  ? `i18n UI OK (${scanned.length} files scanned)`
  : `i18n keys OK (${scanned.length} files scanned)`);

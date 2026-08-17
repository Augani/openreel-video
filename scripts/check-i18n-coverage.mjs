#!/usr/bin/env node
// Reports translation coverage: which t("...") keys used in apps/web/src are
// missing from the zh locale bundle, and which zh entries are no longer used.
// Missing keys are fine (they fall back to the English key); this script just
// makes the gap visible while translating.
//
// Usage: node scripts/check-i18n-coverage.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require(path.resolve("apps/web/node_modules/typescript"));

const ROOT = path.resolve("apps/web/src");
const zh = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n/locales/zh.json"), "utf8"));

function walk(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) files.push(full);
  }
  return files;
}

const usedKeys = new Map(); // key -> occurrences
function visit(node, sf) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee) ? callee.text : "";
    if ((name === "t" || name === "tr" || name === "ti") && node.arguments.length >= 1) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        usedKeys.set(arg.text, (usedKeys.get(arg.text) ?? 0) + 1);
      }
    }
  }
  ts.forEachChild(node, (c) => visit(c, sf));
}

const files = walk(ROOT).filter(
  (f) => !/\.(test|spec)\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}__tests__${path.sep}`) && !f.includes(`${path.sep}i18n${path.sep}`),
);
for (const file of files) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  visit(sf, sf);
}

const zhKeys = new Set(Object.keys(zh));
const missing = [...usedKeys.keys()].filter((k) => !zhKeys.has(k));
const stale = [...zhKeys].filter((k) => !usedKeys.has(k));

console.log(`t() keys used in source: ${usedKeys.size}`);
console.log(`zh translations: ${zhKeys.size}`);
console.log(`coverage: ${Math.round(((usedKeys.size - missing.length) / usedKeys.size) * 100)}%`);
if (missing.length) {
  console.log(`\nmissing from zh.json (${missing.length}, most used first):`);
  missing
    .sort((a, b) => usedKeys.get(b) - usedKeys.get(a))
    .slice(0, 50)
    .forEach((k) => console.log(`  ${usedKeys.get(k)}x ${JSON.stringify(k.slice(0, 90))}`));
  if (missing.length > 50) console.log(`  ... and ${missing.length - 50} more`);
}
if (stale.length) {
  console.log(`\nzh entries not referenced by a literal t() call (${stale.length}; some flow through t(item.label) and are fine):`);
  stale.slice(0, 20).forEach((k) => console.log(`  ${JSON.stringify(k.slice(0, 90))}`));
}

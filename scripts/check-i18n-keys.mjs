#!/usr/bin/env node
// Static completeness check for menu translations: every literal key passed to
// t("...") / translate("en"|"zh-CN", "...") in a file that imports
// @openreel/i18n must exist in packages/i18n/src/zh-CN.json.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dictionary = JSON.parse(
  readFileSync(path.join(root, "packages/i18n/src/zh-CN.json"), "utf8"),
);

const roots = [
  "apps/web/src",
  "apps/studio/src",
  "apps/image/src",
  "apps/desktop/src",
];

const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
}

for (const directory of roots) {
  try {
    walk(path.join(root, directory));
  } catch {
    // A workspace without the directory is fine.
  }
}

const patterns = [
  /\bt\(\s*"((?:[^"\\]|\\.)*)"/g,
  /\bt\(\s*'((?:[^'\\]|\\.)*)'/g,
  /\btranslate\(\s*"(?:en|zh-CN)"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
  /\btranslate\(\s*'(?:en|zh-CN)'\s*,\s*'((?:[^'\\]|\\.)*)'/g,
  // Any simple first argument (e.g. `locale` in the desktop native menu); the
  // key must still be a string literal and the first argument must not span a
  // call or line, so non-literal keys are never matched.
  /\btranslate\(\s*[^,()\n]+,\s*"((?:[^"\\]|\\.)*)"/g,
  /\btranslate\(\s*[^,()\n]+,\s*'((?:[^'\\]|\\.)*)'/g,
];

const missing = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("@openreel/i18n")) continue;
  const lines = text.split("\n");

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const lineNumber = text.slice(0, match.index).split("\n").length;
      if ((lines[lineNumber - 1] ?? "").includes("i18n-ignore")) continue;

      let key;
      try {
        key = JSON.parse(`"${match[1]}"`);
      } catch {
        // Single-quoted literals keep embedded double quotes unescaped; unescape only
        // the quote/backslash sequences and use the result as the dictionary key.
        key = match[1].replace(/\\(['"\\])/g, "$1");
      }
      if (!Object.prototype.hasOwnProperty.call(dictionary, key)) {
        missing.push(`${path.relative(root, file)}:${lineNumber}  ${JSON.stringify(key)}`);
      }
    }
  }
}

const unique = [...new Set(missing)];
if (unique.length > 0) {
  console.error(`Missing zh-CN keys (${unique.length}):`);
  for (const entry of unique) console.error(`  ${entry}`);
  process.exit(1);
}
console.log(`i18n keys OK (${files.length} files scanned)`);

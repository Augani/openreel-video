#!/usr/bin/env node
// Report user-visible strings that are not yet translated.
// Usage: node scripts/i18n-inventory.mjs [--app web|studio|image|desktop]
//        [--all] [--paths dir1,dir2] [--json]
import { DEFAULT_DIRS, root, scanProject } from "./i18n-scan.mjs";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

let dirs;
if (args.includes("--all")) {
  dirs = Object.values(DEFAULT_DIRS).flat();
} else if (valueOf("--app")) {
  const app = valueOf("--app");
  if (!DEFAULT_DIRS[app]) {
    console.error(`Unknown app: ${app}`);
    process.exit(2);
  }
  dirs = DEFAULT_DIRS[app];
} else if (valueOf("--paths")) {
  dirs = valueOf("--paths")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
} else {
  dirs = Object.values(DEFAULT_DIRS).flat();
}

const results = scanProject(root, dirs).filter(
  (entry) =>
    entry.jsxText.length > 0 ||
    entry.attributes.length > 0 ||
    entry.properties.length > 0 ||
    entry.calls.length > 0,
);

if (args.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  let untranslated = 0;
  for (const entry of results) {
    const count = entry.jsxText.length + entry.attributes.length + entry.properties.length;
    untranslated += count;
    console.log(
      `${String(count).padStart(4)}  jsx=${entry.jsxText.length} attr=${entry.attributes.length} prop=${entry.properties.length}  ${entry.file}`,
    );
  }
  console.log(
    `total ${untranslated} untranslated candidate(s) in ${results.length} file(s); ${results.reduce((sum, entry) => sum + entry.calls.length, 0)} translated call(s)`,
  );
}

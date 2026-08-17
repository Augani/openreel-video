#!/usr/bin/env node
// Merge translation batch results (subagent final outputs) into apps/web/src/i18n/locales/zh.json
// Usage: node scripts/merge-i18n-results.mjs <output1> <output2> ...
import fs from "node:fs";
import path from "node:path";

const AGENT_DIR = "C:/Users/Administrator/.zcode/cli/agents/sess_68e6b226-5832-4631-bec6-340e5de0c855";
const BATCH_AGENTS = process.argv.slice(2);

const merged = new Map();
const skippedAll = new Set();
const warnings = [];

for (const agent of BATCH_AGENTS) {
  const file = path.join(AGENT_DIR, agent, "output.txt");
  if (!fs.existsSync(file)) {
    warnings.push(`missing output: ${agent}`);
    continue;
  }
  const raw = fs.readFileSync(file, "utf8").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    warnings.push(`no JSON object in ${agent}`);
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    warnings.push(`parse error in ${agent}: ${e.message}`);
    continue;
  }
  for (const [k, v] of Object.entries(parsed.translations ?? {})) {
    if (typeof v !== "string" || v.trim() === "") {
      warnings.push(`empty value for key ${JSON.stringify(k)} (${agent})`);
      continue;
    }
    // Splice-context keys must keep their leading/trailing spaces in the translation.
    if (/^\s/.test(k) && !/^\s/.test(v)) warnings.push(`leading space lost: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    if (/\s$/.test(k) && !/\s$/.test(v)) warnings.push(`trailing space lost: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    if (merged.has(k) && merged.get(k) !== v) {
      warnings.push(`conflict for ${JSON.stringify(k)}: ${JSON.stringify(merged.get(k))} vs ${JSON.stringify(v)}`);
    }
    merged.set(k, v);
  }
  for (const s of parsed.skipped ?? []) skippedAll.add(s);
}

const sorted = Object.fromEntries([...merged.entries()].sort((a, b) => a[0].localeCompare(b[0])));
const outPath = path.resolve("apps/web/src/i18n/locales/zh.json");
fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
console.log(`merged ${merged.size} translations (${skippedAll.size} skipped) -> ${outPath}`);
if (warnings.length) {
  console.log(`warnings (${warnings.length}):`);
  for (const w of warnings.slice(0, 60)) console.log(`  - ${w}`);
}

#!/usr/bin/env node
/**
 * Bundle-size budget for the web build (CI `perf-smoke` job, see apps/desktop/PERF.md).
 *
 *   pnpm --filter @openreel/web build && pnpm --filter @openreel/web bundle:budget
 *   node scripts/check-bundle-size.mjs [--dist dist] [--budgets bundle-budgets.json] [--json out.json]
 *
 * Bytes are deterministic (unlike input-to-paint timings), so this is safe as a required check.
 * What is measured, from dist/index.html:
 *   entry        the module script (what every launch compiles and evaluates first)
 *   initialJs    the entry plus every chunk it imports statically or that index.html preloads
 *   editor       the lazily loaded editor chunk (loaded in the background after the welcome screen)
 *   agent        the lazily loaded agent/MCP executor chunk (must stay off the startup path)
 * Each is checked raw and gzipped against bundle-budgets.json (KB, 1 KB = 1000 bytes).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const dist = path.resolve(opt("dist", path.join(here, "../dist")));
const budgetsFile = path.resolve(opt("budgets", path.join(here, "../bundle-budgets.json")));
const jsonOut = opt("json", null);
const budgets = JSON.parse(fs.readFileSync(budgetsFile, "utf8")).budgets;

const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const resolveAsset = (ref) => path.join(dist, ref.replace(/^\.?\//, ""));

const entryRef = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
if (!entryRef) throw new Error("no module script in dist/index.html");
const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);

const sizeCache = new Map();
function sizes(file) {
  if (!sizeCache.has(file)) {
    const buf = fs.readFileSync(file);
    sizeCache.set(file, { raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length });
  }
  return sizeCache.get(file);
}

/** Static import closure of a chunk (`import ... from "./x.js"` / `import "./x.js"` before any code). */
function staticImports(file) {
  const text = fs.readFileSync(file, "utf8");
  const found = new Set();
  for (const m of text.matchAll(/(?:^|[;}\n])\s*(?:import|export)\s*(?:[^"';]*?from\s*)?["'](\.\/[^"']+\.js)["']/g)) found.add(path.join(path.dirname(file), m[1]));
  return [...found];
}
const closure = new Set();
const visit = (file) => {
  if (closure.has(file) || !fs.existsSync(file)) return;
  closure.add(file);
  for (const dep of staticImports(file)) visit(dep);
};
visit(resolveAsset(entryRef));
for (const ref of preloads) if (ref.endsWith(".js")) visit(resolveAsset(ref));

const assets = fs.readdirSync(path.join(dist, "assets"));
const find = (prefix) => assets.filter((f) => f.startsWith(prefix) && f.endsWith(".js")).map((f) => path.join(dist, "assets", f));
const sum = (files) => files.reduce((acc, f) => ({ raw: acc.raw + sizes(f).raw, gzip: acc.gzip + sizes(f).gzip }), { raw: 0, gzip: 0 });
const biggest = (files) => files.sort((a, b) => sizes(b).raw - sizes(a).raw)[0];

const measured = {
  entry: sizes(resolveAsset(entryRef)),
  initialJs: sum([...closure]),
  editor: biggest(find("EditorInterface-")) ? sizes(biggest(find("EditorInterface-"))) : null,
  // The tool registry is the bulk of the agent stack. It sits in the executor chunk or, when only the
  // registry is shared with a lazy chat chunk, in a registry chunk of its own: measure the larger.
  agent: biggest([...find("executor-"), ...find("registry-")]) ? sizes(biggest([...find("executor-"), ...find("registry-")])) : null,
};

const kb = (n) => Math.round(n / 100) / 10;
let failed = 0;
const rows = [];
for (const [name, spec] of Object.entries(budgets)) {
  const m = measured[name];
  if (!m) {
    rows.push(`MISSING ${name}: chunk not found in ${dist}`);
    failed++;
    continue;
  }
  for (const kind of ["raw", "gzip"]) {
    const max = spec[`${kind}Kb`];
    if (max == null) continue;
    const ok = m[kind] <= max * 1000;
    if (!ok) failed++;
    rows.push(`${ok ? "ok     " : "OVER   "} ${name.padEnd(10)} ${kind.padEnd(5)} ${String(kb(m[kind])).padStart(8)} KB  budget ${String(max).padStart(6)} KB${spec.note && !ok ? `  (${spec.note})` : ""}`);
  }
}
console.log(rows.join("\n"));
console.log(failed ? `\n${failed} bundle budget(s) exceeded. Raise a budget only with a reason in the commit message.` : "\nall bundle budgets met");
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ measured, closureFiles: [...closure].map((f) => path.basename(f)) }, null, 2));
process.exit(failed ? 1 : 0);

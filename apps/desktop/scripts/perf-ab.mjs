#!/usr/bin/env node
/**
 * Interleaved A/B comparison of two already-built checkouts (see apps/desktop/PERF.md).
 *
 *   node scripts/perf-ab.mjs --a <baseRoot> --b <candidateRoot> [--pairs 5] [--out ab.json] [--metrics m1,m2] [--cached] [--env-a K=V] [--env-b K=V]
 *
 * Each "pair" launches the `trace` scenario of perf-harness.mjs once against A and once against B,
 * back to back (the order alternates every pair so neither side always runs first or second), so
 * machine load that drifts during the comparison hits both sides. Reports the median of every
 * numeric trace metric per side and the median of the per-pair B - A differences. CPU-time metrics
 * (`*CpuMs`) are the ones that stay meaningful on a busy machine; wall-clock rows are for context.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const rootA = path.resolve(opt("a", ""));
const rootB = path.resolve(opt("b", ""));
const pairs = Number(opt("pairs", 5));
const outFile = opt("out", null);
const wanted = opt("metrics", null)?.split(",");
const cached = argv.includes("--cached");
// --env-a K=V / --env-b K=V: extra environment for one side only (e.g. OPENREEL_JS_FLAGS=... to
// A/B a V8 flag on the same build). Repeatable.
const sideEnv = { A: {}, B: {} };
for (let i = 0; i < argv.length; i++) {
  const m = /^--env-([ab])$/.exec(argv[i]);
  if (!m) continue;
  const [k, ...rest] = String(argv[i + 1]).split("=");
  sideEnv[m[1].toUpperCase()][k] = rest.join("=");
}
if (!opt("a") || !opt("b")) {
  console.error("usage: perf-ab.mjs --a <rootA> --b <rootB> [--pairs 5] [--out file.json] [--metrics a,b]");
  process.exit(2);
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orperf-ab-"));

// A run that cannot be analysed (for example a missing `openreel:entry` mark) fails the comparison
// loudly: the harness starts the content trace before the renderer can load (see
// perf-trace-preload.cjs), so a missing mark is a bug to fix, not a measurement to retry.
function runOnce(root, tag, side) {
  const out = path.join(tmp, `${tag}.json`);
  const only = cached ? "trace,traceCached" : "trace";
  const r = spawnSync(process.execPath, [path.join(here, "perf-harness.mjs"), "--only", only, "--trace-runs", "1", "--root", root, "--out", out, "--label", tag], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, ...sideEnv[side] },
  });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`harness run ${tag} failed (exit ${r.status})`);
  const json = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(out, { force: true });
  return json.scenarios;
}

const scenarioNames = ["traceCold", "traceDwell", ...(cached ? ["traceCached"] : [])];
const empty = () => Object.fromEntries(scenarioNames.map((n) => [n, []]));
const samples = { A: empty(), B: empty() };
const loads = [];
for (let i = 0; i < pairs; i++) {
  const order = i % 2 === 0 ? ["A", "B"] : ["B", "A"];
  for (const side of order) {
    const scenarios = runOnce(side === "A" ? rootA : rootB, `${side}${i}`, side);
    for (const name of scenarioNames) samples[side][name].push(scenarios[name].runs[0]);
  }
  loads.push(Math.round(os.loadavg()[0] * 10) / 10);
  console.error(`[perf-ab] pair ${i + 1}/${pairs} done (load ${loads[loads.length - 1]})`);
}

const report = {};
for (const name of scenarioNames) {
  const keys = Object.keys(samples.A[name][0]).filter((k) => typeof samples.A[name][0][k] === "number");
  report[name] = {};
  for (const k of keys) {
    if (wanted && !wanted.includes(k)) continue;
    const a = samples.A[name].map((r) => r[k]);
    const b = samples.B[name].map((r) => r[k]);
    report[name][k] = { a: median(a), b: median(b), diff: Math.round((median(b) - median(a)) * 10) / 10, pairDiffMedian: Math.round(median(b.map((v, i) => v - a[i])) * 10) / 10, aRuns: a, bRuns: b };
  }
}
const sortedLoads = [...loads].sort((x, y) => x - y);
const loadSummary = { perPair: loads, median: sortedLoads[Math.floor(sortedLoads.length / 2)], max: sortedLoads[sortedLoads.length - 1] };
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ rootA, rootB, pairs, load: loadSummary, report }, null, 2));
for (const name of Object.keys(report)) {
  console.log(`\n== ${name} (median of ${pairs} interleaved pairs; B - A, negative = B faster; load avg per pair ${loads.join(" ")})`);
  for (const [k, v] of Object.entries(report[name])) {
    if (/PerChunk/.test(k)) continue;
    console.log(`${k.padEnd(30)} A ${String(v.a).padStart(8)}  B ${String(v.b).padStart(8)}  diff ${String(v.diff).padStart(7)}  pairDiff ${String(v.pairDiffMedian).padStart(7)}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

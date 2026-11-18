#!/usr/bin/env node
/**
 * Perf budget check for the desktop (Electron) app.
 *
 * Runs scripts/perf-harness.mjs `--runs` times (default 3; each run is fresh Electron
 * launches with a cold-start pass, a CPU-time trace pass and a 400-clip bench pass), takes the MEDIAN of each budgeted
 * metric across runs and exits 1 when any exceeds its budget in perf-budgets.json.
 *
 *   node scripts/perf-budget.mjs                      # build must exist (pnpm --filter @openreel/desktop build)
 *   node scripts/perf-budget.mjs --runs 5
 *   node scripts/perf-budget.mjs --from a.json b.json # check existing harness outputs, no launch
 *   node scripts/perf-budget.mjs --budgets my.json --root <checkout>
 *   node scripts/perf-budget.mjs --save out/          # keep each run's harness JSON (CI uploads them)
 *   node scripts/perf-budget.mjs --max-load 2.5       # judge wall-clock budgets only at or below this 1-min load
 *   node scripts/perf-budget.mjs --require-wall       # exit 3 when wall-clock budgets could not be judged
 *
 * The last line of the output is the verdict: "WALL-CLOCK NOT VERIFIED ..." when any wall-clock budget was
 * not judged (even if everything judged passed; the exit code is still 0 unless --require-wall), and
 * "ALL BUDGETS VERIFIED, including wall-clock" only when none was skipped.
 *
 * Load awareness: every harness run records os.loadavg()[0] around each Electron launch
 * (`load.samples` in its JSON). Budgets are of two kinds. CPU budgets (`traceCold.*`, `traceDwell.*`:
 * renderer main-thread CPU time from a Chromium trace; also any budget with "kind": "cpu") are
 * always judged, as are memory budgets ("kind": "mem", e.g. `memory4k.peakTotalMB`: a byte count does not
 * depend on how busy the machine is). Wall-clock budgets (everything else; "kind": "wall") are judged only when the
 * median over runs of each run's max load sample is <= --max-load (default 2.5, an idle Apple
 * silicon laptop sits at 1-2); above it they are reported as "not judged: load X" and do not fail the
 * check, because a wall-clock number taken at load 30 says nothing about the build. Every line
 * prints the load its numbers were taken at.
 *
 * NOT part of required CI: frame timings on a shared or throttled machine are noisy (the
 * harness measures real input -> paint latency). Run it locally or in a dedicated, otherwise
 * idle job and treat a single failure as "re-run", two in a row as a regression.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { budgetVerdict } from "./perf-analysis.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const opt = (name, def) => (flag(name) >= 0 ? argv[flag(name) + 1] : def);
const runs = Number(opt("runs", 3));
const budgetsFile = path.resolve(opt("budgets", path.join(here, "perf-budgets.json")));
const root = opt("root", null);
const saveDir = opt("save", null);
const maxLoad = Number(opt("max-load", process.env.OPENREEL_PERF_MAX_LOAD ?? 2.5));
const requireWall = flag("require-wall") >= 0;
const fromIdx = flag("from");
const fromFiles = fromIdx >= 0 ? argv.slice(fromIdx + 1).filter((a) => !a.startsWith("--")) : [];

const budgets = JSON.parse(fs.readFileSync(budgetsFile, "utf8")).budgets;

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const pick = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

function collect() {
  if (fromFiles.length) return fromFiles.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const results = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orperf-budget-"));
  for (let i = 0; i < runs; i++) {
    const out = path.join(tmp, `run${i}.json`);
    const args = [path.join(here, "perf-harness.mjs"), "--only", "cold,bench,trace,traceCached,memory4k,playback,scrub4k,playback4k,importN", "--cold-runs", "3", "--trace-runs", "3", "--out", out, "--label", `budget${i}`];
    if (root) args.push("--root", root);
    console.error(`[perf-budget] run ${i + 1}/${runs}`);
    const r = spawnSync(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0 || !fs.existsSync(out)) {
      console.error(`[perf-budget] harness run ${i + 1} failed (exit ${r.status}); is the desktop build present?`);
      process.exit(2);
    }
    results.push(JSON.parse(fs.readFileSync(out, "utf8")));
    if (saveDir) {
      fs.mkdirSync(saveDir, { recursive: true });
      fs.copyFileSync(out, path.join(saveDir, `run${i}.json`));
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return results;
}

const results = collect();

/** CPU-time budgets stay meaningful under load; everything else is wall clock. */
const kindOf = (metric, spec) => spec.kind ?? (/^trace/.test(metric) ? "cpu" : "wall");
// "cpu" and "mem" budgets are not wall-clock timings, so they are judged at any machine load.
const runLoad = (r) => (r.load && typeof r.load.max === "number" ? r.load.max : null);
const loads = results.map(runLoad).filter((v) => v != null);
const judgedLoad = loads.length ? median(loads) : null;
const loadKnown = judgedLoad != null;
const loadText = loadKnown ? `load ${judgedLoad.toFixed(1)} (per run max: ${loads.map((v) => v.toFixed(1)).join(", ")})` : "load unknown";
const wallJudgeable = loadKnown && judgedLoad <= maxLoad;

let failed = 0;
let notJudged = 0;
const rows = [];
for (const [metric, spec] of Object.entries(budgets)) {
  const kind = kindOf(metric, spec);
  const values = results.map((r) => pick(r.scenarios, metric)).filter((v) => typeof v === "number");
  if (!values.length) {
    rows.push({ metric, kind, status: "MISSING", note: "not in harness output" });
    failed++;
    continue;
  }
  const m = median(values);
  if (kind === "wall" && !wallJudgeable) {
    notJudged++;
    rows.push({
      metric, kind, status: "n/j", median: m, max: spec.max, runs: values.join(", "),
      note: loadKnown ? `not judged: load ${judgedLoad.toFixed(1)} > ${maxLoad}` : "not judged: load unknown (harness output has no load samples)",
    });
    continue;
  }
  const ok = m <= spec.max;
  if (!ok) failed++;
  rows.push({ metric, kind, status: ok ? "ok" : "OVER", median: m, max: spec.max, runs: values.join(", "), note: spec.note ?? "" });
}
console.log(`machine ${loadText}; wall-clock budgets are judged at load <= ${maxLoad}`);
for (const r of rows) {
  console.log(
    `${r.status.padEnd(7)} ${r.kind.padEnd(4)} ${r.metric.padEnd(52)} median ${String(r.median ?? "-").padStart(7)}  budget ${String(r.max ?? "-").padStart(6)}  [${r.runs ?? ""}]${r.status === "n/j" ? `  ${r.note}` : ""}${r.status === "OVER" && r.kind === "cpu" && loadKnown && !wallJudgeable ? `  (taken at load ${judgedLoad.toFixed(1)}: CPU time inflates 1.3-2x under heavy contention, re-judge on a quieter machine before calling it a regression)` : ""}`,
  );
}
// The LAST line is the verdict and cannot be misread: "WALL-CLOCK NOT VERIFIED" whenever a wall-clock
// budget was skipped (exit 3 only under --require-wall), "ALL BUDGETS VERIFIED" only when none was.
const verdict = budgetVerdict({ failed, notJudged, judged: rows.length - notJudged, loadText, maxLoad, requireWall });
console.log(`\n${verdict.lines.join("\n")}`);
process.exit(verdict.exitCode);

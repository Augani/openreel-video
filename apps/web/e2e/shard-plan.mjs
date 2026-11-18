#!/usr/bin/env node
/**
 * Duration-balanced e2e sharding.
 *
 * `playwright test --shard=i/n` slices the test list into contiguous runs with an EQUAL NUMBER OF TESTS,
 * ignoring how long each takes. Here a test is anywhere between 3 s and 10 minutes (the no-GPU fallback
 * projects sit together at the end of the list), so one shard ran for 90 minutes while another finished in
 * 14. This planner assigns every test to the least-loaded shard, longest first, using the measured seconds in
 * shard-weights.json (a test not listed there counts as DEFAULT_SECONDS).
 *
 *   node e2e/shard-plan.mjs <shard 1..n> <n> > plan.json
 *   OPENREEL_E2E_SHARD_PLAN=plan.json pnpm test:e2e
 *
 * playwright.config.ts reads the plan and gives each project a `grep` that matches exactly its assigned tests.
 * Run from apps/web. `--summary` prints the predicted load of every shard instead of a plan.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SECONDS = 30;
const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const summary = args.includes("--summary");
const [shardArg, totalArg] = args.filter((a) => !a.startsWith("--"));
const total = Number(totalArg);
const shard = Number(shardArg);
if (!Number.isInteger(total) || total < 1 || (!summary && (!Number.isInteger(shard) || shard < 1 || shard > total))) {
  console.error("usage: node e2e/shard-plan.mjs <shard> <total> [--summary]");
  process.exit(2);
}

const weights = JSON.parse(readFileSync(join(here, "shard-weights.json"), "utf8"));

// A listing needs no browser. The plan env var must not be set, or the config would filter the listing.
const listing = JSON.parse(
  execFileSync("npx", ["playwright", "test", "--list", "--reporter=json"], {
    cwd: join(here, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, OPENREEL_E2E_SHARD_PLAN: "" },
  }),
);

/** "file describe... title": what playwright.config.ts matches `grep` against (project name excluded). */
const tests = [];
const walk = (suite, path) => {
  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const title = [...path, spec.title].join(" ");
      tests.push({ project: t.projectName, title, seconds: weights[`${t.projectName}|${title}`] ?? DEFAULT_SECONDS });
    }
  }
};
walk({ suites: listing.suites }, []);
if (tests.length === 0) throw new Error("no tests listed");

// Longest first; ties by name so the plan is identical on every shard's machine.
tests.sort((a, b) => b.seconds - a.seconds || `${a.project}|${a.title}`.localeCompare(`${b.project}|${b.title}`));
const loads = Array.from({ length: total }, () => ({ seconds: 0, tests: [] }));
for (const t of tests) {
  let best = loads[0];
  for (const l of loads) if (l.seconds < best.seconds) best = l;
  best.seconds += t.seconds;
  best.tests.push(t);
}

if (summary) {
  loads.forEach((l, i) => console.log(`shard ${i + 1}/${total}: ${l.tests.length} tests, ~${(l.seconds / 60).toFixed(1)} min`));
  process.exit(0);
}

const plan = {};
for (const t of loads[shard - 1].tests) (plan[t.project] ??= []).push(t.title);
process.stdout.write(`${JSON.stringify(plan, null, 1)}\n`);

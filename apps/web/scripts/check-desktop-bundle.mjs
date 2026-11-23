import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Desktop renderer payload check (run after `OPENREEL_DESKTOP=1 pnpm --filter @openreel/web build`).
 *
 * Prints the dist size by category, then enforces:
 *  1. no ffmpeg.wasm cores (the desktop uses the native ffmpeg sidecar);
 *  2. exactly ONE onnxruntime-web WASM runtime, under ort/ (a second copy means a bundler emitted its own hashed one, usually because
 *     two onnxruntime-web versions are installed or an importer resolved the bundled-wasm entry instead of the extern-wasm one);
 *  3. no byte-identical duplicate files of 100 KB or more;
 *  4. the total stays within MAX_BYTES.
 *
 * MAX_BYTES is the owner's budget and is NOT adjusted here. The ONNX runtime alone (JSEP build, needed for WebGPU whisper) is
 * ~20.6 MiB, so with it deduplicated the realistic floor is above 20 MiB and check 4 fails on an honest build; the script says so
 * rather than hiding it. `--info` (or OPENREEL_BUNDLE_INFO=1) prints the report and skips check 4 only; checks 1-3 always fail hard.
 */
const DIST = new URL("../dist/", import.meta.url).pathname;
const MAX_BYTES = 20 * 1024 * 1024;
const INFO_ONLY = process.argv.includes("--info") || process.env.OPENREEL_BUNDLE_INFO === "1";
const DUPLICATE_MIN_BYTES = 100 * 1024;

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path));
    else out.push({ path, rel: relative(DIST, path), size: statSync(path).size });
  }
  return out;
}

function category(file) {
  const { rel } = file;
  if (rel.startsWith("ort/")) return "onnxruntime runtime (ort/)";
  if (rel.startsWith("models/")) return "models (public/models)";
  if (rel.startsWith("fonts/")) return "fonts";
  if (/\.wasm$/.test(rel)) return "other wasm";
  if (/^assets\/.*\.(js|mjs)$/.test(rel)) return "javascript (assets)";
  if (/^assets\/.*\.css$/.test(rel)) return "css (assets)";
  if (rel.startsWith("assets/")) return "other assets";
  return "other (html, icons, previews, thumbnails)";
}

const files = listFiles(DIST);
const total = files.reduce((sum, file) => sum + file.size, 0);

const byCategory = new Map();
for (const file of files) {
  const name = category(file);
  const row = byCategory.get(name) ?? { bytes: 0, count: 0 };
  row.bytes += file.size;
  row.count += 1;
  byCategory.set(name, row);
}
console.log(`Desktop renderer dist: ${mb(total)} (${files.length} files)`);
for (const [name, row] of [...byCategory].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${mb(row.bytes).padStart(10)}  ${String(row.count).padStart(4)} files  ${name}`);
}
console.log("Largest files:");
for (const file of [...files].sort((a, b) => b.size - a.size).slice(0, 5)) console.log(`  ${mb(file.size).padStart(10)}  ${file.rel}`);

const failures = [];

const ffmpegCores = files.filter((file) => /ffmpeg-core.*\.wasm$/.test(file.path));
if (ffmpegCores.length > 0) failures.push(`ffmpeg.wasm cores should be stripped:\n    ${ffmpegCores.map((file) => file.rel).join("\n    ")}`);

const ortWasm = files.filter((file) => /(^|\/)ort-wasm[^/]*\.wasm$/.test(file.rel));
const strayOrt = ortWasm.filter((file) => !file.rel.startsWith("ort/"));
if (ortWasm.length !== 1 || strayOrt.length > 0) {
  failures.push(`expected exactly one onnxruntime wasm under ort/, found ${ortWasm.length}:\n    ${ortWasm.map((file) => `${file.rel} (${mb(file.size)})`).join("\n    ")}`);
}

const bySize = new Map();
for (const file of files.filter((candidate) => candidate.size >= DUPLICATE_MIN_BYTES)) {
  const list = bySize.get(file.size) ?? [];
  list.push(file);
  bySize.set(file.size, list);
}
for (const group of bySize.values()) {
  if (group.length < 2) continue;
  const byHash = new Map();
  for (const file of group) {
    const hash = createHash("sha1").update(readFileSync(file.path)).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), file.rel]);
  }
  for (const same of byHash.values()) if (same.length > 1) failures.push(`byte-identical duplicates (${mb(group[0].size)} each): ${same.join(", ")}`);
}

if (total > MAX_BYTES) {
  const message = `total ${mb(total)} exceeds the ${mb(MAX_BYTES)} budget (without the onnxruntime runtime: ${mb(total - (byCategory.get("onnxruntime runtime (ort/)")?.bytes ?? 0))})`;
  if (INFO_ONLY) console.log(`INFO (not enforced with --info): ${message}`);
  else failures.push(message);
}

if (failures.length > 0) {
  console.error(`Desktop bundle check FAILED:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`Desktop bundle OK: ${mb(total)}, one onnxruntime wasm, no ffmpeg.wasm, no duplicates`);

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const MAX_BYTES = 20 * 1024 * 1024;

function walk(dir) {
  let total = 0;
  const wasm = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = walk(p);
      total += r.total;
      wasm.push(...r.wasm);
    } else {
      total += statSync(p).size;
      if (/ffmpeg-core.*\.wasm$/.test(entry.name)) wasm.push(p);
    }
  }
  return { total, wasm };
}

const { total, wasm } = walk(DIST);
if (wasm.length > 0) {
  console.error(`Desktop bundle contains ffmpeg.wasm cores (should be stripped):\n${wasm.join("\n")}`);
  process.exit(1);
}
if (total > MAX_BYTES) {
  console.error(`Desktop bundle ${(total / 1048576).toFixed(1)}MB exceeds budget ${(MAX_BYTES / 1048576).toFixed(0)}MB`);
  process.exit(1);
}
console.log(`Desktop bundle OK: ${(total / 1048576).toFixed(1)}MB, no ffmpeg.wasm`);

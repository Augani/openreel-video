// Builds openreel-plughost, the out-of-process plugin helper (macOS Audio Units), from native/plughost/main.swift.
//
//   node scripts/build-plughost.mjs            host architecture
//   node scripts/build-plughost.mjs --all      arm64 and x64 (the mac release builds both)
//
// Output (gitignored): resources/plughost/darwin-<arch>/openreel-plughost. On other platforms, and on a Mac without a Swift
// toolchain, the build is skipped: the app then reports plugin hosting as unavailable instead of failing.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "native", "plughost", "main.swift");

if (process.platform !== "darwin") {
  console.log("[build-plughost] skipped: the helper hosts Audio Units and only builds on macOS");
  process.exit(0);
}
const probe = spawnSync("xcrun", ["--find", "swiftc"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.warn("[build-plughost] skipped: no Swift toolchain (xcrun --find swiftc failed); plugin hosting will be unavailable");
  process.exit(0);
}

const hostArch = process.arch === "arm64" ? "arm64" : "x64";
const arches = process.argv.includes("--all") ? ["arm64", "x64"] : [hostArch];
for (const arch of arches) {
  const out = path.join(root, "resources", "plughost", `darwin-${arch}`, "openreel-plughost");
  mkdirSync(path.dirname(out), { recursive: true });
  const triple = arch === "arm64" ? "arm64-apple-macos12.0" : "x86_64-apple-macos12.0";
  console.log(`[build-plughost] swiftc ${arch} -> ${path.relative(root, out)}`);
  execFileSync("xcrun", ["swiftc", "-O", "-swift-version", "5", "-target", triple, "-o", out, source], { stdio: "inherit" });
  console.log(`[build-plughost] ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

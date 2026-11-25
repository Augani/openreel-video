// Builds openreel-vst3host, the out-of-process VST3 plugin helper (C++ against the MIT licensed Steinberg VST3 SDK).
//
//   node scripts/build-vst3host.mjs            host architecture
//   node scripts/build-vst3host.mjs --all      arm64 and x64 on macOS (the mac release builds both)
//
// The SDK is not part of this repository: scripts/lib/vst3sdk.mjs fetches the pinned v3.8.1_build_84 sources at build time
// and checks each archive against a SHA-256. Output (gitignored): resources/vst3host/<platform>-<arch>/openreel-vst3host
// (.exe on Windows) next to the SDK's MIT licence text. When the SDK cannot be fetched (offline), or there is no CMake or C++
// toolchain, the build is skipped with a message: the app then lists VST3 plugins as unsupported instead of failing.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VST3_SDK_TAG, VST3_SDK_VERSION, ensureVst3Sdk } from "./lib/vst3sdk.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "native", "vst3host");

// OPENREEL_REQUIRE_VST3HOST=1 (the release workflow) turns every "skipped" below into a failure: a release must not silently lose VST3 hosting.
const skip = (message) => {
  if (process.env.OPENREEL_REQUIRE_VST3HOST === "1") {
    console.error(`[build-vst3host] ${message}`);
    process.exit(1);
  }
  console.warn(`[build-vst3host] skipped: ${message}; VST3 hosting will be unavailable`);
  process.exit(0);
};
const run = (command, args, options = {}) => spawnSync(command, args, { stdio: "inherit", ...options });
const has = (command, args = ["--version"]) => spawnSync(command, args, { stdio: "ignore" }).status === 0;

if (!has("cmake")) {
  skip("CMake (3.25 or newer) is not installed");
}
if (process.platform === "darwin" && spawnSync("xcrun", ["--find", "clang++"], { stdio: "ignore" }).status !== 0) {
  skip("no C++ toolchain (xcrun --find clang++ failed)");
}

const sdk = await ensureVst3Sdk(root);
if (!sdk) {
  skip("the VST3 SDK is unavailable");
}

const hostArch = process.arch === "arm64" ? "arm64" : "x64";
const arches = process.platform === "darwin" && process.argv.includes("--all") ? ["arm64", "x64"] : [hostArch];
// Windows builds with MSVC through CMake's default Visual Studio generator: Ninja on a GitHub Windows runner picks up
// MinGW g++, whose libstdc++ has no std::aligned_alloc, and the VST3 SDK does not compile there.
const generatorFor = (arch) =>
  process.platform === "win32" ? ["-A", arch === "arm64" ? "ARM64" : "x64"] : has("ninja") ? ["-G", "Ninja"] : [];
let failed = false;
for (const arch of arches) {
  const build = path.join(root, ".cache", "vst3host-build", `${process.platform}-${arch}`);
  const outDir = path.join(root, "resources", "vst3host", `${process.platform}-${arch}`);
  const exe = process.platform === "win32" ? "openreel-vst3host.exe" : "openreel-vst3host";
  mkdirSync(outDir, { recursive: true });
  const archFlags = process.platform === "darwin" ? [`-DCMAKE_OSX_ARCHITECTURES=${arch === "arm64" ? "arm64" : "x86_64"}`] : [];
  console.log(`[build-vst3host] cmake ${process.platform}-${arch} (VST3 SDK ${VST3_SDK_VERSION}, ${VST3_SDK_TAG})`);
  if (run("cmake", ["-S", source, "-B", build, ...generatorFor(arch), "-DCMAKE_BUILD_TYPE=Release", `-DOPENREEL_VST3_SDK=${sdk}`, ...archFlags]).status !== 0) { failed = true; continue; }
  if (run("cmake", ["--build", build, "--config", "Release", "--target", "openreel-vst3host", "--parallel"]).status !== 0) { failed = true; continue; }
  const candidates = [path.join(build, "bin", exe), path.join(build, "bin", "Release", exe), path.join(build, "Release", exe)];
  const built = candidates.find((c) => existsSync(c));
  if (!built) { console.error("[build-vst3host] the helper binary was not produced"); failed = true; continue; }
  // Replace, never overwrite in place: macOS keeps the old code signature of a vnode and kills a binary copied over it.
  rmSync(path.join(outDir, exe), { force: true });
  copyFileSync(built, path.join(outDir, exe));
  console.log(`[build-vst3host] ${path.relative(root, path.join(outDir, exe))} ${(statSync(path.join(outDir, exe)).size / 1024).toFixed(0)} KB`);
}
if (!failed) {
  // MIT requires the notice to ship with the compiled SDK code.
  const licenseDir = path.join(root, "resources", "vst3host");
  copyFileSync(path.join(sdk, "LICENSE.txt"), path.join(licenseDir, "LICENSE-vst3sdk.txt"));
  writeFileSync(path.join(licenseDir, "NOTICE.txt"), `openreel-vst3host is linked against the Steinberg VST 3 SDK ${VST3_SDK_VERSION} (${VST3_SDK_TAG}), MIT License, Copyright (c) 2026 Steinberg Media Technologies GmbH. See LICENSE-vst3sdk.txt.\nVST is a trademark of Steinberg Media Technologies GmbH.\n`);
}
if (failed) {
  // Only a release that asks for the helper (OPENREEL_REQUIRE_VST3HOST=1) fails here; any other build ships without
  // VST3 hosting, which the app already reports as unsupported, instead of losing the whole desktop build.
  skip("the helper did not build");
}
process.exit(0);

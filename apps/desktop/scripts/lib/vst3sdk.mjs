// Fetches the pinned, MIT licensed Steinberg VST3 SDK at build time. Nothing from the SDK is committed to this repo.
//
// The SDK is split over five GitHub repositories (the top level repo only references the others as submodules, which a
// source tarball does not include), so each one is fetched at the commit its v3.8.1_build_84 tag pins, checked against a
// SHA-256 and assembled into one tree:
//
//   <cache>/vst3sdk-3.8.1/{CMakeLists.txt, LICENSE.txt, base/, cmake/, pluginterfaces/, public.sdk/}
//
// Licence: MIT, "Copyright (c) 2026, Steinberg Media Technologies GmbH" (LICENSE.txt in every one of those repositories).
// See docs/audio-plugin-hosting.md for the verification.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const VST3_SDK_VERSION = "3.8.1";
export const VST3_SDK_TAG = "v3.8.1_build_84";

/** dir: where the repository's contents land inside the assembled tree ("" = the root). */
export const VST3_SDK_PARTS = [
  { repo: "vst3sdk", dir: "", sha: "3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96", sha256: "fbc6e6f713cd3644ab9440496a75ce714e2ad435dbdd38825fe8834f31456fb6" },
  { repo: "vst3_base", dir: "base", sha: "fcf9da0bd27a16f7f03773a3a39822f28f5c8477", sha256: "3753d45a79b5e324c2843d74a18c8f1117fe0b1118fa9312658aecf6360ec603" },
  { repo: "vst3_cmake", dir: "cmake", sha: "054c9143cbb8d47fc4694e473f2ee3b4d951a8f5", sha256: "d8bddb3d87d66b5078e803d271ef82ba51bc74f941e0ca8256e7145950db409e" },
  { repo: "vst3_pluginterfaces", dir: "pluginterfaces", sha: "4f547e8e102b47de4a8b8aaf343c73b700786372", sha256: "ee70777eebb8450fc04fae2a6dd452f723d12bfb8222af443b8c1f8a9259089a" },
  { repo: "vst3_public_sdk", dir: "public.sdk", sha: "586dc5e6c8012c3e4b01c79389375cbe96bdb1da", sha256: "71319491b771068b8e2c5374c22830a339677e9d54c4cd33af4a0aa210e4c838" },
];

export function defaultSdkRoot(desktopRoot) {
  return process.env.OPENREEL_VST3_SDK_DIR || path.join(desktopRoot, ".cache", `vst3sdk-${VST3_SDK_VERSION}`);
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Returns the SDK directory, fetching it if needed. Returns null (never throws) when it cannot be had: offline, a checksum
 * that does not match, no tar. `log` receives the reason so the caller can skip cleanly.
 */
export async function ensureVst3Sdk(desktopRoot, log = console.warn) {
  const root = defaultSdkRoot(desktopRoot);
  const stamp = path.join(root, ".fetched");
  const expected = VST3_SDK_PARTS.map((p) => `${p.repo}@${p.sha}`).join("\n");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === expected) return root;
  if (process.env.OPENREEL_VST3_SDK_DIR && existsSync(path.join(root, "CMakeLists.txt"))) return root;
  const work = mkdtempSync(path.join(os.tmpdir(), "openreel-vst3sdk-"));
  try {
    const assembled = path.join(work, "sdk");
    mkdirSync(assembled);
    for (const part of VST3_SDK_PARTS) {
      const url = `https://codeload.github.com/steinbergmedia/${part.repo}/tar.gz/${part.sha}`;
      const data = await download(url);
      const digest = createHash("sha256").update(data).digest("hex");
      if (digest !== part.sha256) throw new Error(`${part.repo}: checksum mismatch (got ${digest}, pinned ${part.sha256})`);
      const archive = path.join(work, `${part.repo}.tgz`);
      writeFileSync(archive, data);
      const extracted = path.join(work, `x-${part.repo}`);
      mkdirSync(extracted);
      const tar = spawnSync("tar", ["xzf", archive, "-C", extracted, "--strip-components=1"], { encoding: "utf8" });
      if (tar.status !== 0) throw new Error(`${part.repo}: tar failed: ${tar.stderr || tar.error}`);
      cpSync(extracted, part.dir ? path.join(assembled, part.dir) : assembled, { recursive: true });
    }
    writeFileSync(path.join(assembled, ".fetched"), expected);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(path.dirname(root), { recursive: true });
    cpSync(assembled, root, { recursive: true });
    return root;
  } catch (error) {
    log(`[vst3sdk] could not fetch the VST3 SDK ${VST3_SDK_VERSION}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

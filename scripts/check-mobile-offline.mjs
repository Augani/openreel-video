import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const androidRoot = join(root, "Openreel Video Android");
const iosRoot = join(root, "Openreel Video", "Openreel Video");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function filesBelow(directory, extensions) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...filesBelow(path, extensions));
    else if (extensions.has(extname(path))) files.push(path);
  }
  return files;
}

function rejectPatterns(files, patterns, label) {
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      assert(!pattern.test(source), `${label}: ${relative(root, file)} matches ${pattern}`);
    }
  }
}

const manifestPath = join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
const manifest = readFileSync(manifestPath, "utf8");
assert(
  /android\.permission\.INTERNET"\s+tools:node="remove"/.test(manifest),
  "Android must explicitly remove transitive INTERNET permission",
);
assert(
  /android\.permission\.ACCESS_NETWORK_STATE"\s+tools:node="remove"/.test(manifest),
  "Android must explicitly remove transitive network-state permission",
);
assert(manifest.includes('android:allowBackup="false"'), "Android backups must remain disabled");

const androidFiles = filesBelow(join(androidRoot, "app", "src", "main", "java"), new Set([".kt", ".java"]));
rejectPatterns(
  androidFiles,
  [/\bokhttp3\b/, /\bPlayIntegrity\b/, /\bAICloudJob\b/, /https?:\/\//],
  "Android online dependency",
);
rejectPatterns(
  [join(androidRoot, "app", "build.gradle.kts"), join(androidRoot, "gradle", "libs.versions.toml")],
  [/okhttp/i, /play.?integrity/i, /mockwebserver/i],
  "Android build dependency",
);

const iosFiles = filesBelow(iosRoot, new Set([".swift"]));
rejectPatterns(
  iosFiles,
  [/\bURLSession\b/, /\bAppAttest\b/, /\bAICloudJob\b/, /\bS3MediaUploader\b/, /https?:\/\//],
  "iOS online dependency",
);
rejectPatterns(
  [join(root, "Openreel Video", "Openreel Video.xcodeproj", "project.pbxproj")],
  [/OpenReelAuthBroker/i, /https?:\/\//],
  "iOS online build configuration",
);

for (const path of [
  join(iosRoot, "AIWorkerConfiguration.plist"),
  join(iosRoot, "Core", "AI", "AICloudJobService.swift"),
  join(androidRoot, "app", "src", "main", "java", "com", "pythonxi", "openreelvideo", "core", "ai", "AICloudJobService.kt"),
]) {
  assert(!existsSync(path), `Legacy cloud file still exists: ${relative(root, path)}`);
}

const expectedLutSha = "35ea0282ab20cdec4a1a506f8323219c79baea6852337236c10df55a7296c137";
for (const path of [
  join(iosRoot, "Resources", "Filters", "cinematic.teal_orange.cube"),
  join(androidRoot, "app", "src", "main", "assets", "filters", "cinematic.teal_orange.cube"),
]) {
  assert(existsSync(path), `Bundled LUT missing: ${relative(root, path)}`);
  if (existsSync(path)) {
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert(digest === expectedLutSha, `Bundled LUT digest mismatch: ${relative(root, path)}`);
  }
}

const iosAudioSources = readFileSync(join(iosRoot, "Features", "Audio", "AudioSources.swift"), "utf8");
assert(iosAudioSources.includes("showsCloudItems = false"), "iOS music picker must hide cloud-only media");

if (failures.length) {
  console.error(`Mobile offline check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Mobile offline check passed (${androidFiles.length} Android and ${iosFiles.length} iOS source files scanned).`);

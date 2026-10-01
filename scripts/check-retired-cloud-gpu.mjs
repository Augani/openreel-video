import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoots = ["apps", "packages"].map((path) => join(root, path));
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set(["build", "dist", "node_modules", "out"]);
const forbidden = [
  /ai\.openreel\.video/i,
  /cloud\.openreel\.video/i,
  /\bAICloudJob\b/,
  /\bAIWorker(?:Configuration|Job|Result|Artifact)\b/,
  /\bGpuJob\b/,
  /gpu-job/i,
  /runCloudToolAction/,
  /\bisCloudEnabled\b/,
  /\bOPENREEL_(?:AI|TTS|TRANSCRIBE)_/,
];

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : walk(path);
    }
    return entry.isFile() && sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function containsAnyFile(directory) {
  if (!existsSync(directory)) return false;
  return readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const path = join(directory, entry.name);
    return entry.isFile() || (entry.isDirectory() && containsAnyFile(path));
  });
}

const failures = [];
const files = sourceRoots.flatMap(walk);
for (const file of files) {
  const contents = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(contents)) {
      failures.push(`${relative(root, file)} matches ${pattern}`);
    }
  }
}

for (const retiredDirectory of ["infra/gpu-worker", "infra/transcribe-service"]) {
  const path = join(root, retiredDirectory);
  if (existsSync(path) && statSync(path).isDirectory() && containsAnyFile(path)) {
    failures.push(`${retiredDirectory} still contains files`);
  }
}

const retiredFiles = [
  "apps/desktop/src/main/gpu/job-client.ts",
  "apps/desktop/src/main/gpu/token-provider.ts",
  "apps/web/src/services/gpu-jobs.ts",
  "apps/web/src/stores/gpu-job-store.ts",
  "packages/agent-runner/src/gpu-job-runner.ts",
  "packages/core/src/ai/cloud-job-types.ts",
];
for (const file of retiredFiles) {
  if (existsSync(join(root, file))) failures.push(`${file} still exists`);
}

if (failures.length > 0) {
  console.error("Retired cloud-GPU check failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Retired cloud-GPU check passed (${files.length} runtime source files scanned).`);

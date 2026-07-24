import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const buildDir = path.join(repoRoot, "packages", "creation-core", "build");
const outDir = path.join(repoRoot, "apps", "desktop", "resources", "aurora");

const executableName =
  process.platform === "win32"
    ? "creation_aurora_renderer.exe"
    : "creation_aurora_renderer";
const supportLibs =
  process.platform === "darwin"
    ? ["libcreation_core.dylib"]
    : process.platform === "win32"
      ? ["creation_core.dll"]
      : ["libcreation_core.so"];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const executablePath = path.join(buildDir, executableName);
  if (!(await exists(executablePath))) {
    console.log(
      `[prepare-aurora-native] skipped: ${executableName} not found in ${buildDir}`,
    );
    return;
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyFile(executablePath, path.join(outDir, executableName));

  for (const libName of supportLibs) {
    const libPath = path.join(buildDir, libName);
    if (await exists(libPath)) {
      await copyFile(libPath, path.join(outDir, libName));
    }
  }

  console.log(`[prepare-aurora-native] staged native Aurora renderer in ${outDir}`);
}

await main();

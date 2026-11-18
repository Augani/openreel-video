import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { McpFilesPlaceOutputArgs, McpFilesPlaceOutputResult } from "../../shared/onboarding";
import { resolveMcpPaths } from "./path-guard";
import { getEffectiveRoots } from "./policy";

/** Prefix of the files `fs.tempFilePath(ext, true)` hands out for exports. */
export const EXPORT_TEMP_PREFIX = "openreel-export-";

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

/**
 * Put an app temp export at its final path. The destination is re-checked here (main is the
 * enforcement point), the source must be one of our own temp exports, and the final rename is
 * atomic so a crash never leaves a half-written file under the destination name.
 */
export async function placeOutput(
  args: McpFilesPlaceOutputArgs,
  roots: readonly string[] = getEffectiveRoots(),
  tempRoot: string = tmpdir(),
): Promise<McpFilesPlaceOutputResult> {
  let source: string;
  try {
    source = await fs.realpath(args.from);
    const tempReal = await fs.realpath(tempRoot);
    if (path.dirname(source) !== tempReal || !path.basename(source).startsWith(EXPORT_TEMP_PREFIX)) {
      return { ok: false, code: "INVALID_PARAMS", message: "The source is not an OpenReel export file." };
    }
    if (!(await fs.stat(source)).isFile()) {
      return { ok: false, code: "NOT_FOUND", message: "The exported file is missing." };
    }
  } catch {
    return { ok: false, code: "NOT_FOUND", message: "The exported file is missing." };
  }

  if (args.to === undefined) {
    const stat = await fs.stat(source);
    return { ok: true, path: source, sizeBytes: stat.size, sha256: await sha256Of(source) };
  }
  // The destination must carry the same extension as the rendered file, so overwrite:true can only
  // replace files of the export's own type (never e.g. thesis.docx).
  const sourceExt = path.extname(source).toLowerCase();
  if (path.extname(args.to).toLowerCase() !== sourceExt) {
    return { ok: false, code: "INVALID_PARAMS", message: `The destination must end in ${sourceExt || "the export's extension"} to match the rendered file.` };
  }
  const resolved = await resolveMcpPaths({ paths: [args.to], mode: "write" }, { roots });
  const rejection = resolved.rejected[0];
  if (rejection) return { ok: false, code: rejection.code, message: rejection.message };
  const target = resolved.resolved[0];
  if (!target) return { ok: false, code: "INVALID_PARAMS", message: "Invalid destination path." };
  if (target.exists && args.overwrite !== true) {
    return { ok: false, code: "INVALID_PARAMS", message: `A file already exists at ${target.path}. Pass overwrite:true to replace it.` };
  }

  const staging = `${target.realPath}.${randomUUID()}.part`;
  try {
    await fs.copyFile(source, staging);
    await fs.rename(staging, target.realPath);
  } catch (error) {
    await fs.rm(staging, { force: true }).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      code: code === "EACCES" || code === "EPERM" ? "UNREADABLE" : "UNSUPPORTED",
      message: `Could not write the export to ${target.path} (${code ?? "error"}).`,
    };
  }
  const stat = await fs.stat(target.realPath);
  const sha256 = await sha256Of(target.realPath);
  if (args.move) await fs.rm(source, { force: true }).catch(() => undefined);
  return { ok: true, path: target.path, sizeBytes: stat.size, sha256 };
}


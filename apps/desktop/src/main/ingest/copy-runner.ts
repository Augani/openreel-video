import { copyIntoFolder } from "./copy-ingest";
import type { CopyJobResult, ProxyJob } from "./proxy-queue";

/** Queue worker for a copy job: a verified copy into the destination folder (never touches the source). */
export async function runCopyJob(job: ProxyJob, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<CopyJobResult> {
  const result = await copyIntoFolder({
    srcPath: job.srcPath,
    destDir: job.outDir,
    algorithm: job.copy?.algorithm ?? "sha256",
    onProgress,
    signal,
    reuseIdentical: true,
  });
  return { destPath: result.destPath, size: result.size, checksum: result.checksum, reused: Boolean(result.reused || result.alreadyInPlace) };
}

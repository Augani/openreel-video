import path from "node:path";
import { desktopProxyFileName } from "../../../../../packages/core/src/media/desktop-ingest";
import { proxyOutDir } from "./folders";
import type { ProxyJob, ProxyJobInput } from "./proxy-queue";

/**
 * The proxy job that follows a finished "copy and create proxies" copy: built from the verified copy (so the proxy
 * and the project agree on the file), written where the preset's destination says. Null when the job has no follow-up.
 */
export function copyJobFollowUpInput(job: Pick<ProxyJob, "kind" | "status" | "copyResult" | "copy" | "projectKey" | "mediaId" | "name">): ProxyJobInput | null {
  if (job.kind !== "copy" || job.status !== "done" || !job.copyResult || !job.copy?.followUp) return null;
  const { profile, previewTwin, proxyDir } = job.copy.followUp;
  const src = job.copyResult.destPath;
  const name = job.name ?? path.basename(src);
  return {
    projectKey: job.projectKey,
    mediaId: job.mediaId,
    name,
    srcPath: src,
    outDir: proxyOutDir(profile, proxyDir, src),
    fileName: desktopProxyFileName({ id: job.mediaId, name }, profile),
    profile,
    previewTwin,
  };
}

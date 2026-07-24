import { useEffect, useRef } from "react";
import { useGpuJobStore } from "../stores/gpu-job-store";
import { useProjectStore } from "../stores/project-store";
import { isDesktopGpuAvailable, isGpuAvailable, gpuBackoffMs, isTransientGpuError } from "../services/gpu-jobs";
import { getWebGpuClient } from "../services/gpu-web-client";
import { importGpuResult, importGpuStems } from "../services/gpu-result-import";
import { applyGpuDataResult } from "../services/gpu-data-import";
import { outputForKind, isMultiAssetKind } from "../components/editor/ai-panel/ai-kinds.config";
import { artifactIsAudio, isTerminalStatus, normalizeResultManifest, primaryArtifact } from "@openreel/core";

const POLL_BASE_MS = 2000;
const MAX_RETRIES = 5;
const MAX_AGE_MS = 30 * 60 * 1000;

export function useGpuJobPoller(): void {
  const jobs = useGpuJobStore((s) => s.jobs);
  const projectId = useProjectStore((s) => s.project?.id);

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isGpuAvailable()) return;

    const desktop = isDesktopGpuAvailable();
    const io = desktop
      ? {
          jobStatus: (id: string): Promise<{ status: string }> => window.openreel!.gpu.jobStatus(id),
          fetchManifest: (id: string): Promise<Record<string, unknown>> => window.openreel!.gpu.fetchManifest(id),
          download: async (id: string, rel: string): Promise<{ bytes: ArrayBuffer; mime: string }> => {
            const { tempPath, mime } = await window.openreel!.gpu.downloadArtifact(id, rel);
            const bytes = await window.openreel!.fs.readFileBytes(tempPath);
            return { bytes, mime };
          },
        }
      : {
          jobStatus: (id: string): Promise<{ status: string }> => getWebGpuClient().jobStatus(id),
          fetchManifest: (id: string): Promise<Record<string, unknown>> => getWebGpuClient().fetchManifest(id),
          download: (id: string, rel: string): Promise<{ bytes: ArrayBuffer; mime: string }> =>
            getWebGpuClient().downloadArtifact(id, rel),
        };

    const flagError = (mediaId: string): void => {
      useProjectStore.getState().setKieAIItemState(mediaId, false, true);
    };

    const schedule = (jobID: string, delay: number): void => {
      const existing = timersRef.current.get(jobID);
      if (existing) clearTimeout(existing);
      timersRef.current.set(jobID, setTimeout(() => void tick(jobID), delay));
    };

    const tick = async (jobID: string): Promise<void> => {
      timersRef.current.delete(jobID);
      if (inFlightRef.current.has(jobID)) return;

      const job = useGpuJobStore.getState().jobs.find((j) => j.jobID === jobID);
      if (!job) return;

      if (Date.now() - job.createdAt > MAX_AGE_MS) {
        useGpuJobStore.getState().markFailed(jobID);
        flagError(job.mediaId);
        return;
      }

      inFlightRef.current.add(jobID);
      try {
        const status = await io.jobStatus(jobID);

        if (status.status === "completed") {
          try {
            const rawManifest = await io.fetchManifest(jobID);
            const output = outputForKind(job.kind);
            if (output === "media") {
              const manifest = normalizeResultManifest(rawManifest);
              if (isMultiAssetKind(job.kind)) {
                const audioArts = manifest.artifacts.filter(artifactIsAudio);
                const arts = audioArts.length > 0 ? audioArts : manifest.artifacts;
                const stems: { bytes: ArrayBuffer; mime: string; relativePath: string }[] = [];
                for (const a of arts) {
                  const { bytes, mime } = await io.download(jobID, a.relativePath);
                  stems.push({ bytes, mime, relativePath: a.relativePath });
                }
                if (stems.length > 0) await importGpuStems({ job, stems });
              } else {
                const art = primaryArtifact(manifest);
                if (art) {
                  const { bytes, mime } = await io.download(jobID, art.relativePath);
                  await importGpuResult({ job, bytes, mime, relativePath: art.relativePath });
                }
              }
            } else {
              await applyGpuDataResult(output, rawManifest, job);
            }
            useGpuJobStore.getState().removeJob(jobID);
          } catch {
            useGpuJobStore.getState().markFailed(jobID);
            flagError(job.mediaId);
            useGpuJobStore.getState().removeJob(jobID);
          }
          return;
        }

        if (isTerminalStatus(status.status)) {
          useGpuJobStore.getState().markFailed(jobID);
          flagError(job.mediaId);
          useGpuJobStore.getState().removeJob(jobID);
          return;
        }

        if (job.retries > 0) useGpuJobStore.getState().resetRetries(jobID);
        schedule(jobID, POLL_BASE_MS);
      } catch (err) {
        if (isTransientGpuError(err as { status?: number })) {
          useGpuJobStore.getState().incrementRetry(jobID);
          const retries = useGpuJobStore.getState().jobs.find((j) => j.jobID === jobID)?.retries ?? MAX_RETRIES;
          if (retries >= MAX_RETRIES) {
            useGpuJobStore.getState().markFailed(jobID);
            flagError(job.mediaId);
          } else {
            schedule(jobID, gpuBackoffMs(retries));
          }
        } else {
          useGpuJobStore.getState().markFailed(jobID);
          flagError(job.mediaId);
        }
      } finally {
        inFlightRef.current.delete(jobID);
      }
    };

    const activeJobs = jobs.filter((j) => j.projectId === projectId && !j.failed);

    for (const job of activeJobs) {
      if (timersRef.current.has(job.jobID)) continue;
      if (inFlightRef.current.has(job.jobID)) continue;
      schedule(job.jobID, POLL_BASE_MS);
    }

    for (const [jobID, timer] of timersRef.current) {
      const stillActive = activeJobs.some((j) => j.jobID === jobID);
      if (!stillActive) {
        clearTimeout(timer);
        timersRef.current.delete(jobID);
      }
    }
  }, [jobs, projectId]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
}

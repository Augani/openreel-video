import type { JSX } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { useGpuJobStore } from "../../../stores/gpu-job-store";
import { useProjectStore } from "../../../stores/project-store";
import { getWebGpuClient } from "../../../services/gpu-web-client";
import { useTranslation } from "react-i18next";

export function AIJobList(): JSX.Element | null {
  const { t } = useTranslation();
  const jobs = useGpuJobStore((s) => s.jobs);
  const projectId = useProjectStore((s) => s.project?.id);
  const mine = jobs.filter((job) => job.projectId === projectId);

  if (mine.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 p-2">
      {mine.map((job) => (
        <div
          key={job.jobID}
          className="flex items-center justify-between gap-2 rounded bg-background-secondary px-3 py-2 text-[11px] border border-border"
        >
          <span className="truncate text-text-primary">{job.suggestedName}</span>
          <span className="ml-2 shrink-0 text-[10px] text-text-muted">
            {job.failed ? "Failed" : "Running…"}
          </span>
          {job.failed ? (
            <Button
              label={t("Retry")}
              variant="ghost"
              size="sm"
              className="ml-2 shrink-0 text-[10px] text-primary hover:text-primary/80"
              onClick={() => {
                useGpuJobStore.getState().retryJob(job.jobID);
                useProjectStore.getState().setKieAIItemState(job.mediaId, true, false);
              }}
            />
          ) : (
            <Button
              label={t("Cancel")}
              variant="ghost"
              size="sm"
              className="ml-2 shrink-0 text-[10px] text-text-muted hover:text-text-primary"
              onClick={() => {
                // Best-effort server cancel; the job may already be gone (404)
                // — never let that surface as an uncaught rejection.
                const cancel = window.openreel?.gpu
                  ? window.openreel.gpu.cancelJob(job.jobID)
                  : getWebGpuClient().cancelJob(job.jobID);
                void cancel.catch(() => undefined);
                useGpuJobStore.getState().removeJob(job.jobID);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

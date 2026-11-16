import React from "react";
import { Loader2, CheckCircle, XCircle, Clock } from "@/icons/lucide-compat";
import { Card, Progress, cn } from "@openreel/ui";

import {
  useProcessingStore,
  PROCESSING_TYPE_LABELS,
  type ProcessingTask,
} from "../../services/processing-manager";

const TaskItem = React.memo(function TaskItem({
  task,
}: {
  task: ProcessingTask;
}) {
  const getIcon = () => {
    switch (task.status) {
      case "queued":
        return <Clock size={14} className="text-text-muted" aria-hidden />;
      case "processing":
        return (
          <Loader2
            size={14}
            className="text-blue-400 animate-spin"
            aria-hidden
          />
        );
      case "completed":
        return <CheckCircle size={14} className="text-green-400" aria-hidden />;
      case "failed":
        return <XCircle size={14} className="text-red-400" aria-hidden />;
    }
  };

  const getStatusColor = () => {
    switch (task.status) {
      case "queued":
        return "text-text-muted";
      case "processing":
        return "text-blue-400";
      case "completed":
        return "text-green-400";
      case "failed":
        return "text-red-400";
    }
  };

  return (
    <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent text-fg p-2 flex items-center gap-3 bg-black/20">
      {getIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span
            className="text-[12px] leading-5 text-fg-2 font-bold overflow-hidden"
            style={{
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 1,
              display: "-webkit-box",
            }}
          >
            {PROCESSING_TYPE_LABELS[task.type]}
          </span>
          <span
            className={cn(
              "text-[12px] leading-5",
              "text-fg-2",
              "font-normal",
              `text-[10px] ${getStatusColor()}`,
            )}
          >
            {task.status === "processing" ? `${task.progress}%` : task.status}
          </span>
        </div>
        {task.status === "processing" && (
          <div className="mt-1">
            <Progress
              aria-label={`${PROCESSING_TYPE_LABELS[task.type]} progress`}
              value={task.progress}
              max={100}
              className="h-1.5 bg-bg-3 [&>div]:rounded-full [&>div]:bg-accent"
            />
            <span
              className="text-fg-2 font-normal block overflow-hidden mt-0.5 text-[9px]"
              style={{
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 1,
                display: "-webkit-box",
              }}
            >
              {task.message}
            </span>
          </div>
        )}
        {task.status === "failed" && task.error && (
          <span
            className="font-normal block overflow-hidden mt-0.5 text-[9px] text-red-400"
            style={{
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 1,
              display: "-webkit-box",
            }}
          >
            {task.error}
          </span>
        )}
      </div>
    </Card>
  );
});

export const ProcessingOverlay: React.FC = () => {
  const tasks = useProcessingStore((state) => state.tasks);
  const isProcessing = useProcessingStore((state) => state.isProcessing);
  const taskList = Array.from(tasks.values());
  const activeTasks = taskList.filter(
    (t) => t.status === "queued" || t.status === "processing",
  );

  if (!isProcessing || activeTasks.length === 0) {
    return null;
  }

  const progress = Math.round(
    activeTasks.reduce((sum, task) => sum + task.progress, 0) /
      activeTasks.length,
  );

  return (
    <div
      role="region"
      aria-label="Processing Effects"
      aria-busy
      className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
    >
      <Card className="min-w-0 rounded-[7px] text-fg p-6 max-w-sm w-full mx-4 bg-background-secondary/95 shadow-2xl border border-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
            <Loader2
              size={20}
              className="text-blue-400 animate-spin"
              aria-hidden
            />
          </div>
          <div>
            <h3 className="text-[12px] leading-4 text-fg-2 font-bold block">
              Processing Effects
            </h3>
            <span className="text-[12px] leading-5 text-fg-2 font-normal block">
              {activeTasks.length} task{activeTasks.length !== 1 ? "s" : ""} in
              progress
            </span>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-fg-2 font-normal text-[10px]">
              Overall Progress
            </span>
            <span className="text-fg-2 font-normal text-[10px] font-mono">
              {progress}%
            </span>
          </div>
          <Progress
            aria-label="Overall progress"
            value={progress}
            max={100}
            className="h-1.5 bg-bg-3 [&>div]:rounded-full [&>div]:bg-accent"
          />
        </div>

        <div className="max-h-48 overflow-y-auto">
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        </div>

        <span className="text-fg-2 font-normal block text-center mt-4 text-[10px]">
          Please wait while effects are being applied...
        </span>
      </Card>
    </div>
  );
};

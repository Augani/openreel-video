import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileVideo2,
  ListChecks,
  Play,
  Plus,
  Trash2,
  XCircle,
} from "@/icons/lucide-compat";
import type { MotionComposition } from "@openreel/core";
import { toast } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import {
  MOTION_EXPORT_FORMATS,
  type MotionExportRange,
  type MotionExportResolutionScale,
} from "../export-motion-frame";
import { runMotionRenderQueue } from "../render-queue-runner";
import {
  useMotionStore,
  type MotionRenderQueueFormat,
  type MotionRenderQueueItem,
  type MotionRenderQueueStatus,
} from "../stores/motion-store";
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  PanelHeader,
  Section,
  SelectInput,
} from "./primitives";
import { useTranslation } from "react-i18next";

const RESOLUTION_OPTIONS: readonly {
  readonly value: MotionExportResolutionScale;
  readonly label: string;
}[] = [
  { value: 1, label: "Full" },
  { value: 0.5, label: "Half" },
  { value: 0.25, label: "Quarter" },
];

function parseRangeSeconds(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface RenderQueuePanelProps {
  readonly composition: MotionComposition;
  readonly embedded?: boolean;
}

const WEB_EXPORT_GUARDRAIL_MESSAGE =
  "Web export can't produce ProRes or alpha — this will encode H.264 without transparency. Use the desktop app for ProRes/alpha.";

const WEB_NORMALIZED_RESULT_NOTE = "Encoded H.264 (ProRes unavailable on web)";

function detectNativeExportAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return window.openreel?.platform === "desktop";
}

function formatRequiresNativeExport(format: MotionRenderQueueFormat): boolean {
  if (format === "png-sequence") return false;
  const descriptor = MOTION_EXPORT_FORMATS.find((entry) => entry.id === format);
  if (!descriptor) return false;
  return descriptor.transparent || descriptor.extension === "mov";
}

const STATUS_META: Record<
  MotionRenderQueueStatus,
  { readonly label: string; readonly className: string; readonly icon: typeof Clock3 }
> = {
  queued: {
    label: "Queued",
    className: "border-border bg-bg-1 text-fg-muted",
    icon: Clock3,
  },
  rendering: {
    label: "Rendering",
    className: "border-accent/40 bg-accent-soft text-accent",
    icon: Play,
  },
  complete: {
    label: "Complete",
    className: "border-status-success/40 bg-status-success/15 text-status-success",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "border-status-error/40 bg-status-error/15 text-status-error",
    icon: XCircle,
  },
  canceled: {
    label: "Canceled",
    className: "border-border bg-bg-1 text-fg-muted",
    icon: XCircle,
  },
};

export function RenderQueuePanel({
  composition,
  embedded = false,
}: RenderQueuePanelProps): JSX.Element {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [selectedFormat, setSelectedFormat] =
    useState<MotionRenderQueueFormat>("mp4");
  const [resolutionScale, setResolutionScale] =
    useState<MotionExportResolutionScale>(1);
  const [rangeStart, setRangeStart] = useState("0");
  const [rangeEnd, setRangeEnd] = useState(
    () => `${composition.duration}`,
  );
  const [h264FallbackAcknowledged, setH264FallbackAcknowledged] =
    useState(false);
  const isNativeExportAvailable = useMemo(detectNativeExportAvailable, []);
  const requiresNativeExport = formatRequiresNativeExport(selectedFormat);
  const guardrailActive = requiresNativeExport && !isNativeExportAvailable;
  const guardrailBlocking = guardrailActive && !h264FallbackAcknowledged;

  useEffect(() => {
    if (!guardrailActive) {
      setH264FallbackAcknowledged(false);
    }
  }, [guardrailActive]);

  useEffect(() => {
    setH264FallbackAcknowledged(false);
  }, [selectedFormat]);

  const project = useProjectStore((state) => state.project);
  const renderQueue = useMotionStore((state) => state.renderQueue);
  const addRenderQueueItem = useMotionStore((state) => state.addRenderQueueItem);
  const removeRenderQueueItem = useMotionStore(
    (state) => state.removeRenderQueueItem,
  );
  const moveRenderQueueItem = useMotionStore(
    (state) => state.moveRenderQueueItem,
  );
  const cancelRenderQueueItem = useMotionStore(
    (state) => state.cancelRenderQueueItem,
  );
  const clearRenderQueue = useMotionStore((state) => state.clearRenderQueue);
  const clearCompletedRenderQueueItems = useMotionStore(
    (state) => state.clearCompletedRenderQueueItems,
  );
  const compositions = project.motionCompositions ?? [];
  const runnableCount = renderQueue.filter(isRunnableQueueItem).length;

  const resolveRange = (
    scene: MotionComposition,
  ): MotionExportRange | null => {
    const start = parseRangeSeconds(rangeStart);
    const end = parseRangeSeconds(rangeEnd);
    if (start === null || end === null) return null;
    const clampedStart = Math.min(Math.max(start, 0), scene.duration);
    const clampedEnd = Math.min(Math.max(end, 0), scene.duration);
    if (!(clampedStart < clampedEnd)) return null;
    return { startTime: clampedStart, endTime: clampedEnd };
  };

  const addComposition = (scene: MotionComposition) => {
    const range = resolveRange(scene);
    if (range === null) {
      toast.error(
        "Invalid render range",
        "Range start must be before end and within the composition.",
      );
      return;
    }
    addRenderQueueItem({
      compositionId: scene.id,
      name: scene.name,
      width: scene.width,
      height: scene.height,
      frameRate: scene.frameRate,
      duration: scene.duration,
      format: selectedFormat,
      range,
      resolutionScale,
    });
  };

  const addAllScenes = () => {
    for (const scene of compositions) {
      addComposition(scene);
    }
  };

  const runQueue = async () => {
    if (isRunning || runnableCount === 0 || guardrailBlocking) return;
    setIsRunning(true);
    try {
      const result = await runMotionRenderQueue({ project, compositions });
      if (result.alreadyRunning) {
        toast.error(
          "Render queue already running",
          "Wait for the current run to finish before starting another.",
        );
        return;
      }
      toast.success(
        "Render queue finished",
        `${result.outcomes.length} job(s) processed.`,
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : (
        <PanelHeader
          title={t("Render Queue")}
          icon={ListChecks}
          actions={
            <>
              <IconButton
                icon={Play}
                label={t("Start render queue")}
                size="sm"
                variant="solid"
                disabled={isRunning || runnableCount === 0 || guardrailBlocking}
                onClick={runQueue}
              />
              <IconButton
                icon={Trash2}
                label={t("Clear render queue")}
                size="sm"
                variant="danger"
                disabled={isRunning || renderQueue.length === 0}
                onClick={clearRenderQueue}
              />
            </>
          }
        />
      )}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title={t("Queue Controls")} icon={FileVideo2}>
          <Button
            label={isRunning ? t("Rendering…") : t("Start render queue")}
            icon={Play}
            variant="solid"
            disabled={isRunning || runnableCount === 0 || guardrailBlocking}
            onClick={runQueue}
            className="w-full justify-center"
          />
          <Field label={t("Output format")}>
            <SelectInput
              value={selectedFormat}
              placeholder={t("Output format")}
              disabled={isRunning}
              options={MOTION_EXPORT_FORMATS.map((entry) => ({
                value: entry.id,
                label: `${entry.label}${entry.transparent ? " · alpha" : ""}`,
              }))}
              onChange={(format) => {
                if (format === "") return;
                setSelectedFormat(format as MotionRenderQueueFormat);
              }}
            />
          </Field>
          <Field label={t("Resolution")}>
            <div className="flex gap-1" role="group" aria-label={t("Resolution")}>
              {RESOLUTION_OPTIONS.map((option) => {
                const active = resolutionScale === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={`Resolution ${option.label}`}
                    aria-pressed={active}
                    disabled={isRunning}
                    onClick={() => setResolutionScale(option.value)}
                    className={`flex-1 rounded-[7px] border px-2 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                      active
                        ? "border-accent/40 bg-accent-soft text-accent"
                        : "border-border bg-bg-1 text-fg-muted"
                    }`}
                  >
                    {t(option.label)}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("Range start (s)")}>
              <input
                type="number"
                aria-label={t("Range start")}
                min={0}
                step={0.1}
                value={rangeStart}
                disabled={isRunning}
                onChange={(event) => setRangeStart(event.target.value)}
                className="w-full rounded-[7px] border border-border bg-bg-1 px-[10px] py-2 text-[13px] font-medium text-fg-2 outline-none disabled:opacity-50"
              />
            </Field>
            <Field label={t("Range end (s)")}>
              <input
                type="number"
                aria-label={t("Range end")}
                min={0}
                step={0.1}
                value={rangeEnd}
                disabled={isRunning}
                onChange={(event) => setRangeEnd(event.target.value)}
                className="w-full rounded-[7px] border border-border bg-bg-1 px-[10px] py-2 text-[13px] font-medium text-fg-2 outline-none disabled:opacity-50"
              />
            </Field>
          </div>
          {guardrailActive ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5"
            >
              <span className="flex items-start gap-2 text-[11px] leading-snug text-status-warning">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {WEB_EXPORT_GUARDRAIL_MESSAGE}
              </span>
              {h264FallbackAcknowledged ? (
                <span className="text-[10.5px] text-fg-muted">
                  {t("Will encode H.264 without transparency.")}</span>
              ) : (
                <Button
                  label={t("Export as H.264 anyway")}
                  variant="outline"
                  disabled={isRunning}
                  onClick={() => setH264FallbackAcknowledged(true)}
                  className="w-full justify-center"
                />
              )}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button
              label={t("Current")}
              icon={Plus}
              disabled={isRunning}
              onClick={() => addComposition(composition)}
            />
            <Button
              label={t("All Scenes")}
              icon={Plus}
              disabled={isRunning || compositions.length === 0}
              onClick={addAllScenes}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              label={t("Clear completed")}
              disabled={isRunning || renderQueue.length === 0}
              onClick={clearCompletedRenderQueueItems}
            />
            <Button
              label={t("Clear queue")}
              icon={Trash2}
              variant="danger"
              disabled={isRunning || renderQueue.length === 0}
              onClick={clearRenderQueue}
            />
          </div>
        </Section>

        <Section title={`Jobs · ${renderQueue.length}`} icon={ListChecks}>
          {renderQueue.length === 0 ? (
            <EmptyState
              icon={FileVideo2}
              title={t("Queue is empty")}
              description={t("Add motion scenes here for sequential MP4 rendering.")}
            />
          ) : (
            <div className="space-y-2">
              {renderQueue.map((item, index) => (
                <RenderQueueRow
                  key={item.id}
                  item={item}
                  nativeExportAvailable={isNativeExportAvailable}
                  disabled={isRunning && item.status === "rendering"}
                  canMoveUp={index > 0}
                  canMoveDown={index < renderQueue.length - 1}
                  onRemove={() => removeRenderQueueItem(item.id)}
                  onCancel={() => cancelRenderQueueItem(item.id)}
                  onMoveUp={() => moveRenderQueueItem(item.id, "up")}
                  onMoveDown={() => moveRenderQueueItem(item.id, "down")}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function RenderQueueRow({
  item,
  nativeExportAvailable,
  disabled,
  canMoveUp,
  canMoveDown,
  onRemove,
  onCancel,
  onMoveUp,
  onMoveDown,
}: {
  readonly item: MotionRenderQueueItem;
  readonly nativeExportAvailable: boolean;
  readonly disabled: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const status = STATUS_META[item.status];
  const StatusIcon = status.icon;
  const isRunning = item.status === "rendering";
  const isCancelable = item.status === "queued" || item.status === "rendering";
  const wasNormalizedToH264 =
    item.status === "complete" &&
    !nativeExportAvailable &&
    formatRequiresNativeExport(item.format);
  const resultDetail = item.error
    ? item.error
    : wasNormalizedToH264
      ? WEB_NORMALIZED_RESULT_NOTE
      : (item.outputFilename ?? `${item.progress}%`);
  return (
    <div className="rounded-md border border-border bg-bg-2 p-2.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-fg-2">
            {item.name}
          </span>
          <span className="mt-0.5 block text-[10.5px] tabular-nums text-fg-muted">
            {item.width}×{item.height} · {item.frameRate} {t(" fps ·")}{" "}
            {item.duration.toFixed(1)}{t("s ·")}{" "}
            {MOTION_EXPORT_FORMATS.find((entry) => entry.id === item.format)
              ?.label ?? item.format}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <IconButton
            icon={ChevronUp}
            label={t("Move render job up")}
            size="sm"
            variant="ghost"
            disabled={isRunning || !canMoveUp}
            onClick={onMoveUp}
          />
          <IconButton
            icon={ChevronDown}
            label={t("Move render job down")}
            size="sm"
            variant="ghost"
            disabled={isRunning || !canMoveDown}
            onClick={onMoveDown}
          />
          {isCancelable ? (
            <IconButton
              icon={XCircle}
              label={t("Cancel render job")}
              size="sm"
              variant="danger"
              disabled={item.cancelRequested === true}
              onClick={onCancel}
            />
          ) : null}
          <IconButton
            icon={Trash2}
            label={t("Remove render job")}
            size="sm"
            variant="danger"
            disabled={disabled}
            onClick={onRemove}
          />
        </span>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-bg-1">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${status.className}`}
        >
          <StatusIcon size={11} />
          {t(status.label)}
        </span>
        <span className="min-w-0 truncate text-right text-[10.5px] text-fg-muted">
          {resultDetail}
        </span>
      </div>
    </div>
  );
}

function isRunnableQueueItem(item: MotionRenderQueueItem): boolean {
  return item.status === "queued" || item.status === "failed";
}

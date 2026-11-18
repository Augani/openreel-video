import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EffectLivePreview,
  EffectPreviewProvider,
  useLivePreviewActivity,
} from "../panels/effect-previews/EffectLivePreview";
import { motionPreviewDef, type MotionPreviewTarget } from "../panels/effect-previews/kind-defs";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@openreel/ui";
import {
  ArrowRight,
  ArrowLeft,
  Zap,
  RefreshCw,
  Check,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { toast } from "../../../stores/notification-store";
import {
  getPresetLibrary,
  type MotionPreset,
  type PresetCategory,
} from "../../../services/motion-presets";
import {
  applyMotionPreset,
  boundedMotionPresetDuration,
  MOTION_PRESET_PREFIX,
  removeMotionPresetCategory,
  resolveMotionPresetTarget,
  type MotionPresetScope,
  type MotionPresetTarget,
} from "../../../services/motion-preset-application";

const CATEGORY_CONFIG = [
  { id: "entrance", name: "In", icon: ArrowRight },
  { id: "exit", name: "Out", icon: ArrowLeft },
  { id: "emphasis", name: "Emphasis", icon: Zap },
  { id: "transition", name: "Transition", icon: RefreshCw },
] as const;

const PresetCard = memo(function PresetCard({
  preset,
  duration,
  target,
  isApplied,
  disabled,
  onApply,
}: {
  preset: MotionPreset;
  duration: number;
  target: MotionPreviewTarget;
  isApplied: boolean;
  disabled: boolean;
  onApply: (preset: MotionPreset) => void;
}) {
  const { active, handlers } = useLivePreviewActivity();
  const def = useMemo(() => motionPreviewDef(preset, duration, target), [preset, duration, target]);
  return (
    <Button
      variant="ghost"
      type="button"
      disabled={disabled}
      aria-label={`Apply ${preset.name}`}
      aria-pressed={isApplied}
      onClick={() => onApply(preset)}
      {...handlers}
      className={cn(
        "group/card relative block h-auto min-w-0 overflow-hidden whitespace-normal rounded-[7px] border bg-bg-2 p-0 text-left hover:border-primary/50",
        isApplied ? "border-primary bg-primary/10" : "border-border",
      )}
    >
      <div
        data-motion-preview={preset.id}
        className="relative aspect-video overflow-hidden bg-bg-3"
      >
        <EffectLivePreview def={def} active={active} />
        {isApplied ? (
          <Check
            size={14}
            aria-hidden
            className="absolute right-2 top-2 text-primary"
          />
        ) : (
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-medium text-white opacity-0 group-hover/card:opacity-100">
            Apply
          </span>
        )}
      </div>
      <div className="p-2">
        <span className="block truncate text-[10px] font-medium text-fg">
          {preset.name}
        </span>
        <span className="text-[8px] font-normal text-fg-2">
          {Number(duration.toFixed(2))}s
        </span>
      </div>
    </Button>
  );
});

interface MotionPresetsPanelProps {
  clipId?: string;
}

export const MotionPresetsPanel: React.FC<MotionPresetsPanelProps> = ({
  clipId,
}) => {
  const selectedId = useUIStore((state) =>
    clipId ? undefined : state.getSelectedClipIds()[0],
  );
  const targetId = clipId || selectedId;
  const clip = useProjectStore(
    useCallback(
      (state) =>
        targetId
          ? (resolveMotionPresetTarget(state.project, targetId)?.data ?? null)
          : null,
      [targetId],
    ),
  );
  const projectId = useProjectStore((state) => state.project.id);
  const executor = useProjectStore((state) => state.actionExecutor);
  const hasOpenProject = useProjectStore((state) => state.hasOpenProject);
  const locked = useProjectStore(
    useCallback(
      (state) =>
        !state.project.timeline.tracks.some(
          (track) => track.id === clip?.trackId && !track.locked,
        ),
      [clip?.trackId],
    ),
  );
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const processing = useUIStore(
    (state) => state.effectApplicationClipId !== null,
  );
  const playbackLocked = useTimelineStore(
    (state) => !!state.playbackLockedReason,
  );
  const session = useMemo(
    () => ({
      key: crypto.randomUUID(),
      scope: { projectId, executor, clipId: targetId ?? "" },
    }),
    [projectId, executor, targetId],
  );
  if (!targetId || !clip)
    return (
      <div className="p-4 text-center">
        <Zap size={24} aria-hidden className="mx-auto mb-2 text-fg-3" />
        <span className="text-[10px] font-normal text-fg-2">
          {targetId
            ? "Clip not found"
            : "Select a clip to apply motion presets"}
        </span>
      </div>
    );
  return (
    <MotionPresetControls
      key={session.key}
      scope={session.scope}
      clip={clip}
      disabled={
        !hasOpenProject ||
        locked ||
        exporting ||
        processing ||
        playbackLocked ||
        !Number.isFinite(clip.duration) ||
        clip.duration <= 0
      }
    />
  );
};

function MotionPresetControls({
  scope,
  clip,
  disabled,
}: {
  scope: MotionPresetScope;
  clip: MotionPresetTarget;
  disabled: boolean;
}) {
  const library = useMemo(() => getPresetLibrary(), []);
  // The clip the presets would be applied to, and the canvas their slide offsets are measured against: what "apply" uses.
  const targetKind = useProjectStore(
    (state) => resolveMotionPresetTarget(state.project, scope.clipId)?.kind ?? "regular",
  );
  const canvasWidth = useProjectStore((state) => state.project.settings.width);
  const canvasHeight = useProjectStore((state) => state.project.settings.height);
  const previewTarget = useMemo<MotionPreviewTarget>(
    () => ({
      transform: clip.transform,
      clipDuration: clip.duration,
      kind: targetKind,
      canvas: { width: Math.max(1, canvasWidth), height: Math.max(1, canvasHeight) },
    }),
    [clip.transform, clip.duration, targetKind, canvasWidth, canvasHeight],
  );
  const [category, setCategory] = useState<PresetCategory>("entrance");
  const [durations, setDurations] = useState<
    Partial<Record<PresetCategory, number>>
  >({});
  const [lastApplied, setLastApplied] = useState<
    Partial<Record<PresetCategory, string>>
  >({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const pending = useRef<{
    preset: MotionPreset;
    duration: number;
    target: MotionPresetTarget;
  } | null>(null);
  const presets = useMemo(() => library[category] ?? [], [library, category]);
  const defaultDuration = boundedMotionPresetDuration(
    undefined,
    presets[0]?.duration ?? 0.5,
    clip.duration,
  );
  const duration = boundedMotionPresetDuration(
    durations[category],
    defaultDuration,
    clip.duration,
  );
  const maximum = Number.isFinite(clip.duration)
    ? Math.max(0, clip.duration)
    : 0;
  const minimum = Math.min(0.05, maximum);
  const applied = useMemo(
    () =>
      Object.fromEntries(
        CATEGORY_CONFIG.map((item) => [
          item.id,
          (clip.keyframes ?? []).some((key) =>
            key.id.startsWith(MOTION_PRESET_PREFIX[item.id]),
          ),
        ]),
      ) as Record<PresetCategory, boolean>,
    [clip.keyframes],
  );
  const cancelPending = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelPending();
    };
  }, [cancelPending]);
  useEffect(() => {
    if (disabled) cancelPending();
  }, [cancelPending, disabled]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const flush = useCallback(() => {
    const next = pending.current;
    cancelPending();
    if (
      !mounted.current ||
      !next ||
      disabled ||
      clipRef.current !== next.target
    )
      return;
    applyMotionPreset(scope, next.preset, next.duration);
  }, [cancelPending, disabled, scope]);
  const changeDuration = useCallback(
    (value: number, commit = false) => {
      if (!mounted.current || disabled) return;
      const next = boundedMotionPresetDuration(
        value,
        defaultDuration,
        clip.duration,
      );
      setDurations((current) => ({ ...current, [category]: next }));
      cancelPending();
      const preset = presets.find((item) => item.id === lastApplied[category]);
      if (!preset || !applied[category]) return;
      pending.current = { preset, duration: next, target: clip };
      if (commit) flush();
      else timer.current = setTimeout(flush, 160);
    },
    [
      disabled,
      defaultDuration,
      clip,
      category,
      cancelPending,
      presets,
      lastApplied,
      applied,
      flush,
    ],
  );
  const apply = useCallback(
    (preset: MotionPreset) => {
      cancelPending();
      if (
        !mounted.current ||
        disabled ||
        !applyMotionPreset(scope, preset, durations[preset.category])
      )
        return;
      setLastApplied((current) => ({
        ...current,
        [preset.category]: preset.id,
      }));
      toast.success("Motion Preset Applied", `${preset.name} added to clip`);
    },
    [cancelPending, disabled, scope, durations],
  );
  const remove = (selected: PresetCategory) => {
    cancelPending();
    if (
      !mounted.current ||
      disabled ||
      !removeMotionPresetCategory(scope, selected)
    )
      return;
    setLastApplied((current) => ({ ...current, [selected]: undefined }));
    toast.info("Preset Removed");
  };
  const commitDraft = () => {
    const match = draft.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*s?$/i);
    if (match && Number.isFinite(Number(match[1])))
      changeDuration(
        Number(
          (
            minimum +
            Math.round((Number(match[1]) - minimum) / 0.05) * 0.05
          ).toFixed(6),
        ),
        true,
      );
    setEditing(false);
  };
  return (
    <EffectPreviewProvider>
    <div className="space-y-4">
      {CATEGORY_CONFIG.some((item) => applied[item.id]) && (
        <Card className="space-y-1 rounded-[7px] border-border bg-bg-2 p-2 shadow-none">
          <span className="text-[10px] font-medium text-fg-2">
            Applied Animations
          </span>
          <div className="flex flex-wrap gap-1">
            {CATEGORY_CONFIG.filter((item) => applied[item.id]).map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                aria-label={`Remove ${item.id} presets`}
                onClick={() => remove(item.id)}
                className="h-6 gap-1 px-2 text-[9px]"
              >
                <item.icon size={10} aria-hidden />
                {item.name} ×
              </Button>
            ))}
          </div>
        </Card>
      )}
      <Tabs
        value={category}
        onValueChange={(value) => {
          if (!CATEGORY_CONFIG.some((item) => item.id === value)) return;
          cancelPending();
          setEditing(false);
          setCategory(value as PresetCategory);
        }}
      >
        <TabsList
          aria-label="Motion preset categories"
          className="grid h-8 w-full grid-cols-4 gap-0 p-0.5"
        >
          {CATEGORY_CONFIG.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="relative min-w-0 gap-1 px-1 text-[10px]"
            >
              <item.icon size={11} aria-hidden />
              <span>{item.name}</span>
              {applied[item.id] && <span className="sr-only"> applied</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        <Card className="mt-3 space-y-2 rounded-[7px] border-border bg-bg-2 p-2 shadow-none">
          <div className="flex items-center justify-between gap-3">
            <Label
              htmlFor="motion-preset-duration"
              className="text-[11px] font-medium text-text-secondary"
            >
              Duration
            </Label>
            <span
              className="inline-grid h-5 min-w-[4ch] place-items-center"
              onDoubleClick={() => {
                if (!disabled) {
                  cancelPending();
                  setEditing(false);
                  changeDuration(defaultDuration, true);
                }
              }}
            >
              {editing ? (
                <Input
                  ref={inputRef}
                  value={draft}
                  disabled={disabled}
                  aria-label="Motion preset duration value"
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitDraft();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditing(false);
                    } else if (
                      event.key === "ArrowUp" ||
                      event.key === "ArrowDown"
                    ) {
                      event.preventDefault();
                      const value = Number.parseFloat(draft);
                      setDraft(
                        `${boundedMotionPresetDuration((Number.isFinite(value) ? value : duration) + (event.key === "ArrowUp" ? 0.05 : -0.05), defaultDuration, clip.duration).toFixed(2)}s`,
                      );
                    }
                  }}
                  className="h-5 w-14 min-w-0 px-1 py-0 text-right font-mono text-[11px] md:text-[11px]"
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label="Edit Motion preset duration value"
                  title="Click to edit, double-click to reset"
                  onClick={() => {
                    setDraft(`${Number(duration.toFixed(2))}s`);
                    setEditing(true);
                  }}
                  className="h-5 min-w-[4ch] justify-end rounded px-1 py-0 font-mono text-[11px] font-normal text-text-muted"
                >
                  {Number(duration.toFixed(2))}s
                </Button>
              )}
            </span>
          </div>
          <Slider
            id="motion-preset-duration"
            aria-label="Motion preset duration"
            aria-valuetext={`${Number(duration.toFixed(2))} seconds`}
            value={[duration]}
            min={minimum}
            max={maximum}
            step={0.05}
            disabled={disabled}
            onValueChange={([value]) => changeDuration(value)}
            onValueCommit={([value]) => changeDuration(value, true)}
            className="h-2"
          />
          <span className="text-[9px] font-normal text-fg-2">
            Sets how long {category} presets run. The last applied preset
            updates after you stop dragging.
          </span>
        </Card>
        <TabsContent value={category} className="mt-3 space-y-3">
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                duration={boundedMotionPresetDuration(
                  durations[preset.category],
                  preset.duration,
                  clip.duration,
                )}
                target={previewTarget}
                isApplied={
                  applied[preset.category] &&
                  lastApplied[preset.category] === preset.id
                }
                disabled={disabled}
                onApply={apply}
              />
            ))}
          </div>
          <Badge variant="secondary" className="text-[9px] font-normal">
            {presets.length} presets in {category}
          </Badge>
        </TabsContent>
      </Tabs>
    </div>
    </EffectPreviewProvider>
  );
}


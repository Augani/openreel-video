import type { ActionExecutorLike } from "../../../services/lazy-action-executor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, LoaderCircle, Volume2, Wand2 } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@openreel/ui";
import type { Effect } from "@openreel/core";
import {
  DEFAULT_NOISE_REDUCTION,
  type NoiseReductionConfig,
  type NoiseReductionFocus,
} from "../../../bridges/audio-bridge-effects";
import { useProjectStore } from "../../../stores/project-store";
import {
  analyzeNoiseSource,
  noiseAnalysisSignature,
} from "../../../services/noise-reduction-analysis";
import {
  editNoiseReduction,
  findNoiseTarget,
  ownsNoiseScope,
  type NoiseReductionScope,
} from "../../../services/noise-reduction-edit";
import {
  NOISE_REDUCTION_PRESETS,
  getNoiseReductionPreset,
  suggestNoiseReductionConfig,
  suggestNoiseReductionPreset,
} from "./noise-reduction-presets";
import { PropertySlider } from "./shell/PropertySlider";
const EMPTY_EFFECTS: Effect[] = [];
const executorIds = new WeakMap<ActionExecutorLike, number>();
let nextExecutorId = 0;
function executorId(executor: ActionExecutorLike) {
  let id = executorIds.get(executor);
  if (!id) {
    id = ++nextExecutorId;
    executorIds.set(executor, id);
  }
  return id;
}
type LearningState =
  | "idle"
  | "learning"
  | "applying"
  | "ready"
  | "success"
  | "error";
interface AnalysisOwner {
  scope: NoiseReductionScope;
  signature: string;
  effect: Effect | undefined;
  controller: AbortController;
}
interface Recommendation {
  owner: AnalysisOwner;
  presetId: NoiseReductionFocus;
  config: NoiseReductionConfig;
  hasLearnedProfile: boolean;
}
function currentEffect(scope: NoiseReductionScope) {
  return findNoiseTarget(
    useProjectStore.getState().project,
    scope.clipId,
  )?.audioEffects.find((effect) => effect.type === "noiseReduction");
}
function ownsAnalysis(owner: AnalysisOwner) {
  return (
    !owner.controller.signal.aborted &&
    ownsNoiseScope(owner.scope) &&
    currentEffect(owner.scope) === owner.effect &&
    noiseAnalysisSignature(
      useProjectStore.getState().project,
      owner.scope.clipId,
    ) === owner.signature
  );
}
export function NoiseReductionSection({ clipId }: { clipId: string }) {
  const projectId = useProjectStore((state) => state.project.id),
    executor = useProjectStore((state) => state.actionExecutor);
  const targetId = useProjectStore(
    (state) => findNoiseTarget(state.project, clipId)?.id ?? clipId,
  );
  const scope = useMemo(
    () => ({ projectId, executor, clipId: targetId }),
    [projectId, executor, targetId],
  );
  return (
    <NoiseReductionControls
      key={`${projectId}:${executorId(executor)}:${targetId}`}
      scope={scope}
    />
  );
}
function NoiseReductionControls({ scope }: { scope: NoiseReductionScope }) {
  const effects = useProjectStore(
    (state) =>
      findNoiseTarget(state.project, scope.clipId)?.audioEffects ??
      EMPTY_EFFECTS,
  );
  const activeEffect = effects.find(
    (effect) => effect.type === "noiseReduction",
  );
  const [draft, setDraft] = useState<NoiseReductionConfig>(
    DEFAULT_NOISE_REDUCTION,
  );
  const config = useMemo(
    () =>
      activeEffect
        ? ({
            ...DEFAULT_NOISE_REDUCTION,
            ...activeEffect.params,
          } as NoiseReductionConfig)
        : draft,
    [activeEffect, draft],
  );
  const enabled = activeEffect?.enabled ?? false,
    previewingOriginal = activeEffect?.metadata?.previewBypass === true;
  const activePreset = getNoiseReductionPreset(config.focus ?? "balanced");
  const [open, setOpen] = useState(true),
    [state, setState] = useState<LearningState>("idle");
  const [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    progress: number;
    message: string;
  } | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const job = useRef<AnalysisOwner | null>(null),
    recommendationRef = useRef<Recommendation | null>(null);
  const completion = useRef<{
    scope: NoiseReductionScope;
    effect: Effect | undefined;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    generation = useRef(0);
  const busy = state === "learning" || state === "applying";
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const clearRecommendation = () => {
    recommendationRef.current = null;
    setRecommendation(null);
  };
  const cancel = useCallback(() => {
    job.current?.controller.abort();
    job.current = null;
    generation.current++;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    recommendationRef.current = null;
    completion.current = null;
    setRecommendation(null);
    setProgress(null);
    setState("idle");
    setError(null);
    setMessage(null);
  }, []);
  useEffect(() => {
    const lifecycleGeneration = generation;
    const unsubscribe = useProjectStore.subscribe(() => {
      const owner = job.current ?? recommendationRef.current?.owner;
      const completed = completion.current;
      if (
        (owner && !ownsAnalysis(owner)) ||
        (completed &&
          (!ownsNoiseScope(completed.scope) ||
            currentEffect(completed.scope) !== completed.effect))
      )
        cancel();
    });
    return () => {
      unsubscribe();
      job.current?.controller.abort();
      job.current = null;
      completion.current = null;
      lifecycleGeneration.current++;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [cancel]);
  const success = (text: string) => {
    completion.current = { scope, effect: currentEffect(scope) };
    setProgress(null);
    setMessage(text);
    setState("success");
    const version = ++generation.current;
    clearTimer();
    timer.current = setTimeout(() => {
      if (version === generation.current && ownsNoiseScope(scope))
        setState("idle");
      timer.current = null;
    }, 2000);
  };
  const apply = (changes: Parameters<typeof editNoiseReduction>[1]) => {
    const effect = editNoiseReduction(scope, changes);
    if (!effect)
      throw new Error(
        "Unlock this clip and finish any active export before changing cleanup.",
      );
    return effect;
  };
  const begin = (): AnalysisOwner | null => {
    if (job.current || !ownsNoiseScope(scope)) return null;
    clearTimer();
    clearRecommendation();
    completion.current = null;
    setError(null);
    setMessage(null);
    generation.current++;
    const project = useProjectStore.getState().project;
    const owner = {
      scope,
      signature: noiseAnalysisSignature(project, scope.clipId),
      effect: currentEffect(scope),
      controller: new AbortController(),
    };
    job.current = owner;
    return owner;
  };
  const updateProgress = (
    owner: AnalysisOwner,
    value: { progress: number; message: string },
  ) => {
    if (job.current !== owner || !ownsAnalysis(owner)) return;
    setProgress((previous) =>
      previous?.progress === value.progress &&
      previous.message === value.message
        ? previous
        : value,
    );
  };
  const learn = async (presetId?: NoiseReductionFocus) => {
    if (job.current) return;
    let presetConfig: NoiseReductionConfig | undefined;
    if (presetId) {
      try {
        presetConfig = {
          ...getNoiseReductionPreset(presetId).config,
          ...(config.profile ? { profile: config.profile } : {}),
        };
        apply({ config: presetConfig, enabled: true, previewBypass: false });
      } catch (value) {
        setError(
          value instanceof Error ? value.message : "Could not apply cleanup",
        );
        setState("error");
        return;
      }
    }
    const owner = begin();
    if (!owner) return;
    setState(presetId ? "applying" : "learning");
    setProgress({ progress: 0.02, message: "Preparing clip analysis" });
    try {
      const result = await analyzeNoiseSource(
        useProjectStore.getState().project,
        scope.clipId,
        owner.controller.signal,
        (value) => updateProgress(owner, value),
      );
      if (job.current !== owner || !ownsAnalysis(owner)) return;
      job.current = null;
      if (presetId && presetConfig) {
        let learnedApplied = false;
        if (result.learnedProfile) {
          try {
            apply({
              config: {
                ...getNoiseReductionPreset(presetId).config,
                profile: result.learnedProfile.serializedProfile,
              },
              enabled: true,
              previewBypass: false,
            });
            learnedApplied = true;
          } catch {
            // A new export or lock can block learning after the preset was applied.
          }
        }
        success(
          `${getNoiseReductionPreset(presetId).label}${learnedApplied ? " learned and" : ""} applied to this clip.`,
        );
      } else {
        const next = {
          owner,
          presetId: suggestNoiseReductionPreset(result.recommendationProfile),
          config: {
            ...suggestNoiseReductionConfig(result.recommendationProfile),
            ...(result.learnedProfile
              ? { profile: result.learnedProfile.serializedProfile }
              : {}),
          },
          hasLearnedProfile: !!result.learnedProfile,
        };
        recommendationRef.current = next;
        setRecommendation(next);
        setProgress(null);
        setState("ready");
      }
    } catch (value) {
      if (job.current !== owner || !ownsAnalysis(owner)) return;
      job.current = null;
      setProgress(null);
      if (presetId) {
        success(
          `${getNoiseReductionPreset(presetId).label} applied to this clip.`,
        );
        return;
      }
      setState("error");
      setError(
        value instanceof Error ? value.message : "Failed to analyze this clip",
      );
      const version = ++generation.current;
      clearTimer();
      timer.current = setTimeout(() => {
        if (version === generation.current && ownsNoiseScope(scope)) {
          setState("idle");
          setError(null);
        }
        timer.current = null;
      }, 3000);
    }
  };
  const change = (key: keyof NoiseReductionConfig, value: number) => {
    const next = { ...config, [key]: value };
    try {
      if (activeEffect) apply({ config: next });
      else setDraft(next);
      setError(null);
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Could not update cleanup",
      );
    }
  };
  const applyRecommendation = () => {
    if (!recommendation || !ownsAnalysis(recommendation.owner)) {
      cancel();
      setError("The audio source changed. Analyze this clip again.");
      return;
    }
    const next = recommendation;
    clearRecommendation();
    try {
      apply({ config: next.config, enabled: true, previewBypass: false });
      success(
        `${getNoiseReductionPreset(next.presetId).label} applied to this clip.`,
      );
    } catch (value) {
      if (ownsAnalysis(next.owner)) {
        recommendationRef.current = next;
        setRecommendation(next);
      }
      setState("error");
      setError(
        value instanceof Error ? value.message : "Could not apply cleanup",
      );
    }
  };
  const preview = (value: string) => {
    try {
      apply({ previewBypass: value === "original" });
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Could not change preview",
      );
    }
  };
  const recommendationPreset = recommendation
    ? getNoiseReductionPreset(recommendation.presetId)
    : null;
  const buttonLabel =
    state === "learning"
      ? "Analyzing…"
      : state === "applying"
        ? "Applying cleanup…"
        : state === "ready"
          ? "Recommendation Ready"
          : state === "success"
            ? "Cleanup Applied"
            : state === "error"
              ? "Analysis Failed"
              : "Analyze & Recommend";
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="min-w-0 overflow-hidden rounded-[7px] border-border bg-bg-2 p-0 shadow-none">
        <div className="flex items-center gap-3 px-3 py-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start gap-1.5 p-0 text-[11px] font-medium hover:bg-transparent"
              aria-label={`${open ? "Collapse" : "Expand"} noise reduction`}
            >
              <ChevronDown
                className={`size-3 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
              />
              <Volume2 className="size-3 shrink-0 text-fg-3" />
              Noise Reduction
            </Button>
          </CollapsibleTrigger>
          <Switch
            className="workspace-switch"
            aria-label="Enable noise reduction"
            checked={enabled}
            disabled={busy}
            onCheckedChange={(checked) => {
              try {
                apply(
                  activeEffect
                    ? { enabled: checked }
                    : { config, enabled: checked, previewBypass: false },
                );
              } catch (value) {
                setError(
                  value instanceof Error
                    ? value.message
                    : "Could not change cleanup",
                );
              }
            }}
          />
        </div>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border px-3 py-3">
            <p className="text-[11px] leading-relaxed text-fg-2">
              Reduce white noise, wind, hum, room tone, and background music
              while keeping speech or the wanted audio in front.
            </p>
            <RadioGroup
              aria-label="Noise reduction preset"
              value={activePreset.id}
              disabled={busy}
              onValueChange={(value) =>
                void learn(value as NoiseReductionFocus)
              }
              className="grid grid-cols-2 gap-2"
            >
              {NOISE_REDUCTION_PRESETS.map((preset) => (
                <Label
                  key={preset.id}
                  className="flex cursor-pointer items-start gap-2 rounded-[7px] border border-border bg-bg-1 p-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:disabled]:cursor-default has-[:disabled]:opacity-50"
                >
                  <RadioGroupItem
                    value={preset.id}
                    aria-label={`Use ${preset.label} noise reduction`}
                    className="mt-0.5 shrink-0"
                    onClick={() => {
                      if (activePreset.id === preset.id) void learn(preset.id);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium">
                      {preset.label}
                    </span>
                    <span className="mt-1 block text-[10px] font-normal leading-relaxed text-fg-2">
                      {preset.description}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            <div className="rounded-[7px] border border-border bg-bg-1 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-fg-2">
                  Current mode: {activePreset.label}
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {enabled ? "Applied" : "Off"}
                </Badge>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-fg-3">
                {activePreset.description}
              </p>
              {message && (
                <p
                  role="status"
                  className="mt-2 text-[11px] text-status-success"
                >
                  {message}
                </p>
              )}
            </div>
            {recommendation && recommendationPreset && (
              <Alert className="border-primary/30 bg-primary/5 p-3">
                <Wand2 className="size-3.5" />
                <AlertDescription className="space-y-2 text-[11px]">
                  <p className="font-medium text-fg">Recommendation ready</p>
                  <p>
                    Detected noise best matches{" "}
                    {recommendationPreset.label.toLowerCase()}. Apply{" "}
                    {Math.round(recommendation.config.reduction * 100)}% cleanup
                    at {recommendation.config.threshold.toFixed(0)} dB.
                    {recommendation.hasLearnedProfile
                      ? " Save this learned profile on the clip."
                      : " A custom profile could not be isolated, so this recommendation uses the best preset match for the clip."}
                  </p>
                  <Button
                    size="sm"
                    className="w-full text-[11px]"
                    onClick={applyRecommendation}
                  >
                    Apply Recommended Cleanup
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2 rounded-[7px] border border-border bg-bg-1 p-2.5">
              <p className="text-[11px] font-medium">A/B Preview</p>
              <Tabs
                value={previewingOriginal ? "original" : "cleaned"}
                onValueChange={preview}
              >
                <TabsList className="grid h-7 w-full grid-cols-2">
                  <TabsTrigger
                    value="original"
                    disabled={!activeEffect || busy}
                    className="text-[11px]"
                  >
                    Hear Original
                  </TabsTrigger>
                  <TabsTrigger
                    value="cleaned"
                    disabled={!activeEffect || busy}
                    className="text-[11px]"
                  >
                    Hear Cleaned
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-[10px] leading-relaxed text-fg-3">
                Preview only. Export still uses the cleaned audio effect chain.
              </p>
            </div>
            <PropertySlider
              label="Threshold"
              value={config.threshold}
              min={-80}
              max={0}
              onChange={(value) => change("threshold", value)}
              formatValue={(value) => `${Math.round(value)} dB`}
              isDisabled={busy}
            />
            <PropertySlider
              label="Reduction"
              value={config.reduction * 100}
              min={0}
              max={100}
              onChange={(value) => change("reduction", value / 100)}
              formatValue={(value) => `${Math.round(value)}%`}
              isDisabled={busy}
            />
            <PropertySlider
              label="Attack"
              value={config.attack ?? 10}
              min={0}
              max={100}
              onChange={(value) => change("attack", value)}
              formatValue={(value) => `${Math.round(value)} ms`}
              isDisabled={busy}
            />
            <PropertySlider
              label="Release"
              value={config.release ?? 100}
              min={0}
              max={500}
              onChange={(value) => change("release", value)}
              formatValue={(value) => `${Math.round(value)} ms`}
              isDisabled={busy}
            />
            <Button
              size="sm"
              className="w-full gap-1.5 text-[11px]"
              onClick={() => void learn()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : state === "success" ? (
                <Check className="size-3.5" />
              ) : (
                <Wand2 className="size-3.5" />
              )}
              {buttonLabel}
            </Button>
            {busy && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                onClick={cancel}
              >
                Cancel analysis
              </Button>
            )}
            {progress && busy && (
              <div
                role="status"
                className="space-y-2 rounded-[7px] border border-border bg-bg-1 p-2.5"
              >
                <div className="flex justify-between gap-2 text-[11px] text-fg-2">
                  <span>{progress.message}</span>
                  <span className="font-mono tabular-nums">
                    {Math.round(progress.progress * 100)}%
                  </span>
                </div>
                <Progress
                  aria-label="Noise analysis progress"
                  value={Math.round(progress.progress * 100)}
                />
              </div>
            )}
            {error && (
              <Alert variant="destructive" className="p-2.5">
                <AlertDescription className="text-[11px]">
                  {error}
                </AlertDescription>
              </Alert>
            )}
            {config.profile && !recommendation && state !== "error" && (
              <p className="text-center text-[10px] leading-relaxed text-fg-3">
                Learned noise profile is active on this clip.
                <br />
                Auto-tuned with {activePreset.label.toLowerCase()} and reused
                for export cleanup.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

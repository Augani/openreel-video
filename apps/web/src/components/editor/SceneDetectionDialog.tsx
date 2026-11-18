import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Progress,
  Slider,
  Switch,
} from "@openreel/ui";
import { Film, Loader2 } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useSceneDetectionDialogStore } from "../../stores/scene-detection-dialog-store";
import { toast } from "../../stores/notification-store";
import {
  analyseClipScenes,
  applySceneCuts,
  sceneDetectionBlockReason,
  type SceneAnalysis,
} from "../../services/scene-detection";

type Phase = "idle" | "analysing" | "done" | "applying";

const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export function SceneDetectionDialog() {
  const clipId = useSceneDetectionDialogStore((state) => state.clipId);
  return clipId ? <SceneDetectionSession clipId={clipId} /> : null;
}

function SceneDetectionSession({ clipId }: { clipId: string }) {
  const id = useId();
  const close = useSceneDetectionDialogStore((state) => state.close);
  const controller = useRef<AbortController | null>(null);
  // Only the newest run may publish progress or results.
  const runId = useRef(0);
  const mounted = useRef(true);
  const [sensitivity, setSensitivity] = useState(50);
  const [minLength, setMinLength] = useState(0.5);
  const [splitClip, setSplitClip] = useState(true);
  const [addMarkers, setAddMarkers] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<SceneAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blockReason = useProjectStore((state) =>
    sceneDetectionBlockReason(state.project, clipId),
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runId.current++;
      controller.current?.abort();
    };
  }, []);

  // Results describe one clip of one project; drop them if either changes.
  const projectId = useProjectStore((state) => state.project.id);
  const firstProject = useRef(projectId);
  useEffect(() => {
    if (firstProject.current !== projectId) close();
  }, [projectId, close]);

  const invalidate = () => {
    if (phase === "done") {
      setAnalysis(null);
      setPhase("idle");
    }
  };

  const handleClose = useCallback(() => {
    runId.current++;
    controller.current?.abort();
    close();
  }, [close]);

  const handleAnalyse = async () => {
    controller.current?.abort();
    const run = ++runId.current;
    const abort = new AbortController();
    controller.current = abort;
    setPhase("analysing");
    setProgress(0);
    setError(null);
    setAnalysis(null);
    try {
      const found = await analyseClipScenes(clipId, {
        sensitivity: sensitivity / 100,
        minSceneLength: minLength,
        signal: abort.signal,
        onProgress: (p) => {
          if (run === runId.current && mounted.current) setProgress(p.fraction);
        },
      });
      if (run !== runId.current || !mounted.current) return;
      setAnalysis(found);
      setPhase("done");
    } catch (caught) {
      if (run !== runId.current || !mounted.current) return;
      setPhase("idle");
      if (!isAbort(caught))
        setError(caught instanceof Error ? caught.message : "Detection failed");
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  };

  const handleCancel = () => {
    runId.current++;
    controller.current?.abort();
    controller.current = null;
    setPhase("idle");
    setProgress(0);
  };

  const handleApply = async () => {
    if (!analysis || phase !== "done") return;
    const run = ++runId.current;
    setPhase("applying");
    setError(null);
    try {
      const result = await applySceneCuts(analysis, { splitClip, addMarkers });
      if (!mounted.current || run !== runId.current) return;
      const parts: string[] = [];
      if (splitClip)
        parts.push(`${result.splits} split${result.splits === 1 ? "" : "s"}`);
      if (addMarkers)
        parts.push(
          `${result.markers} marker${result.markers === 1 ? "" : "s"}`,
        );
      if (result.skippedLockedLinked > 0)
        parts.push(
          `${result.skippedLockedLinked} linked clip${result.skippedLockedLinked === 1 ? "" : "s"} on locked tracks skipped`,
        );
      if (result.splits === 0 && result.markers === 0) {
        setPhase("done");
        setError(
          "None of the detected cuts fall inside the clip as it is now. Analyse again.",
        );
        return;
      }
      toast.success("Scene edit detection applied", parts.join(", "));
      close();
    } catch (caught) {
      if (!mounted.current || run !== runId.current) return;
      setPhase("done");
      setError(
        caught instanceof Error ? caught.message : "Could not apply the cuts",
      );
    }
  };

  const analysing = phase === "analysing";
  const busy = analysing || phase === "applying";
  const cutCount = analysis?.cuts.length ?? 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-w-md border-border bg-bg-1 text-fg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Film size={16} className="text-primary" aria-hidden />
            Scene Edit Detection
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-3">
            Find hard cuts in this clip. Fades and dissolves are ignored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <Label htmlFor={`${id}-sensitivity`}>Sensitivity</Label>
              <span className="tabular-nums text-fg-3">{sensitivity}%</span>
            </div>
            <Slider
              id={`${id}-sensitivity`}
              aria-label="Sensitivity"
              min={0}
              max={100}
              step={1}
              value={[sensitivity]}
              disabled={busy}
              onValueChange={([value]) => {
                setSensitivity(value);
                invalidate();
              }}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <Label htmlFor={`${id}-min-length`}>Minimum scene length</Label>
              <span className="tabular-nums text-fg-3">
                {minLength.toFixed(1)}s
              </span>
            </div>
            <Slider
              id={`${id}-min-length`}
              aria-label="Minimum scene length"
              min={0.2}
              max={5}
              step={0.1}
              value={[minLength]}
              disabled={busy}
              onValueChange={([value]) => {
                setMinLength(value);
                invalidate();
              }}
            />
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor={`${id}-split`} className="text-xs">
                  Split clip at cuts
                </Label>
                <p className="text-[11px] text-fg-3">
                  One undo step. Linked audio is split too.
                </p>
              </div>
              <Switch
                id={`${id}-split`}
                checked={splitClip}
                disabled={busy}
                onCheckedChange={setSplitClip}
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <Label htmlFor={`${id}-markers`} className="text-xs">
                Add timeline markers
              </Label>
              <Switch
                id={`${id}-markers`}
                checked={addMarkers}
                disabled={busy}
                onCheckedChange={setAddMarkers}
              />
            </div>
          </div>

          {analysing && (
            <div className="space-y-2" role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Loader2
                  size={14}
                  className="animate-spin text-primary"
                  aria-hidden
                />
                Analysing… {Math.round(progress * 100)}%
              </div>
              <Progress
                value={Math.round(progress * 100)}
                aria-label="Scene detection progress"
              />
            </div>
          )}

          {phase === "done" && analysis && !error && (
            <p className="text-xs font-semibold" role="status">
              {cutCount === 0
                ? "No cuts found. Try raising the sensitivity."
                : `${cutCount} cut${cutCount === 1 ? "" : "s"} found`}
            </p>
          )}

          {(error || blockReason) && (
            <Alert variant="destructive">
              <AlertDescription>{error ?? blockReason}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          {analysing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={busy}
              >
                Close
              </Button>
              <Button
                variant={phase === "done" && cutCount > 0 ? "outline" : "default"}
                size="sm"
                onClick={() => void handleAnalyse()}
                disabled={busy || !!blockReason}
              >
                {phase === "done" ? "Re-analyse" : "Analyse"}
              </Button>
              {phase !== "idle" && cutCount > 0 && (
                <Button
                  size="sm"
                  onClick={() => void handleApply()}
                  disabled={busy || (!splitClip && !addMarkers)}
                >
                  {phase === "applying" ? "Applying…" : "Apply"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

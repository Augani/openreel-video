import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Project } from "@openreel/core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from "@openreel/ui";
import { createEditorProject } from "../../../services/project-creation";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { EDITING_FRAME_RATE_OPTIONS } from "../../editor/editing-frame-rate";

export interface SequencePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

/** Common delivery sizes. Frame rates match `EDITING_FRAME_RATE_OPTIONS`. */
export const SEQUENCE_PRESETS: readonly SequencePreset[] = [
  { id: "hd-23976", label: "1080p 23.976", width: 1920, height: 1080, frameRate: 23.976 },
  { id: "hd-24", label: "1080p 24", width: 1920, height: 1080, frameRate: 24 },
  { id: "hd-25", label: "1080p 25", width: 1920, height: 1080, frameRate: 25 },
  { id: "hd-30", label: "1080p 30", width: 1920, height: 1080, frameRate: 30 },
  { id: "hd-60", label: "1080p 60", width: 1920, height: 1080, frameRate: 60 },
  { id: "uhd-24", label: "4K 24", width: 3840, height: 2160, frameRate: 24 },
  { id: "uhd-30", label: "4K 30", width: 3840, height: 2160, frameRate: 30 },
  { id: "uhd-60", label: "4K 60", width: 3840, height: 2160, frameRate: 60 },
  { id: "k27-30", label: "2.7K 30", width: 2704, height: 1520, frameRate: 30 },
];

const MIN_DIMENSION = 64;
const MAX_DIMENSION = 8192;

export interface CustomSequenceDialogProps {
  onClose: () => void;
  /** Called with the new project once it is the open project (the host then goes to the editor). */
  onCreated: (project: Project) => void;
}

const fieldClass =
  "h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none transition-colors " +
  "focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50";

const chipClass =
  "h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function parseDimension(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= MIN_DIMENSION && value <= MAX_DIMENSION ? value : null;
}

/** Small "Custom sequence" form: resolution, frame rate and common presets. */
export function CustomSequenceDialog({ onClose, onCreated }: CustomSequenceDialogProps) {
  const ids = { name: useId(), width: useId(), height: useId(), fps: useId() };
  const [name, setName] = useState("Custom Sequence");
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [frameRate, setFrameRate] = useState("24");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const w = parseDimension(width);
  const h = parseDimension(height);
  const fps = Number(frameRate);
  const valid = w !== null && h !== null && Number.isFinite(fps) && fps > 0;

  const activePreset = useMemo(
    () => SEQUENCE_PRESETS.find((p) => p.width === w && p.height === h && p.frameRate === fps)?.id,
    [w, h, fps],
  );

  const applyPreset = (preset: SequencePreset) => {
    setWidth(String(preset.width));
    setHeight(String(preset.height));
    setFrameRate(String(preset.frameRate));
    setError(null);
  };

  const create = useCallback(async () => {
    if (!valid || creating || w === null || h === null) return;
    const abort = new AbortController();
    controller.current = abort;
    setCreating(true);
    setError(null);
    try {
      const project = await createEditorProject({
        name: name.trim() || "Custom Sequence",
        settings: { width: w, height: h, frameRate: fps },
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      const onboarding = useOnboardingStore.getState();
      onboarding.markFormatChosen(project.id);
      onboarding.start("pro");
      onboarding.markDone();
      onCreated(project);
    } catch (reason) {
      if (!abort.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Could not create the sequence. Try again.");
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (!abort.signal.aborted) setCreating(false);
    }
  }, [valid, creating, w, h, fps, name, onCreated]);

  return (
    <Dialog open onOpenChange={(open) => !open && !creating && onClose()}>
      <DialogContent
        hideCloseButton
        className="max-w-md gap-5 rounded-2xl border-border bg-bg-1 p-6 text-fg shadow-glow"
        data-testid="custom-sequence-dialog"
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base font-semibold tracking-tight text-fg">Custom sequence</DialogTitle>
          <DialogDescription className="text-xs text-fg-3">
            Pick a size and frame rate. You can change them later in project settings.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div role="group" aria-label="Common sequences" className="flex flex-wrap gap-1.5">
            {SEQUENCE_PRESETS.map((preset) => {
              const on = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={on}
                  disabled={creating}
                  onClick={() => applyPreset(preset)}
                  className={`${chipClass} ${
                    on
                      ? "border-accent/50 bg-accent-soft text-fg"
                      : "border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className="text-xs font-medium text-fg-2">
              Name
            </label>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} disabled={creating} className={fieldClass} maxLength={80} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.width} className="text-xs font-medium text-fg-2">
                Width
              </label>
              <Input
                id={ids.width}
                inputMode="numeric"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                aria-invalid={w === null}
                disabled={creating}
                className={fieldClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.height} className="text-xs font-medium text-fg-2">
                Height
              </label>
              <Input
                id={ids.height}
                inputMode="numeric"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                aria-invalid={h === null}
                disabled={creating}
                className={fieldClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.fps} className="text-xs font-medium text-fg-2">
                Frame rate
              </label>
              <select
                id={ids.fps}
                value={frameRate}
                onChange={(e) => setFrameRate(e.target.value)}
                disabled={creating}
                className={fieldClass}
              >
                {EDITING_FRAME_RATE_OPTIONS.map((option) => (
                  <option key={option.value} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(w === null || h === null) && (
            <p className="text-xs text-fg-3">
              Width and height must be whole numbers from {MIN_DIMENSION} to {MAX_DIMENSION}.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="h-9 rounded-lg px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid || creating}
              className="h-9 rounded-lg bg-accent px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-1 disabled:pointer-events-none disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create sequence"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

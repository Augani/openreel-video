import { useEffect, useMemo, useState } from "react";
import { SPEED_MAX, SPEED_MIN, type ClipSpeedEdit } from "@openreel/core";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@openreel/ui";
import { useClipSpeedDialogStore } from "../../stores/clip-speed-dialog-store";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { applyClipSpeedEdit, selectedSpeedClips } from "../../services/clip-speed-multi";
import { formatFrameTimecode, parseFrameTimecode } from "../../utils/frame-timecode";

const EPS = 1e-6;
const rateOf = (clip: { speed?: number }) => clip.speed ?? 1;

/**
 * Clip > Speed/Duration for one or many selected clips (Premiere parity).
 * Speed and Duration are linked; with several clips Duration is the combined
 * length and scales every clip by the same factor. "Ripple Edit, Shifting
 * Trailing Clips" honours sync lock; linked audio always follows.
 */
export function ClipSpeedDialog() {
  const open = useClipSpeedDialogStore((s) => s.open);
  const setOpen = useClipSpeedDialogStore((s) => s.setOpen);
  const frameRate = useProjectStore((s) => s.project.settings.frameRate) || 30;
  const clips = useMemo(() => (open ? selectedSpeedClips() : []), [open]);
  const baseDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const speeds = clips.map(rateOf);
  const uniform = speeds.every((value) => Math.abs(value - speeds[0]) < EPS);
  const reversedAll = clips.length > 0 && clips.every((clip) => clip.reversed);
  const pitchAll = clips.every((clip) => clip.pitchCorrection ?? true);

  const [speed, setSpeed] = useState("");
  const [duration, setDuration] = useState("");
  const [touched, setTouched] = useState<"speed" | "duration" | null>(null);
  const [reverse, setReverse] = useState(false);
  const [reverseTouched, setReverseTouched] = useState(false);
  const [pitch, setPitch] = useState(true);
  const [pitchTouched, setPitchTouched] = useState(false);
  const [ripple, setRipple] = useState(true);

  useEffect(() => {
    if (!open) return;
    setSpeed(uniform ? String(Math.round(speeds[0] * 10000) / 100) : "");
    setDuration(formatFrameTimecode(baseDuration, frameRate));
    setTouched(null);
    setReverse(reversedAll);
    setReverseTouched(false);
    setPitch(pitchAll);
    setPitchTouched(false);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedSpeed = Number(speed);
  const speedValid = speed.trim() !== "" && Number.isFinite(parsedSpeed) && parsedSpeed / 100 >= SPEED_MIN - EPS && parsedSpeed / 100 <= SPEED_MAX + EPS;
  const parsedDuration = parseFrameTimecode(duration, frameRate);
  const durationValid = parsedDuration !== null && parsedDuration > 0;
  const error =
    touched === "speed" && !speedValid
      ? `Speed must be between ${SPEED_MIN * 100}% and ${SPEED_MAX * 100}%.`
      : touched === "duration" && !durationValid
        ? "Enter a duration as seconds or timecode (HH:MM:SS:FF)."
        : "";
  const changed = touched !== null || reverseTouched || pitchTouched;
  const valid = changed && !error;

  const onSpeed = (value: string) => {
    setSpeed(value);
    setTouched("speed");
    const next = Number(value) / 100;
    if (value.trim() !== "" && Number.isFinite(next) && next > 0) {
      // Linked field: the new total length at this rate.
      const total = clips.reduce((sum, clip) => sum + (clip.outPoint - clip.inPoint) / next, 0);
      setDuration(formatFrameTimecode(total, frameRate));
    }
  };
  const onDuration = (value: string) => {
    setDuration(value);
    setTouched("duration");
    const seconds = parseFrameTimecode(value, frameRate);
    if (seconds && seconds > 0 && baseDuration > 0 && clips.length === 1) {
      const clip = clips[0];
      setSpeed(String(Math.round(((clip.outPoint - clip.inPoint) / seconds) * 10000) / 100));
    }
  };

  const apply = () => {
    if (!valid) return;
    const edit: ClipSpeedEdit = {};
    if (touched === "speed") edit.speed = parsedSpeed / 100;
    else if (touched === "duration" && parsedDuration !== null)
      if (clips.length === 1) edit.duration = parsedDuration;
      else edit.durationScale = parsedDuration / baseDuration;
    if (reverseTouched) edit.reversed = reverse;
    if (pitchTouched) edit.maintainPitch = pitch;
    const outcome = applyClipSpeedEdit(edit, ripple);
    if (!outcome.success) {
      toast.warning("Speed/Duration blocked", outcome.message ?? "The edit could not be applied.");
      return;
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Clip speed / duration</DialogTitle>
          <DialogDescription>
            {clips.length > 1
              ? `Applies to ${clips.length} selected clips, including linked audio, as one undo step.`
              : "Change how fast the clip plays. Linked audio follows."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
          className="space-y-3"
        >
          <label className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs text-fg-2">
            Speed (%)
            <Input
              autoFocus
              inputMode="decimal"
              aria-label="Speed percent"
              placeholder={uniform ? "" : "Mixed"}
              value={speed}
              onChange={(event) => onSpeed(event.target.value)}
            />
          </label>
          <label className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs text-fg-2">
            {clips.length > 1 ? "Total duration" : "Duration"}
            <Input
              aria-label="Duration"
              value={duration}
              onChange={(event) => onDuration(event.target.value)}
            />
          </label>
          {error ? <p role="alert" className="text-xs text-status-error">{error}</p> : null}
          <div className="space-y-1.5 text-xs text-fg-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={reverse} onChange={(event) => { setReverse(event.target.checked); setReverseTouched(true); }} />
              Reverse speed
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pitch} onChange={(event) => { setPitch(event.target.checked); setPitchTouched(true); }} />
              Maintain audio pitch
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ripple} onChange={(event) => setRipple(event.target.checked)} />
              Ripple edit, shifting trailing clips
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid}>OK</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import {
  Play,
  Rewind,
  FastForward,
  Pause,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  getSpeedEngine,
  type SpeedKeyframe,
  SPEED_MIN,
  SPEED_MAX,
  SPEED_CURVE_PRESETS,
} from "@openreel/core";

interface ClipLike {
  id: string;
  startTime: number;
  duration: number;
}

interface SpeedRampSectionProps {
  clip: ClipLike;
}

interface SpeedPreset {
  id: string;
  name: string;
  speed: number;
  icon: React.ElementType;
}

const SPEED_PRESETS: SpeedPreset[] = [
  { id: "slow-25", name: "0.25x", speed: 0.25, icon: Rewind },
  { id: "slow-50", name: "0.5x", speed: 0.5, icon: Rewind },
  { id: "slow-75", name: "0.75x", speed: 0.75, icon: Rewind },
  { id: "normal", name: "1x", speed: 1, icon: Play },
  { id: "fast-150", name: "1.5x", speed: 1.5, icon: FastForward },
  { id: "fast-200", name: "2x", speed: 2, icon: FastForward },
  { id: "fast-400", name: "4x", speed: 4, icon: FastForward },
  { id: "fast-800", name: "8x", speed: 8, icon: FastForward },
];

const SpeedCurveCanvas: React.FC<{
  keyframes: SpeedKeyframe[];
  duration: number;
  baseSpeed: number;
  onAddKeyframe: (time: number, speed: number) => void;
  onRemoveKeyframe: (id: string) => void;
  onMoveKeyframe: (id: string, time: number, speed: number) => void;
}> = ({
  keyframes,
  duration,
  baseSpeed,
  onAddKeyframe,
  onRemoveKeyframe,
  onMoveKeyframe,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredKeyframe, setHoveredKeyframe] = useState<string | null>(null);
  const [draggingKeyframe, setDraggingKeyframe] = useState<string | null>(null);
  // Track whether a pointer-down resulted in an actual drag (vs a click
  // intended to add/remove). We only treat it as a drag once the pointer
  // moves more than a few pixels.
  const dragStateRef = useRef<{
    keyframeId: string | null;
    didDrag: boolean;
    downX: number;
    downY: number;
  }>({ keyframeId: null, didDrag: false, downX: 0, downY: 0 });

  const sortedKeyframes = useMemo(() => {
    return [...keyframes].sort((a, b) => a.time - b.time);
  }, [keyframes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (graphHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#444";
    ctx.setLineDash([5, 5]);
    const normalY =
      padding + graphHeight * (1 - (1 - SPEED_MIN) / (SPEED_MAX - SPEED_MIN));
    ctx.beginPath();
    ctx.moveTo(padding, normalY);
    ctx.lineTo(width - padding, normalY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const getSpeedAtTime = (t: number): number => {
      if (sortedKeyframes.length === 0) return baseSpeed;
      if (t <= sortedKeyframes[0].time) return sortedKeyframes[0].speed;
      if (t >= sortedKeyframes[sortedKeyframes.length - 1].time) {
        return sortedKeyframes[sortedKeyframes.length - 1].speed;
      }
      for (let i = 0; i < sortedKeyframes.length - 1; i++) {
        if (t >= sortedKeyframes[i].time && t <= sortedKeyframes[i + 1].time) {
          const kf1 = sortedKeyframes[i];
          const kf2 = sortedKeyframes[i + 1];
          const progress = (t - kf1.time) / (kf2.time - kf1.time);
          return kf1.speed + (kf2.speed - kf1.speed) * progress;
        }
      }
      return baseSpeed;
    };

    const speedToY = (speed: number) => {
      const normalized =
        (Math.log(speed) - Math.log(SPEED_MIN)) /
        (Math.log(SPEED_MAX) - Math.log(SPEED_MIN));
      return padding + graphHeight * (1 - normalized);
    };

    const timeToX = (time: number) => padding + (time / duration) * graphWidth;

    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration;
      const speed = getSpeedAtTime(t);
      const x = timeToX(t);
      const y = speedToY(speed);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    sortedKeyframes.forEach((kf) => {
      const x = timeToX(kf.time);
      const y = speedToY(kf.speed);
      const isHovered = hoveredKeyframe === kf.id;
      const isDragging = draggingKeyframe === kf.id;

      ctx.beginPath();
      ctx.arc(x, y, isDragging ? 8 : isHovered ? 7 : 6, 0, Math.PI * 2);
      ctx.fillStyle = isDragging
        ? "#16a34a"
        : isHovered
          ? "#4ade80"
          : "#22c55e";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${SPEED_MAX}x`, 2, padding + 4);
    ctx.fillText("1x", 2, normalY + 4);
    ctx.fillText(`${SPEED_MIN}x`, 2, height - padding + 4);
  }, [sortedKeyframes, duration, baseSpeed, hoveredKeyframe, draggingKeyframe]);

  // ── Coordinate helpers (shared by mouse handlers and renderer) ──
  const CANVAS_PADDING = 20;
  const HIT_RADIUS = 10;

  const canvasToWorld = useCallback(
    (canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      // The canvas has a fixed internal resolution but is rendered at
      // CSS-determined size; scale mouse coords back into the
      // canvas-space we drew in.
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      const graphWidth = canvas.width - CANVAS_PADDING * 2;
      const graphHeight = canvas.height - CANVAS_PADDING * 2;
      const time = ((cx - CANVAS_PADDING) / graphWidth) * duration;
      const normalizedY = (cy - CANVAS_PADDING) / graphHeight;
      const speed = Math.exp(
        Math.log(SPEED_MAX) -
          normalizedY * (Math.log(SPEED_MAX) - Math.log(SPEED_MIN)),
      );
      return {
        canvasX: cx,
        canvasY: cy,
        time,
        speed: Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed)),
      };
    },
    [duration],
  );

  const findKeyframeAt = useCallback(
    (canvas: HTMLCanvasElement, canvasX: number, canvasY: number) => {
      const graphWidth = canvas.width - CANVAS_PADDING * 2;
      const graphHeight = canvas.height - CANVAS_PADDING * 2;
      return sortedKeyframes.find((kf) => {
        const kfX = CANVAS_PADDING + (kf.time / duration) * graphWidth;
        const kfY =
          CANVAS_PADDING +
          graphHeight *
            (1 -
              (Math.log(kf.speed) - Math.log(SPEED_MIN)) /
                (Math.log(SPEED_MAX) - Math.log(SPEED_MIN)));
        return Math.abs(canvasX - kfX) < HIT_RADIUS && Math.abs(canvasY - kfY) < HIT_RADIUS;
      });
    },
    [sortedKeyframes, duration],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { canvasX, canvasY } = canvasToWorld(canvas, e);
      const kf = findKeyframeAt(canvas, canvasX, canvasY);
      dragStateRef.current = {
        keyframeId: kf?.id ?? null,
        didDrag: false,
        downX: e.clientX,
        downY: e.clientY,
      };
      if (kf) {
        setDraggingKeyframe(kf.id);
      }
    },
    [canvasToWorld, findKeyframeAt],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { canvasX, canvasY, time, speed } = canvasToWorld(canvas, e);

      // Update hover for cursor feedback (regardless of drag state).
      if (!dragStateRef.current.keyframeId) {
        const hit = findKeyframeAt(canvas, canvasX, canvasY);
        setHoveredKeyframe(hit?.id ?? null);
      }

      // If we're actively dragging a keyframe, move it.
      if (dragStateRef.current.keyframeId) {
        const dx = Math.abs(e.clientX - dragStateRef.current.downX);
        const dy = Math.abs(e.clientY - dragStateRef.current.downY);
        if (dx > 3 || dy > 3) dragStateRef.current.didDrag = true;
        const clampedTime = Math.max(0, Math.min(duration, time));
        onMoveKeyframe(dragStateRef.current.keyframeId, clampedTime, speed);
      }
    },
    [canvasToWorld, findKeyframeAt, duration, onMoveKeyframe],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const state = dragStateRef.current;
      const { canvasX, canvasY, time, speed } = canvasToWorld(canvas, e);

      if (state.keyframeId) {
        // Released on a keyframe. If user clicked without dragging
        // we interpret it as "remove that keyframe". A drag commits
        // the new position (already applied via mousemove).
        if (!state.didDrag) {
          onRemoveKeyframe(state.keyframeId);
        }
      } else {
        // Released over empty space — add a new keyframe at the
        // pointer position, but only on click (no drag scrub).
        const dx = Math.abs(e.clientX - state.downX);
        const dy = Math.abs(e.clientY - state.downY);
        if (
          dx < 4 &&
          dy < 4 &&
          time >= 0 &&
          time <= duration &&
          canvasX >= CANVAS_PADDING &&
          canvasX <= canvas.width - CANVAS_PADDING &&
          canvasY >= CANVAS_PADDING &&
          canvasY <= canvas.height - CANVAS_PADDING
        ) {
          onAddKeyframe(time, speed);
        }
      }

      dragStateRef.current = {
        keyframeId: null,
        didDrag: false,
        downX: 0,
        downY: 0,
      };
      setDraggingKeyframe(null);
    },
    [canvasToWorld, duration, onAddKeyframe, onRemoveKeyframe],
  );

  const handleMouseLeave = useCallback(() => {
    // If the user drags off the canvas, treat as a commit at the last
    // known position (mousemove already updated it).
    if (dragStateRef.current.keyframeId) {
      dragStateRef.current = {
        keyframeId: null,
        didDrag: false,
        downX: 0,
        downY: 0,
      };
      setDraggingKeyframe(null);
    }
    setHoveredKeyframe(null);
  }, []);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={280}
        height={120}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className={`w-full rounded-lg border border-border ${
          draggingKeyframe
            ? "cursor-grabbing"
            : hoveredKeyframe
              ? "cursor-grab"
              : "cursor-crosshair"
        }`}
      />
      <div className="absolute bottom-1 right-1 text-[8px] text-fg-3 pointer-events-none">
        Click to add • Drag to move • Click a point to remove
      </div>
    </div>
  );
};

export const SpeedRampSection: React.FC<SpeedRampSectionProps> = ({ clip }) => {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const speedEngine = useMemo(() => getSpeedEngine(), []);

  const [isExpanded, setIsExpanded] = useState(false);
  const [showCurve, setShowCurve] = useState(false);

  useEffect(() => {
    speedEngine.initializeClip(clip.id, clip.duration);
  }, [clip.id, clip.duration, speedEngine]);

  const speedData = useMemo(() => {
    return speedEngine.getClipSpeedData(clip.id);
  }, [clip.id, speedEngine]);

  const currentSpeed = speedData?.baseSpeed ?? 1;
  const isReverse = speedData?.reverse ?? false;
  const keyframes = speedData?.keyframes ?? [];
  const freezeFrames = speedData?.freezeFrames ?? [];
  const pitchCorrection = speedData?.pitchCorrection ?? true;

  const handleSpeedChange = useCallback(
    (speed: number) => {
      speedEngine.setClipSpeed(clip.id, speed, clip.duration);
      {
        const rampData = speedEngine.getClipSpeedData(clip.id);
        void useProjectStore.getState().executeAction({
          type: "speed/setRampData",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            clipId: clip.id,
            keyframes: rampData?.keyframes,
            freezeFrames: rampData?.freezeFrames,
            pitchCorrection: rampData?.pitchCorrection,
          },
        });
      }
    },
    [clip.id, clip.duration, speedEngine],
  );

  const handleReverseToggle = useCallback(() => {
    speedEngine.setReverse(clip.id, !isReverse, clip.duration);
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, [clip.id, clip.duration, isReverse, speedEngine]);

  const handlePitchCorrectionToggle = useCallback(() => {
    speedEngine.setPitchCorrection(clip.id, !pitchCorrection);
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, [clip.id, pitchCorrection, speedEngine]);

  const handleAddKeyframe = useCallback(
    (time: number, speed: number) => {
      speedEngine.addSpeedKeyframe(clip.id, time, speed, "ease-in-out");
      {
        const rampData = speedEngine.getClipSpeedData(clip.id);
        void useProjectStore.getState().executeAction({
          type: "speed/setRampData",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            clipId: clip.id,
            keyframes: rampData?.keyframes,
            freezeFrames: rampData?.freezeFrames,
            pitchCorrection: rampData?.pitchCorrection,
          },
        });
      }
    },
    [clip.id, speedEngine],
  );

  const handleRemoveKeyframe = useCallback(
    (keyframeId: string) => {
      speedEngine.removeSpeedKeyframe(clip.id, keyframeId);
      {
        const rampData = speedEngine.getClipSpeedData(clip.id);
        void useProjectStore.getState().executeAction({
          type: "speed/setRampData",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            clipId: clip.id,
            keyframes: rampData?.keyframes,
            freezeFrames: rampData?.freezeFrames,
            pitchCorrection: rampData?.pitchCorrection,
          },
        });
      }
    },
    [clip.id, speedEngine],
  );

  const handleMoveKeyframe = useCallback(
    (keyframeId: string, time: number, speed: number) => {
      speedEngine.updateSpeedKeyframe(clip.id, keyframeId, { time, speed });
      {
        const rampData = speedEngine.getClipSpeedData(clip.id);
        void useProjectStore.getState().executeAction({
          type: "speed/setRampData",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            clipId: clip.id,
            keyframes: rampData?.keyframes,
            freezeFrames: rampData?.freezeFrames,
            pitchCorrection: rampData?.pitchCorrection,
          },
        });
      }
    },
    [clip.id, speedEngine],
  );

  const handleCreateFreezeFrame = useCallback(() => {
    const currentTime = playheadPosition;
    const clipStartTime = clip.startTime;
    const relativeTime = currentTime - clipStartTime;

    if (relativeTime >= 0 && relativeTime <= clip.duration) {
      speedEngine.createFreezeFrame(clip.id, relativeTime, relativeTime, 2);
      {
        const rampData = speedEngine.getClipSpeedData(clip.id);
        void useProjectStore.getState().executeAction({
          type: "speed/setRampData",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            clipId: clip.id,
            keyframes: rampData?.keyframes,
            freezeFrames: rampData?.freezeFrames,
            pitchCorrection: rampData?.pitchCorrection,
          },
        });
      }
    }
  }, [clip.id, clip.startTime, clip.duration, speedEngine, playheadPosition]);

  const handleRemoveFreezeFrame = useCallback(
    (freezeId: string) => {
      speedEngine.removeFreezeFrame(clip.id, freezeId);
      {
        const rampData = speedEngine.getClipSpeedData(clip.id);
        void useProjectStore.getState().executeAction({
          type: "speed/setRampData",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            clipId: clip.id,
            keyframes: rampData?.keyframes,
            freezeFrames: rampData?.freezeFrames,
            pitchCorrection: rampData?.pitchCorrection,
          },
        });
      }
    },
    [clip.id, speedEngine],
  );

  const handleApplyCurvePreset = useCallback(
    (presetId: string) => {
      const preset = SPEED_CURVE_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;

      keyframes.forEach((kf) => speedEngine.removeSpeedKeyframe(clip.id, kf.id));

      for (const kf of preset.keyframes) {
        const absoluteTime = kf.time * clip.duration;
        speedEngine.addSpeedKeyframe(clip.id, absoluteTime, kf.speed, kf.easing);
      }

      setShowCurve(true);
      {
        const rampData = speedEngine.getClipSpeedData(clip.id);
        void useProjectStore.getState().executeAction({
          type: "speed/setRampData",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            clipId: clip.id,
            keyframes: rampData?.keyframes,
            freezeFrames: rampData?.freezeFrames,
            pitchCorrection: rampData?.pitchCorrection,
          },
        });
      }
    },
    [clip.id, clip.duration, keyframes, speedEngine],
  );

  const handleReset = useCallback(() => {
    speedEngine.setClipSpeed(clip.id, 1, clip.duration);
    speedEngine.setReverse(clip.id, false, clip.duration);
    keyframes.forEach((kf) => speedEngine.removeSpeedKeyframe(clip.id, kf.id));
    freezeFrames.forEach((ff) => speedEngine.removeFreezeFrame(clip.id, ff.id));
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, [clip.id, clip.duration, keyframes, freezeFrames, speedEngine]);

  const effectiveDuration = useMemo(() => {
    return speedEngine.getEffectiveDuration(clip.id);
  }, [clip.id, speedEngine, currentSpeed, keyframes]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, "0")}`;
  };

  return (
    <div className="space-y-3">
      <Card variant="muted" padding={2} className="border border-border">
        <Text type="supporting" color="secondary" className="text-[10px]">
          Effective duration: {formatDuration(effectiveDuration)}
        </Text>
      </Card>

      <div className="space-y-2">
        <PropertySlider
          label="Playback Speed"
          min={Math.log(SPEED_MIN)}
          max={Math.log(SPEED_MAX)}
          step={0.01}
          value={Math.log(currentSpeed)}
          onChange={(value: number) => handleSpeedChange(Math.exp(value))}
          formatValue={() => `${currentSpeed.toFixed(2)}x`}
        />
        <div className="flex justify-between">
          <Text type="supporting" color="secondary" className="text-[8px]">0.1x</Text>
          <Text type="supporting" color="secondary" className="text-[8px]">1x</Text>
          <Text type="supporting" color="secondary" className="text-[8px]">20x</Text>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {SPEED_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            label={preset.name}
            variant={Math.abs(currentSpeed - preset.speed) < 0.01 ? "primary" : "secondary"}
            size="sm"
            onClick={() => handleSpeedChange(preset.speed)}
            className="text-[9px]"
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          label="Reverse"
          icon={<RotateCcw size={12} aria-hidden />}
          variant={isReverse ? "primary" : "secondary"}
          size="sm"
          onClick={handleReverseToggle}
          className="flex-1"
        />
        <Button
          label="Pitch Correct"
          variant={pitchCorrection ? "primary" : "secondary"}
          size="sm"
          onClick={handlePitchCorrectionToggle}
          className="flex-1"
        />
      </div>

      <div className="space-y-1.5">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
          Speed Curve Presets
        </Text>
        <div className="grid grid-cols-2 gap-1">
          {SPEED_CURVE_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              label={preset.name}
              variant="secondary"
              size="sm"
              onClick={() => handleApplyCurvePreset(preset.id)}
              className="justify-start text-[9px]"
            />
          ))}
        </div>
      </div>

      <Button
        label={`Speed Ramping${keyframes.length > 0 ? ` (${keyframes.length} keyframes)` : ""}`}
        icon={
          showCurve ? (
            <ChevronDown size={12} aria-hidden />
          ) : (
            <ChevronRight size={12} aria-hidden />
          )
        }
        variant="ghost"
        size="sm"
        onClick={() => setShowCurve(!showCurve)}
        className="w-full justify-start"
      />

      {showCurve && (
        <div className="space-y-2">
          <SpeedCurveCanvas
            keyframes={keyframes}
            duration={clip.duration}
            baseSpeed={currentSpeed}
            onAddKeyframe={handleAddKeyframe}
            onRemoveKeyframe={handleRemoveKeyframe}
            onMoveKeyframe={handleMoveKeyframe}
          />

          {keyframes.length > 0 && (
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {keyframes.map((kf, index) => (
                <Card
                  key={kf.id}
                  variant="muted"
                  padding={2}
                  className="flex items-center gap-2"
                >
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    #{index + 1}
                  </Text>
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    {kf.time.toFixed(2)}s
                  </Text>
                  <Text type="supporting" color="primary" className="text-[9px] font-mono">
                    {kf.speed.toFixed(2)}x
                  </Text>
                  <IconButton
                    label="Remove speed keyframe"
                    icon={<Trash2 size={10} aria-hidden />}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveKeyframe(kf.id)}
                    className="ml-auto text-fg-3 hover:text-red-400"
                  />
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        label={`Freeze Frames${freezeFrames.length > 0 ? ` (${freezeFrames.length} freeze)` : ""}`}
        icon={
          isExpanded ? (
            <ChevronDown size={12} aria-hidden />
          ) : (
            <ChevronRight size={12} aria-hidden />
          )
        }
        variant="ghost"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full justify-start"
      />

      {isExpanded && (
        <div className="space-y-2">
          <Button
            label="Add Freeze Frame at Playhead"
            icon={<Pause size={12} aria-hidden />}
            variant="primary"
            size="sm"
            onClick={handleCreateFreezeFrame}
            className="w-full"
          />

          {freezeFrames.length > 0 && (
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {freezeFrames.map((ff) => (
                <Card
                  key={ff.id}
                  variant="muted"
                  padding={2}
                  className="flex items-center gap-2"
                >
                  <Pause size={10} className="text-primary" aria-hidden />
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    {ff.startTime.toFixed(2)}s
                  </Text>
                  <Text type="supporting" color="secondary" className="text-[9px]">for</Text>
                  <Text type="supporting" color="primary" className="text-[9px] font-mono">
                    {ff.duration.toFixed(1)}s
                  </Text>
                  <IconButton
                    label="Remove freeze frame"
                    icon={<Trash2 size={10} aria-hidden />}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFreezeFrame(ff.id)}
                    className="ml-auto text-fg-3 hover:text-red-400"
                  />
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        label="Reset Speed & Effects"
        icon={<RotateCcw size={12} aria-hidden />}
        variant="secondary"
        size="sm"
        onClick={handleReset}
        className="w-full text-red-400"
      />
    </div>
  );
};

export default SpeedRampSection;

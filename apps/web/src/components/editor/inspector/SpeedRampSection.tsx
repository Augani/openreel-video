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
} from "lucide-react";
import { Slider } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  getSpeedEngine,
  type SpeedKeyframe,
  SPEED_MIN,
  SPEED_MAX,
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
}> = ({ keyframes, duration, baseSpeed, onAddKeyframe, onRemoveKeyframe }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredKeyframe] = useState<string | null>(null);
  const [draggingKeyframe] = useState<string | null>(null);

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

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const padding = 20;
      const graphWidth = canvas.width - padding * 2;
      const graphHeight = canvas.height - padding * 2;

      const time = ((x - padding) / graphWidth) * duration;
      const normalizedY = (y - padding) / graphHeight;
      const speed = Math.exp(
        Math.log(SPEED_MAX) -
          normalizedY * (Math.log(SPEED_MAX) - Math.log(SPEED_MIN)),
      );

      if (
        time >= 0 &&
        time <= duration &&
        speed >= SPEED_MIN &&
        speed <= SPEED_MAX
      ) {
        const clickedKf = sortedKeyframes.find((kf) => {
          const kfX = padding + (kf.time / duration) * graphWidth;
          const kfY =
            padding +
            graphHeight *
              (1 -
                (Math.log(kf.speed) - Math.log(SPEED_MIN)) /
                  (Math.log(SPEED_MAX) - Math.log(SPEED_MIN)));
          return Math.abs(x - kfX) < 10 && Math.abs(y - kfY) < 10;
        });

        if (clickedKf) {
          onRemoveKeyframe(clickedKf.id);
        } else {
          onAddKeyframe(time, Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed)));
        }
      }
    },
    [duration, sortedKeyframes, onAddKeyframe, onRemoveKeyframe],
  );

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={280}
        height={120}
        onClick={handleCanvasClick}
        className="w-full rounded-lg border border-border cursor-crosshair"
      />
      <div className="absolute bottom-1 right-1 text-[8px] text-text-muted">
        Click to add/remove keyframes
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
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
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
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [clip.id, speedEngine],
  );

  const handleRemoveKeyframe = useCallback(
    (keyframeId: string) => {
      speedEngine.removeSpeedKeyframe(clip.id, keyframeId);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [clip.id, speedEngine],
  );

  const handleCreateFreezeFrame = useCallback(() => {
    const currentTime = playheadPosition;
    const clipStartTime = clip.startTime;
    const relativeTime = currentTime - clipStartTime;

    if (relativeTime >= 0 && relativeTime <= clip.duration) {
      speedEngine.createFreezeFrame(clip.id, relativeTime, relativeTime, 2);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    }
  }, [clip.id, clip.startTime, clip.duration, speedEngine, playheadPosition]);

  const handleRemoveFreezeFrame = useCallback(
    (freezeId: string) => {
      speedEngine.removeFreezeFrame(clip.id, freezeId);
      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [clip.id, speedEngine],
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
      <div className="p-2 bg-background-tertiary rounded-lg border border-border">
        <p className="text-[10px] text-text-muted">
          Effective duration: {formatDuration(effectiveDuration)}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-text-secondary">
            Playback Speed
          </span>
          <span className="text-[10px] font-mono text-primary">
            {currentSpeed.toFixed(2)}x
          </span>
        </div>
        <Slider
          min={Math.log(SPEED_MIN)}
          max={Math.log(SPEED_MAX)}
          step={0.01}
          value={[Math.log(currentSpeed)]}
          onValueChange={(value) => handleSpeedChange(Math.exp(value[0]))}
        />
        <div className="flex justify-between text-[8px] text-text-muted">
          <span>0.1x</span>
          <span>1x</span>
          <span>20x</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {SPEED_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handleSpeedChange(preset.speed)}
            className={`py-1.5 px-2 text-[9px] rounded-lg border transition-colors ${
              Math.abs(currentSpeed - preset.speed) < 0.01
                ? "bg-primary/20 border-primary text-primary"
                : "bg-background-tertiary border-border text-text-secondary hover:border-primary/50"
            }`}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleReverseToggle}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] rounded-lg border transition-colors ${
            isReverse
              ? "bg-primary/20 border-primary text-primary"
              : "bg-background-tertiary border-border text-text-secondary hover:border-primary/50"
          }`}
        >
          <RotateCcw size={12} />
          Reverse
        </button>
        <button
          onClick={handlePitchCorrectionToggle}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] rounded-lg border transition-colors ${
            pitchCorrection
              ? "bg-primary/20 border-primary text-primary"
              : "bg-background-tertiary border-border text-text-secondary hover:border-primary/50"
          }`}
        >
          Pitch Correct
        </button>
      </div>

      <button
        onClick={() => setShowCurve(!showCurve)}
        className="w-full flex items-center gap-2 py-2 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
      >
        {showCurve ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">Speed Ramping</span>
        {keyframes.length > 0 && (
          <span className="ml-auto text-[9px] text-primary">
            {keyframes.length} keyframes
          </span>
        )}
      </button>

      {showCurve && (
        <div className="space-y-2">
          <SpeedCurveCanvas
            keyframes={keyframes}
            duration={clip.duration}
            baseSpeed={currentSpeed}
            onAddKeyframe={handleAddKeyframe}
            onRemoveKeyframe={handleRemoveKeyframe}
          />

          {keyframes.length > 0 && (
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {keyframes.map((kf, index) => (
                <div
                  key={kf.id}
                  className="flex items-center gap-2 p-1.5 bg-background-tertiary rounded text-[9px]"
                >
                  <span className="text-text-muted">#{index + 1}</span>
                  <span className="text-text-secondary">
                    {kf.time.toFixed(2)}s
                  </span>
                  <span className="text-primary font-mono">
                    {kf.speed.toFixed(2)}x
                  </span>
                  <button
                    onClick={() => handleRemoveKeyframe(kf.id)}
                    className="ml-auto p-0.5 text-text-muted hover:text-red-400"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-2 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">Freeze Frames</span>
        {freezeFrames.length > 0 && (
          <span className="ml-auto text-[9px] text-primary">
            {freezeFrames.length} freeze
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="space-y-2">
          <button
            onClick={handleCreateFreezeFrame}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] bg-primary/20 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            <Pause size={12} />
            Add Freeze Frame at Playhead
          </button>

          {freezeFrames.length > 0 && (
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {freezeFrames.map((ff) => (
                <div
                  key={ff.id}
                  className="flex items-center gap-2 p-1.5 bg-background-tertiary rounded text-[9px]"
                >
                  <Pause size={10} className="text-primary" />
                  <span className="text-text-secondary">
                    {ff.startTime.toFixed(2)}s
                  </span>
                  <span className="text-text-muted">for</span>
                  <span className="text-primary font-mono">
                    {ff.duration.toFixed(1)}s
                  </span>
                  <button
                    onClick={() => handleRemoveFreezeFrame(ff.id)}
                    className="ml-auto p-0.5 text-text-muted hover:text-red-400"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleReset}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] bg-background-tertiary border border-border text-text-secondary rounded-lg hover:border-red-500/50 hover:text-red-400 transition-colors"
      >
        <RotateCcw size={12} />
        Reset Speed & Effects
      </button>
    </div>
  );
};

export default SpeedRampSection;

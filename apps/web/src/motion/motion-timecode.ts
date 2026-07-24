const normalizeFps = (frameRate: number): number =>
  Number.isFinite(frameRate) && frameRate > 0 ? Math.round(frameRate) : 30;

export function formatMotionTimecode(seconds: number, frameRate: number): string {
  const fps = normalizeFps(frameRate);
  const totalFrames = Math.max(0, Math.round(Math.max(0, seconds) * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export function motionFrameNumber(seconds: number, frameRate: number): number {
  const fps = normalizeFps(frameRate);
  return Math.max(0, Math.round(Math.max(0, seconds) * fps));
}

export function formatMotionFrameLabel(seconds: number, frameRate: number): string {
  return motionFrameNumber(seconds, frameRate).toString().padStart(5, "0");
}

export function formatMotionFps(frameRate: number): string {
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return `${fps.toFixed(2)} fps`;
}

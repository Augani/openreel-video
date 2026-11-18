import type { Particle, ParticleEffect } from "./particle-types";
import type { Project } from "../types/project";

const TYPES = new Set([
  "dissolve",
  "explode",
  "implode",
  "confetti",
  "dust",
  "sparkle",
  "disintegrate",
  "pixelate",
  "shatter",
  "morph",
]);
const BLENDS = new Set(["normal", "add", "multiply", "screen"]);
const SHAPES = new Set(["point", "line", "circle", "rectangle", "sphere"]);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export function isParticleEffect(value: unknown): value is ParticleEffect {
  if (!value || typeof value !== "object") return false;
  const effect = value as ParticleEffect,
    c = effect.config;
  if (
    !c ||
    typeof effect.id !== "string" ||
    !effect.id ||
    (effect.seedId !== undefined && (typeof effect.seedId !== "string" || !effect.seedId)) ||
    typeof effect.clipId !== "string" ||
    !effect.clipId ||
    !TYPES.has(effect.type) ||
    typeof effect.enabled !== "boolean" ||
    !finite(effect.startTime) ||
    !finite(effect.duration) ||
    effect.duration <= 0 ||
    (effect.clipStartTime !== undefined && !finite(effect.clipStartTime))
  )
    return false;
  if (
    ![
      c.particleCount,
      c.speed,
      c.speedVariance,
      c.gravity,
      c.wind?.x,
      c.wind?.y,
      c.wind?.z,
      c.turbulence,
      c.size?.min,
      c.size?.max,
      c.opacity?.start,
      c.opacity?.end,
      c.lifetime?.min,
      c.lifetime?.max,
      c.emissionRate,
      c.emissionRadius,
      c.rotationSpeed,
      c.fadeIn,
      c.fadeOut,
    ].every(finite)
  )
    return false;
  return (
    Number.isInteger(c.particleCount) &&
    c.particleCount >= 0 &&
    c.particleCount <= 10000 &&
    c.speed >= 0 &&
    c.speedVariance >= 0 &&
    c.turbulence >= 0 &&
    c.emissionRate >= 0 &&
    c.emissionRate <= 10000 &&
    c.size.min >= 0 &&
    c.size.max >= c.size.min &&
    c.lifetime.min > 0 &&
    c.lifetime.max >= c.lifetime.min &&
    c.opacity.start >= 0 &&
    c.opacity.start <= 1 &&
    c.opacity.end >= 0 &&
    c.opacity.end <= 1 &&
    c.fadeIn >= 0 &&
    c.fadeOut >= 0 &&
    c.fadeIn <= 1 &&
    c.fadeOut <= 1 &&
    c.emissionRadius >= 0 &&
    Array.isArray(c.colors) &&
    c.colors.length > 0 &&
    c.colors.every(
      (color) =>
        typeof color === "string" && color.length > 0 && color.length <= 100,
    ) &&
    BLENDS.has(c.blendMode) &&
    SHAPES.has(c.emissionShape)
  );
}
function seedFor(id: string, index: number): number {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++)
    seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return (seed ^ Math.imul(index + 1, 2654435761)) >>> 0;
}
function randomSource(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let n = Math.imul(seed ^ (seed >>> 15), seed | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
/** Absolute-time sampling: seeking, reopening and export never share simulation state. */
export function sampleParticleEffect(
  effect: ParticleEffect,
  time: number,
  width: number,
  height: number,
): Particle[] {
  if (
    !isParticleEffect(effect) ||
    !effect.enabled ||
    !finite(time) ||
    !finite(width) ||
    !finite(height) ||
    width <= 0 ||
    height <= 0 ||
    time < effect.startTime ||
    time >= effect.startTime + effect.duration
  )
    return [];
  const c = effect.config,
    elapsed = time - effect.startTime,
    count = Math.min(c.particleCount, 10000);
  if (!count || !c.emissionRate) return [];
  const last = Math.floor(elapsed * c.emissionRate) - 1;
  if (!Number.isSafeInteger(last)) return [];
  const first = Math.max(
    0,
    Math.floor((elapsed - c.lifetime.max) * c.emissionRate),
  );
  const particles: Particle[] = [];
  for (let index = last; index >= first && particles.length < count; index--) {
    const rand = randomSource(seedFor(effect.seedId ?? effect.id, index)),
      range = (min: number, max: number) => min + rand() * (max - min);
    const lifetime = range(c.lifetime.min, c.lifetime.max),
      age = elapsed - (index + 1) / c.emissionRate;
    if (age < 0 || age >= lifetime) continue;
    let x = width / 2,
      y = height / 2,
      z = 0;
    if (c.emissionShape === "circle" || c.emissionShape === "sphere") {
      const angle = rand() * Math.PI * 2,
        radius = rand() * c.emissionRadius;
      if (c.emissionShape === "sphere") {
        const phi = Math.acos(2 * rand() - 1);
        x += radius * Math.sin(phi) * Math.cos(angle);
        y += radius * Math.sin(phi) * Math.sin(angle);
        z = radius * Math.cos(phi);
      } else {
        x += Math.cos(angle) * radius;
        y += Math.sin(angle) * radius;
      }
    } else if (c.emissionShape === "line" || c.emissionShape === "rectangle") {
      x += range(-c.emissionRadius, c.emissionRadius);
      if (c.emissionShape === "rectangle")
        y += range(-c.emissionRadius, c.emissionRadius);
    }
    const speed = c.speed + range(-c.speedVariance, c.speedVariance),
      angle = rand() * Math.PI * 2;
    let vx = Math.cos(angle) * speed * 0.5,
      vy = Math.sin(angle) * speed * 0.5,
      vz = 0;
    if (effect.type === "explode" || effect.type === "implode") {
      const dx = x - width / 2,
        dy = y - height / 2,
        dist = Math.hypot(dx, dy) || 1,
        sign = effect.type === "implode" ? -1 : 1;
      vx = ((sign * dx) / dist) * speed;
      vy = ((sign * dy) / dist) * speed;
      if (effect.type === "explode") {
        vx += range(-20, 20);
        vy += range(-20, 20);
        vz = range(-speed * 0.5, speed * 0.5);
      }
    } else if (effect.type === "confetti") {
      vx = range(-speed, speed);
      vy = -Math.abs(speed) * range(0.5, 1.5);
      vz = range(-speed * 0.3, speed * 0.3);
    } else if (effect.type === "dust" || effect.type === "sparkle") {
      vx = Math.cos(angle) * speed * 0.3;
      vy = Math.sin(angle) * speed * 0.3 - speed * 0.2;
      vz = range(-10, 10);
    } else if (effect.type === "disintegrate") {
      vx = range(-speed * 0.5, speed * 0.5);
      vy = -speed * range(0.3, 0.8);
      vz = range(-speed * 0.2, speed * 0.2);
    } else if (effect.type === "shatter") {
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed - speed * 0.5;
      vz = range(-speed * 0.5, speed * 0.5);
    }
    const color = c.colors[Math.floor(rand() * c.colors.length)],
      size = range(c.size.min, c.size.max),
      rotation = rand() * Math.PI * 2,
      rotationSpeed = range(-c.rotationSpeed, c.rotationSpeed),
      phase = rand() * Math.PI * 2;
    const life = age / lifetime,
      fadeIn = c.fadeIn,
      fadeOut = c.fadeOut;
    let opacity: number;
    if (fadeIn > 0 && life < fadeIn)
      opacity = (c.opacity.start * life) / fadeIn;
    else if (fadeOut > 0 && life > 1 - fadeOut)
      opacity =
        c.opacity.end +
        ((c.opacity.start - c.opacity.end) * (1 - life)) / fadeOut;
    else {
      const span = 1 - fadeIn - fadeOut;
      opacity =
        c.opacity.start +
        (c.opacity.end - c.opacity.start) *
          (span > 0 ? (life - fadeIn) / span : 0);
    }
    const turbulence = c.turbulence * age * 0.25;
    particles.push({
      id: `${effect.id}:${index}`,
      position: {
        x:
          x +
          vx * age +
          c.wind.x * age * age * 0.5 +
          Math.sin(phase + age * 3) * turbulence,
        y:
          y +
          vy * age +
          (c.gravity + c.wind.y) * age * age * 0.5 +
          Math.cos(phase + age * 3) * turbulence,
        z: z + vz * age + c.wind.z * age * age * 0.5,
      },
      velocity: {
        x: vx + c.wind.x * age,
        y: vy + (c.gravity + c.wind.y) * age,
        z: vz + c.wind.z * age,
      },
      acceleration: { x: c.wind.x, y: c.gravity + c.wind.y, z: c.wind.z },
      color,
      size,
      opacity: Math.max(0, Math.min(1, opacity)),
      rotation: rotation + rotationSpeed * age,
      rotationSpeed,
      lifetime,
      age,
      active: true,
    });
  }
  return particles.reverse();
}
interface ParticleOwner {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
}
function particleOwners(project: Project): ParticleOwner[] {
  return [
    ...project.timeline.tracks.flatMap((track) => track.clips),
    ...(project.textClips ?? []),
    ...(project.shapeClips ?? []),
    ...(project.svgClips ?? []),
    ...(project.stickerClips ?? []),
  ];
}
export function getParticleOwner(
  project: Project,
  id: string,
): ParticleOwner | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return clip;
  }
  return (
    project.textClips?.find((item) => item.id === id) ??
    project.shapeClips?.find((item) => item.id === id) ??
    project.svgClips?.find((item) => item.id === id) ??
    project.stickerClips?.find((item) => item.id === id)
  );
}
export function projectParticleEffects(project: Project, time?: number): ParticleEffect[] {
  if (!project.particleEffects?.length) return [];
  const visible = new Set(
    project.timeline.tracks
      .filter((track) => !track.hidden)
      .map((track) => track.id),
  );
  const owners = new Map(
    particleOwners(project)
      .filter((clip) => visible.has(clip.trackId))
      .map((clip) => [clip.id, clip]),
  );
  return (project.particleEffects ?? []).flatMap((effect) => {
    const clip = owners.get(effect.clipId);
    if (!clip || !isParticleEffect(effect) || (time !== undefined &&
      (time < clip.startTime || time >= clip.startTime + clip.duration))) return [];
    const offset = effect.startTime - (effect.clipStartTime ?? clip.startTime),
      startTime = clip.startTime + offset,
      duration = Math.min(effect.duration, clip.startTime + clip.duration - startTime);
    return duration > 0 ? [{ ...effect, startTime, duration }] : [];
  });
}
type ParticleContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;
/**
 * Draws the sampled particles of `effects` at `time` into `ctx`. `projectWidth` x `projectHeight` is the
 * space the emitters simulate in; the context is scaled from there to `width` x `height`. The one routine
 * behind the program monitor, the export and the particle preset cards.
 */
export function drawParticleEffects(
  ctx: ParticleContext,
  effects: readonly ParticleEffect[],
  time: number,
  width: number,
  height: number,
  projectWidth: number,
  projectHeight: number,
): number {
  let drawn = 0;
  ctx.save();
  ctx.scale(width / projectWidth, height / projectHeight);
  for (const effect of effects) {
    const particles = sampleParticleEffect(effect, time, projectWidth, projectHeight);
    ctx.globalCompositeOperation =
      effect.config.blendMode === "add"
        ? "lighter"
        : effect.config.blendMode === "normal"
          ? "source-over"
          : effect.config.blendMode;
    for (const particle of particles) {
      if (particle.opacity <= 0 || particle.size <= 0) continue;
      ctx.globalAlpha = particle.opacity;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(
        particle.position.x,
        projectHeight - particle.position.y,
        particle.size / 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      drawn++;
    }
  }
  ctx.restore();
  return drawn;
}
export function drawProjectParticles(
  ctx: ParticleContext,
  project: Project,
  time: number,
  width: number,
  height: number,
): number {
  if (
    !project.particleEffects?.length ||
    !finite(width) ||
    !finite(height) ||
    width <= 0 ||
    height <= 0 ||
    project.settings.width <= 0 ||
    project.settings.height <= 0
  )
    return 0;
  return drawParticleEffects(
    ctx,
    projectParticleEffects(project, time),
    time,
    width,
    height,
    project.settings.width,
    project.settings.height,
  );
}

import type { BoneKeyframe, BoneTrack, SkeletalClip } from "./animation";

function sampleTrack(
  bone: string,
  duration: number,
  samples: number,
  fn: (t: number) => { x: number; y: number; z: number },
): BoneTrack {
  const keyframes: BoneKeyframe[] = [];
  const count = Math.max(2, Math.floor(samples));
  for (let i = 0; i < count; i += 1) {
    const phase = i / (count - 1);
    keyframes.push({ time: phase * duration, rotation: fn(phase) });
  }
  return { bone, keyframes };
}

export interface WaveClipOptions {
  readonly upperArmBone: string;
  readonly forearmBone?: string;
  readonly duration?: number;
  readonly cycles?: number;
  readonly amplitude?: number;
  readonly raise?: number;
  readonly side?: "left" | "right";
}

export function proceduralWaveClip(options: WaveClipOptions): SkeletalClip {
  const duration = Math.max(0.2, options.duration ?? 2.2);
  const cycles = Math.max(1, options.cycles ?? 3);
  const amplitude = options.amplitude ?? 24;
  const sign = options.side === "left" ? 1 : -1;
  const raise = (options.raise ?? 140) * sign;
  const samples = Math.round(Math.max(8, cycles * 6));

  const tracks: BoneTrack[] = [
    sampleTrack(options.upperArmBone, duration, samples, (t) => ({
      x: 0,
      y: 0,
      z: t < 0.2 ? raise * (t / 0.2) : raise,
    })),
  ];
  if (options.forearmBone) {
    tracks.push(
      sampleTrack(options.forearmBone, duration, samples, (t) => ({
        x: 0,
        y: 0,
        z: (t < 0.2 ? raise * (t / 0.2) : raise) + Math.sin(t * cycles * Math.PI * 2) * amplitude,
      })),
    );
  }
  return { name: "wave", duration, tracks };
}

export interface IdleClipOptions {
  readonly spineBone: string;
  readonly headBone?: string;
  readonly duration?: number;
  readonly cycles?: number;
  readonly amplitude?: number;
}

export function proceduralIdleClip(options: IdleClipOptions): SkeletalClip {
  const duration = Math.max(0.5, options.duration ?? 4);
  const cycles = Math.max(0.5, options.cycles ?? 2);
  const amplitude = options.amplitude ?? 4;
  const samples = Math.round(Math.max(8, cycles * 8));
  const tracks: BoneTrack[] = [
    sampleTrack(options.spineBone, duration, samples, (t) => ({
      x: 0,
      y: Math.sin(t * cycles * Math.PI * 2) * amplitude,
      z: 0,
    })),
  ];
  if (options.headBone) {
    tracks.push(
      sampleTrack(options.headBone, duration, samples, (t) => ({
        x: Math.sin(t * cycles * Math.PI * 2 + Math.PI / 4) * amplitude * 1.2,
        y: 0,
        z: 0,
      })),
    );
  }
  return { name: "idle", duration, tracks };
}

export interface WalkClipOptions {
  readonly leftThighBone: string;
  readonly rightThighBone: string;
  readonly leftShinBone?: string;
  readonly rightShinBone?: string;
  readonly leftArmBone?: string;
  readonly rightArmBone?: string;
  readonly duration?: number;
  readonly steps?: number;
  readonly amplitude?: number;
}

export function proceduralWalkClip(options: WalkClipOptions): SkeletalClip {
  const duration = Math.max(0.4, options.duration ?? 1);
  const steps = Math.max(1, options.steps ?? 2);
  const amplitude = options.amplitude ?? 30;
  const samples = Math.round(Math.max(10, steps * 8));
  const swing = (t: number, phase: number): { x: number; y: number; z: number } => ({
    x: Math.sin(t * steps * Math.PI * 2 + phase) * amplitude,
    y: 0,
    z: 0,
  });
  const tracks: BoneTrack[] = [
    sampleTrack(options.leftThighBone, duration, samples, (t) => swing(t, 0)),
    sampleTrack(options.rightThighBone, duration, samples, (t) => swing(t, Math.PI)),
  ];
  if (options.leftShinBone) {
    tracks.push(
      sampleTrack(options.leftShinBone, duration, samples, (t) => ({
        x: Math.max(0, Math.sin(t * steps * Math.PI * 2 + Math.PI / 2)) * amplitude * 0.8,
        y: 0,
        z: 0,
      })),
    );
  }
  if (options.rightShinBone) {
    tracks.push(
      sampleTrack(options.rightShinBone, duration, samples, (t) => ({
        x: Math.max(0, Math.sin(t * steps * Math.PI * 2 + Math.PI + Math.PI / 2)) * amplitude * 0.8,
        y: 0,
        z: 0,
      })),
    );
  }
  if (options.leftArmBone) {
    tracks.push(sampleTrack(options.leftArmBone, duration, samples, (t) => swing(t, Math.PI)));
  }
  if (options.rightArmBone) {
    tracks.push(sampleTrack(options.rightArmBone, duration, samples, (t) => swing(t, 0)));
  }
  return { name: "walk", duration, tracks };
}

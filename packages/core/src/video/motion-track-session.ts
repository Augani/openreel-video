import { grayscale, trackMotionFramePair, type TrackingPixels } from "./motion-frame-tracker";
import { buildIntegral, captureTemplate, searchTemplate, type IntegralImage, type ReferenceTemplate } from "./motion-template-search";
import type { Point, Rectangle, TrackingOptions } from "./motion-tracking-engine";

export interface TrackSessionFrame extends TrackingPixels {
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface TrackSessionConfig {
  /** Region at the anchor frame, in source pixels. */
  region: Rectangle;
  algorithm?: NonNullable<TrackingOptions["algorithm"]>;
  confidenceThreshold?: number;
  initialScale?: number;
  initialRotation?: number;
}

/**
 * tracked    - measured frame-to-frame (possibly with a drift correction)
 * reacquired - the target returned and was found again from the reference template
 * predicted  - the target is not visible; the position is extrapolated from its last velocity
 */
export type TrackStatus = "tracked" | "reacquired" | "predicted";

export interface TrackStep {
  /** Source pixels. */
  position: Point;
  scale: number;
  rotation: number;
  confidence: number;
  status: TrackStatus;
  /** True when confidence is below the threshold (predicted, or a weak measurement). */
  lost: boolean;
}

const DRIFT_INTERVAL = 2;
const DRIFT_SNAP_MARGIN = 0.03;
const DRIFT_BLEND_MIN = 0.8;
const DRIFT_BLEND = 0.5;
const DRIFT_SCALES = [0.94, 0.97, 1, 1.03, 1.06];
/** A weak (below-threshold) measurement is only believed when the target's reference appearance is also found there. */
const WEAK_TEMPLATE_MIN = 0.4;
const VELOCITY_DECAY = 0.85;
const BASE_SEARCH = 16;
const WIDE_SEARCH = 56;
/** Below this a frame-to-frame measurement is not trusted at all and the target is treated as hidden. */
const MEASURE_FLOOR = 0.35;

/**
 * Stateful, frame-sequential tracker. Frame-to-frame registration does the moving; the reference
 * template from the anchor frame corrects accumulated drift, re-finds the target after an occlusion
 * (coarse-to-fine, multi-scale) and a velocity model carries the position through frames where the
 * target cannot be seen. Pure and DOM-free so it runs identically in a worker or on the main thread.
 */
export class MotionTrackSession {
  private readonly threshold: number;
  private readonly algorithm: NonNullable<TrackingOptions["algorithm"]>;
  private previous: TrackSessionFrame | null = null;
  private region: Rectangle | null = null;
  private template: ReferenceTemplate | null = null;
  private readonly templateScale: number;
  private scale: number;
  private rotation: number;
  private lostRun = 0;
  private velocity: Point = { x: 0, y: 0 };
  private center: Point = { x: 0, y: 0 };
  private frameCount = 0;

  constructor(private readonly config: TrackSessionConfig) {
    this.threshold = config.confidenceThreshold ?? 0.7;
    this.algorithm = config.algorithm ?? "correlation";
    this.scale = this.templateScale = config.initialScale ?? 1;
    this.rotation = config.initialRotation ?? 0;
  }

  async step(frame: TrackSessionFrame): Promise<TrackStep> {
    const sx = frame.width / (frame.sourceWidth ?? frame.width), sy = frame.height / (frame.sourceHeight ?? frame.height);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) throw new Error("Tracking frame dimensions are invalid");
    const gray = grayscale(frame);
    let integral: IntegralImage | null = null;
    const integralOf = (): IntegralImage => integral ??= buildIntegral(gray, frame.width, frame.height);
    const clampRegion = (centerX: number, centerY: number, width: number, height: number): Rectangle => {
      const w = Math.min(frame.width - 8, width), h = Math.min(frame.height - 8, height);
      return { x: Math.max(4, Math.min(frame.width - w - 4, centerX - w / 2)), y: Math.max(4, Math.min(frame.height - h - 4, centerY - h / 2)), width: w, height: h };
    };
    const emit = (confidence: number, status: TrackStatus): TrackStep => {
      this.frameCount++;
      return { position: { x: this.center.x / sx, y: this.center.y / sy }, scale: this.scale, rotation: this.rotation, confidence, status, lost: confidence < this.threshold };
    };

    if (!this.region) {
      const { region } = this.config;
      const width = Math.min(frame.width - 8, region.width * sx), height = Math.min(frame.height - 8, region.height * sy);
      if (width < 8 || height < 8) throw new Error("Choose a larger tracking region");
      this.region = { x: Math.max(4, Math.min(frame.width - width - 4, region.x * sx)), y: Math.max(4, Math.min(frame.height - height - 4, region.y * sy)), width, height };
      this.template = captureTemplate(integralOf(), this.region);
      const motion = await trackMotionFramePair(frame, frame, this.region, this.algorithm, BASE_SEARCH);
      if (motion.confidence < this.threshold) throw new Error("Choose a textured region with clear visual detail");
      this.previous = frame;
      this.center = { x: this.region.x + this.region.width / 2, y: this.region.y + this.region.height / 2 };
      return emit(motion.confidence, "tracked");
    }

    const region = this.region;
    if (this.lostRun === 0 && this.previous) {
      const floor = Math.min(this.threshold, MEASURE_FLOOR);
      const hint = { x: Math.round(this.velocity.x), y: Math.round(this.velocity.y) };
      // Cheapest first: a narrow window around the last position. Widen (coarse to fine, centred on the
      // velocity prediction) only when that does not give a confident match, so a look-alike never wins by search size.
      let motion = await trackMotionFramePair(this.previous, frame, region, this.algorithm, BASE_SEARCH);
      if (motion.confidence < this.threshold) {
        const wide = await trackMotionFramePair(this.previous, frame, region, this.algorithm, WIDE_SEARCH, hint);
        // A weak wide match must not displace a weak-but-plausible narrow one: look-alike texture scores like this.
        if (wide.confidence >= this.threshold || (wide.confidence > motion.confidence && motion.confidence < floor)) motion = wide;
        else if (wide.confidence >= floor && this.template) {
          // Two weak candidates: the one that looks like the target (reference appearance) wins, not the one that stayed put.
          const appearance = (candidate: typeof motion): number => searchTemplate(this.template!, integralOf(), {
            center: { x: Math.round(candidate.position.x), y: Math.round(candidate.position.y) }, radius: 2, step: 1,
            baseRatio: this.scale * candidate.scale / this.templateScale,
          })?.score ?? -1;
          const wideLooks = appearance(wide);
          if (wideLooks > appearance(motion) + 0.15) motion = wideLooks >= 0.8 ? { ...wide, confidence: Math.max(wide.confidence, this.threshold) } : wide;
        }
      }
      // A target that is only partly visible still measures: accept it, report the confidence honestly (it shows as low-confidence).
      if (motion.confidence >= floor && motion.confidence < this.threshold && this.template) {
        const at = { x: Math.round(motion.position.x), y: Math.round(motion.position.y) };
        // A pixel or two either side is the same appearance: the measurement is rounded, the reference is not.
        const seen = searchTemplate(this.template, integralOf(), { center: at, radius: 2, step: 1, baseRatio: this.scale * motion.scale / this.templateScale });
        if (!seen || seen.score < WEAK_TEMPLATE_MIN) motion = { ...motion, confidence: 0 };
      }
      if (motion.confidence >= floor) {
        const before = this.center;
        this.scale *= motion.scale;
        this.rotation += motion.rotation;
        let position = { x: motion.position.x, y: motion.position.y };
        // Drift check against the anchor appearance. Position random-walks when integrated frame to
        // frame; the reference template pins it. Snap only when it clearly fits better close by.
        if (this.template && this.frameCount % DRIFT_INTERVAL === 0) {
          const at = { x: Math.round(position.x), y: Math.round(position.y) }, baseRatio = this.scale / this.templateScale;
          const here = searchTemplate(this.template, integralOf(), { center: at, radius: 0, baseRatio });
          // Scales are tried too: a partly covered target makes the frame-to-frame fit shrink the region, and
          // the reference template pins both position and size.
          const near = searchTemplate(this.template, integralOf(), { center: at, radius: 4, baseRatio, step: 1, scales: DRIFT_SCALES });
          if (near && near.score >= 0.6 && near.score > (here?.score ?? -1) + DRIFT_SNAP_MARGIN) {
            position = near.position;
            this.scale = Math.max(0.2, Math.min(5, near.ratio * this.templateScale));
          } else if (near && near.score >= DRIFT_BLEND_MIN) {
            // A good (not clearly better) template fit still carries no accumulated drift: pull gently toward it.
            position = { x: position.x + DRIFT_BLEND * (near.position.x - position.x), y: position.y + DRIFT_BLEND * (near.position.y - position.y) };
            this.scale += DRIFT_BLEND * (Math.max(0.2, Math.min(5, near.ratio * this.templateScale)) - this.scale);
          }
        }
        this.region = clampRegion(position.x, position.y, region.width * motion.scale, region.height * motion.scale);
        this.center = position;
        // Velocity follows the measured frame-to-frame motion, not the drift correction applied on top of it.
        this.velocity = { x: 0.5 * this.velocity.x + 0.5 * (motion.position.x - before.x), y: 0.5 * this.velocity.y + 0.5 * (motion.position.y - before.y) };
        this.previous = frame;
        return emit(motion.confidence, "tracked");
      }
      this.lostRun = 1;
      this.advancePrediction();
      return emit(motion.confidence, "predicted");
    }

    // Target not visible: look for it again in a window that grows with the time it has been gone.
    let found: ReturnType<typeof searchTemplate> = null;
    if (this.template) {
      const wide = this.lostRun > 12;
      found = searchTemplate(this.template, integralOf(), {
        center: wide ? { x: Math.round(frame.width / 2), y: Math.round(frame.height / 2) } : { x: Math.round(this.center.x), y: Math.round(this.center.y) },
        radius: wide ? Math.max(frame.width, frame.height) / 2 : Math.min(120, 28 + this.lostRun * 8),
        scales: [0.85, 1, 1.18], baseRatio: this.scale / this.templateScale,
      });
    }
    if (found && found.score >= Math.max(0.6, this.threshold - 0.05)) {
      const grow = found.ratio;
      this.scale = Math.max(0.2, Math.min(5, grow * this.templateScale));
      const base = this.config.region;
      this.region = clampRegion(found.position.x, found.position.y, base.width * sx * grow, base.height * sy * grow);
      this.center = { ...found.position };
      this.velocity = { x: 0, y: 0 };
      this.previous = frame;
      this.lostRun = 0;
      return emit(Math.min(1, found.score), "reacquired");
    }
    this.lostRun++;
    this.advancePrediction();
    this.center = { x: Math.max(0, Math.min(frame.width, this.center.x)), y: Math.max(0, Math.min(frame.height, this.center.y)) };
    return emit(Math.max(0, found?.score ?? 0) * 0.5, "predicted");
  }

  private advancePrediction(): void {
    this.center = { x: this.center.x + this.velocity.x, y: this.center.y + this.velocity.y };
    this.velocity = { x: this.velocity.x * VELOCITY_DECAY, y: this.velocity.y * VELOCITY_DECAY };
  }
}

/**
 * Preview-only plumbing shared by the comparison view and the HSL Secondary
 * matte view. None of this state reaches the project, the render cache or an
 * export: the export pipeline never consults it.
 */

export interface ProgramFrameControl {
  /**
   * Render `time` onto the Program canvas and resolve once it has been
   * presented (or the render gave up). `scrubbing` lets a frame commit even
   * though the playhead is elsewhere.
   */
  renderAt(time: number, options: { scrubbing: boolean }): Promise<void>;
}

let control: ProgramFrameControl | null = null;

export function registerProgramFrameControl(next: ProgramFrameControl | null): void {
  control = next;
}

export function getProgramFrameControl(): ProgramFrameControl | null {
  return control;
}

/** Re-render the current paused frame (no-op when no Program monitor is mounted). */
export async function refreshProgramFrame(time: number): Promise<void> {
  await control?.renderAt(time, { scrubbing: false });
}

let bypassColor = false;

/** While true the preview skips effects and color grading ("ungraded" frame). */
export function setColorBypass(bypass: boolean): void {
  bypassColor = bypass;
}

export function isColorBypassed(): boolean {
  return bypassColor;
}

/**
 * The effect as the preview should render it: stored params plus the
 * preview-only matte-view override. Tolerates partial bridge doubles.
 */
export function withPreviewOverrides<T extends { id: string; params: Record<string, unknown> }>(
  bridge: { withTransientParams?: <E extends { id: string; params: Record<string, unknown> }>(effect: E) => E },
  effect: T,
): T {
  return typeof bridge.withTransientParams === "function" ? bridge.withTransientParams(effect) : effect;
}

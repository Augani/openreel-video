/**
 * A hardware/software video encoder can fail once for reasons that are not about the project: the OS reclaims
 * the encoder session while the machine is busy, a hardware session cannot be opened, the GPU process restarts.
 * Chrome reports every such failure as a DOMException named "EncodingError" ("Encoding error.") or
 * "QuotaExceededError" ("Codec reclaimed due to inactivity" / too many active codecs). Re-running the same job
 * from scratch succeeds, so the queue runs the job once more before it shows a failure.
 */
const TRANSIENT_NAMES = new Set(["EncodingError", "QuotaExceededError"]);
const TRANSIENT_MESSAGE = /\b(encoding error|codec reclaimed|reclaimed due to)\b/i;

export function isTransientEncoderError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (typeof name === "string" && TRANSIENT_NAMES.has(name)) return true;
  // The export engine wraps encoder errors into plain { code, message } objects or Errors.
  return typeof message === "string" && TRANSIENT_MESSAGE.test(message);
}

export interface EncoderRetryOptions {
  /** Total runs including the first (default 2). */
  readonly attempts?: number;
  /** Called before each re-run; return false to stop retrying (cancelled). */
  readonly shouldRetry?: (error: unknown, nextAttempt: number) => boolean;
  readonly delayMs?: number;
}

/** `run` receives the 1-based attempt number so a re-run can change strategy (e.g. fall back to a software encoder). */
export async function runWithEncoderRetry<T>(run: (attempt: number) => Promise<T>, options: EncoderRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 2;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= attempts || !isTransientEncoderError(error) || options.shouldRetry?.(error, attempt + 1) === false) throw error;
      console.warn(`[export-queue] transient encoder failure (${(error as { message?: string }).message ?? error}); running the job again (attempt ${attempt + 1} of ${attempts}).`);
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 500));
    }
  }
}

/** A re-run only helps when it can change something: an explicit Hardware choice would repeat the same failing encoder. */
export function canRetryInSoftware(encoderChoice: string | undefined): boolean {
  return encoderChoice !== "hardware";
}

export function hardwareEncoderFailureMessage(error: unknown): string {
  const detail = (error as { message?: unknown } | null)?.message;
  const reason = typeof detail === "string" && detail ? detail : "the hardware encoder failed";
  return `The hardware encoder failed (${reason}). Hardware was chosen in the export settings, so the export was not retried in software. Choose Auto or Software and export again.`;
}

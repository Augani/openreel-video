interface RendererCrashInput {
  message: string;
  stack?: string;
  type?: string;
  context?: unknown;
}

const DEDUPE_MS = 5000;
const recent = new Map<string, number>();

export function reportRendererCrash(input: RendererCrashInput): void {
  try {
    const crash = window.openreel?.crash;
    if (!crash) return;
    const message = input.message?.slice(0, 8000);
    if (!message) return;
    const type = input.type ?? "renderer-error";
    const key = `${type}:${message}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(key, now);
    crash.report({ message, stack: input.stack, type, context: input.context });
  } catch {
    // The reporter must never throw.
  }
}

export function installRendererCrashHandlers(): () => void {
  const onError = (event: ErrorEvent): void => {
    const error = event.error as { message?: string; stack?: string } | undefined;
    reportRendererCrash({
      type: "window-error",
      message: event.message || error?.message || "window error",
      stack: error?.stack,
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason as { message?: string; stack?: string } | undefined;
    reportRendererCrash({
      type: "unhandledrejection",
      message: reason?.message ?? String(event.reason),
      stack: reason?.stack,
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

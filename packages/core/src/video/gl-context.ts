/**
 * Chrome keeps roughly 16 live WebGL contexts per page and force-loses the OLDEST one past that, which can be the
 * Program monitor's. A context is only released when its canvas is garbage collected, so engines that are disposed
 * (or one-off support probes) must give theirs back explicitly.
 */

export interface GLContextCounters {
  /** Contexts handed out through trackGLContext since the page loaded. */
  created: number;
  /** Contexts explicitly released through releaseGLContext. */
  released: number;
}

const counters: GLContextCounters = { created: 0, released: 0 };
const tracked = new WeakSet<object>();

/** Registers a context an engine created, so e2e / diagnostics can bound the live count. Returns it unchanged. */
export function trackGLContext<T extends WebGL2RenderingContext | WebGLRenderingContext>(gl: T): T {
  if (!tracked.has(gl)) {
    tracked.add(gl);
    counters.created += 1;
  }
  return gl;
}

/** Live (created and not yet released) engine-owned WebGL contexts, plus the running totals. */
export function getGLContextCounters(): GLContextCounters & { live: number } {
  return { ...counters, live: counters.created - counters.released };
}

/** Test hook: zero the counters. */
export function resetGLContextCounters(): void {
  counters.created = 0;
  counters.released = 0;
}

/** Frees a WebGL context right now (WEBGL_lose_context) instead of waiting for the garbage collector. Idempotent. */
export function releaseGLContext(gl: WebGL2RenderingContext | WebGLRenderingContext | null | undefined): void {
  if (!gl) return;
  try {
    if (gl.isContextLost()) {
      if (tracked.delete(gl)) counters.released += 1;
      return;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    // Throwaway support probes are released too but were never counted as engine contexts.
    if (tracked.delete(gl)) counters.released += 1;
  } catch {
    // Best effort: a context that cannot be released will be collected with its canvas.
  }
}

import { describe, expect, it, vi } from "vitest";
import { getGLContextCounters, releaseGLContext, resetGLContextCounters, trackGLContext } from "./gl-context";

const fakeGl = (lost = false) => {
  const loseContext = vi.fn();
  const gl = { isContextLost: () => lost, getExtension: vi.fn(() => ({ loseContext })) } as unknown as WebGL2RenderingContext;
  return { gl, loseContext };
};

describe("engine-owned WebGL context accounting", () => {
  it("counts a context live until it is released, and releases through WEBGL_lose_context", () => {
    resetGLContextCounters();
    const a = fakeGl();
    const b = fakeGl();
    trackGLContext(a.gl);
    trackGLContext(b.gl);
    expect(getGLContextCounters().live).toBe(2);
    releaseGLContext(a.gl);
    expect(a.loseContext).toHaveBeenCalledTimes(1);
    expect(getGLContextCounters()).toMatchObject({ created: 2, released: 1, live: 1 });
  });

  it("ignores null and already-lost contexts, and never throws", () => {
    resetGLContextCounters();
    releaseGLContext(null);
    const lost = fakeGl(true);
    releaseGLContext(lost.gl);
    expect(lost.loseContext).not.toHaveBeenCalled();
    // A tracked context the browser already lost (evicted / device loss) stops counting as live.
    trackGLContext(lost.gl);
    releaseGLContext(lost.gl);
    expect(getGLContextCounters().live).toBe(0);
    resetGLContextCounters();
    const throwing = { isContextLost: () => { throw new Error("boom"); } } as unknown as WebGL2RenderingContext;
    expect(() => releaseGLContext(throwing)).not.toThrow();
    expect(getGLContextCounters().released).toBe(0);
  });

  it("does not count the release of an untracked support probe", () => {
    resetGLContextCounters();
    releaseGLContext(fakeGl().gl);
    expect(getGLContextCounters()).toMatchObject({ created: 0, released: 0, live: 0 });
  });
});

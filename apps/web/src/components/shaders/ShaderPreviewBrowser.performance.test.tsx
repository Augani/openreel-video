import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMotionShaderDef, type MotionShaderDef } from "@openreel/core";
import { MotionShaderRenderer } from "@openreel/core/motion/motion-shader-renderer";
import { ShaderPreviewBrowser } from "./ShaderPreviewBrowser";

const renderShader = vi.fn();
type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];
type IdleCallback = Parameters<typeof window.requestIdleCallback>[0];

const observers: Array<{ callback: ObserverCallback; target?: Element }> = [];
const idleJobs = new Map<number, IdleCallback>();
let nextJob = 0;

function show(index: number) {
  const observer = observers[index];
  act(() =>
    observer.callback(
      [
        {
          target: observer.target!,
          isIntersecting: true,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    ),
  );
}

function flushIdle() {
  act(() => {
    for (const [id, callback] of [...idleJobs]) {
      idleJobs.delete(id);
      callback({ didTimeout: false, timeRemaining: () => 20 });
    }
  });
}

beforeEach(() => {
  observers.length = 0;
  idleJobs.clear();
  renderShader
    .mockReset()
    .mockImplementation(() => document.createElement("canvas"));
  vi.spyOn(MotionShaderRenderer.prototype, "render").mockImplementation(
    renderShader,
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: (typeof observers)[number];
      constructor(callback: ObserverCallback) {
        this.entry = { callback };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {}
    },
  );
  vi.stubGlobal("requestIdleCallback", (callback: IdleCallback) => {
    const id = ++nextJob;
    idleJobs.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => idleJobs.delete(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function definition(id = "glyph-dissolve"): MotionShaderDef {
  return { ...getMotionShaderDef(id)! };
}

describe("shader browser rendering budget", () => {
  it("keeps every material selectable while compiling only visible thumbnails during idle time", () => {
    const defs = [definition(), definition("watercolor")];
    const select = vi.fn();
    render(<ShaderPreviewBrowser defs={defs} onSelect={select} />);
    expect(
      screen.getByRole("button", { name: "Preview and select Watercolor" }),
    ).toBeEnabled();
    expect(renderShader).not.toHaveBeenCalled();
    expect(document.querySelectorAll('canvas[data-preview-state="pending"]')).toHaveLength(2);
    show(0);
    expect(renderShader).not.toHaveBeenCalled();
    flushIdle();
    expect(renderShader).toHaveBeenCalledOnce();
    expect(renderShader.mock.calls[0][0].id).toBe("glyph-dissolve");
    expect(document.querySelectorAll('canvas[data-preview-state="ready"]')).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Preview and select Watercolor" }),
    );
    expect(select).toHaveBeenCalledWith("watercolor");
    expect(renderShader).toHaveBeenCalledOnce();
  });

  it("reuses completed thumbnails after navigation and keeps text/effect samples separate", () => {
    const def = definition();
    const view = render(
      <ShaderPreviewBrowser defs={[def]} onSelect={() => {}} />,
    );
    show(0);
    flushIdle();
    view.unmount();
    render(<ShaderPreviewBrowser defs={[def]} onSelect={() => {}} />);
    show(1);
    flushIdle();
    expect(renderShader).toHaveBeenCalledOnce();
    expect(document.querySelector('canvas[data-preview-source="cache"]')).not.toBeNull();
    cleanup();
    render(
      <ShaderPreviewBrowser defs={[def]} sample="effect" onSelect={() => {}} />,
    );
    show(2);
    flushIdle();
    expect(renderShader).toHaveBeenCalledTimes(2);
  });

  it("cancels queued work when its inspector closes, including a late observer delivery", () => {
    const view = render(
      <ShaderPreviewBrowser defs={[definition()]} onSelect={() => {}} />,
    );
    show(0);
    expect(idleJobs.size).toBe(1);
    view.unmount();
    expect(idleJobs.size).toBe(0);
    show(0);
    flushIdle();
    expect(renderShader).not.toHaveBeenCalled();
  });
});

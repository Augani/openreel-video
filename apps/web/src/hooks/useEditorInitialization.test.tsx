import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorInitialization } from "./useEditorInitialization";
import { useEngineStore } from "../stores/engine-store";

const bridges = vi.hoisted(() => ({
  media: vi.fn(async () => undefined),
  playback: vi.fn(async () => undefined),
  render: vi.fn(async () => undefined),
  effects: vi.fn(async () => undefined),
  transition: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../bridges/media-bridge", () => ({ initializeMediaBridge: bridges.media, disposeMediaBridge: bridges.dispose }));
vi.mock("../bridges/playback-bridge", () => ({ initializePlaybackBridge: bridges.playback, disposePlaybackBridge: bridges.dispose }));
vi.mock("../bridges/render-bridge", () => ({ initializeRenderBridge: bridges.render, disposeRenderBridge: bridges.dispose }));
vi.mock("../bridges/effects-bridge", () => ({ initializeEffectsBridge: bridges.effects, disposeEffectsBridge: bridges.dispose }));
vi.mock("../bridges/transition-bridge", () => ({ initializeTransitionBridge: bridges.transition, disposeTransitionBridge: bridges.dispose }));
vi.mock("../stores/project-store", () => ({ useProjectStore: { getState: () => ({ project: { settings: { width: 1080, height: 1920 } } }) } }));
vi.mock("../stores/engine-store", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({
    initialized: false, initializing: false, initError: null as string | null, currentFrame: null,
    initialize: vi.fn(async () => {
      store.setState({ initializing: true, initError: null });
      await Promise.resolve();
      store.setState({ initialized: true, initializing: false });
    }),
  }));
  return { useEngineStore: store };
});

describe("editor initialization lifetime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEngineStore.setState({ initialized: false, initializing: false, initError: null });
  });
  afterEach(cleanup);

  it("keeps bridges alive as initialization flags change, without rendering for frame updates", async () => {
    let renders = 0;
    const { result, unmount } = renderHook(() => { renders++; return useEditorInitialization(); });
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(useEngineStore.getState().initialize).toHaveBeenCalledOnce();
    expect(bridges.playback).toHaveBeenCalledOnce();
    expect(bridges.effects).toHaveBeenCalledWith(1080, 1920);
    expect(bridges.dispose).not.toHaveBeenCalled();

    const previousRenders = renders;
    act(() => {
      for (let i = 0; i < 60; i++) useEngineStore.setState({ currentFrame: null });
    });
    expect(renders).toBe(previousRenders);
    expect(bridges.dispose).not.toHaveBeenCalled();
    unmount();
    expect(bridges.dispose).toHaveBeenCalledTimes(5);
  });

  it("completes startup under StrictMode without duplicate bridge initialization", async () => {
    const { result } = renderHook(useEditorInitialization, { wrapper: StrictMode });
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(useEngineStore.getState().initialize).toHaveBeenCalledOnce();
    expect(bridges.media).toHaveBeenCalledOnce();
    expect(bridges.playback).toHaveBeenCalledOnce();
  });

  it("stops waiting on an in-progress engine when the editor unmounts", async () => {
    useEngineStore.setState({ initializing: true });
    const { unmount } = renderHook(useEditorInitialization);
    unmount();
    await act(async () => useEngineStore.setState({ initialized: true, initializing: false }));
    expect(bridges.media).not.toHaveBeenCalled();
  });

  it("can retry a failed startup without reloading the project", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(useEngineStore.getState().initialize).mockImplementationOnce(async () => {
      useEngineStore.setState({ initError: "Device temporarily unavailable", initializing: false });
      throw new Error("Device temporarily unavailable");
    });
    const { result } = renderHook(useEditorInitialization);
    await waitFor(() => expect(result.current.initError).toBe("Device temporarily unavailable"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.initError).toBeNull();
    expect(bridges.playback).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
});

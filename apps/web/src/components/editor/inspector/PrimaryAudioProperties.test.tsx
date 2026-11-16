import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { PrimaryAudioProperties } from "./PrimaryAudioProperties";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { useUIStore } from "../../../stores/ui-store";

// A stand-in for the offline mixdown renderer: a stereo 1 kHz sine at -26 dBFS,
// which measures -26.0 LUFS (EBU Tech 3341 case 1 shape), scaled by clip volume.
vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    getAudioEngine: () => ({
      isInitialized: () => true,
      initialize: async () => undefined,
      renderAudio: async (
        project: import("@openreel/core").Project,
        _start: number,
        duration: number,
      ) => {
        const volume = project.timeline.tracks[0].clips[0].volume;
        const rate = 48000;
        // A steady tone measures the same at any length >= one gating block; 3 s keeps the real
        // K-weighting + gating pass (the code under test) cheap enough not to time out under load.
        const data = new Float32Array(Math.round(Math.min(duration, 3) * rate));
        const gain = volume * Math.pow(10, -26 / 20);
        for (let i = 0; i < data.length; i++) data[i] = gain * Math.sin((2 * Math.PI * 1000 * i) / rate);
        return {
          buffer: { sampleRate: rate, numberOfChannels: 2, getChannelData: () => data },
        };
      },
    }),
  };
});

const clip: Clip = {
  id: "music",
  trackId: "track",
  mediaId: "media",
  startTime: 5,
  duration: 10,
  inPoint: 0,
  outPoint: 10,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    rotation: 0,
    opacity: 1,
  },
};
const current = () => useProjectStore.getState().getClip("music")!;
beforeEach(() => {
  useProjectStore.getState().createNewProject("Audio QA");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 15,
        tracks: [
          {
            id: "track",
            type: "audio",
            name: "Music",
            role: "music",
            clips: [clip],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    },
  });
  useTimelineStore.setState({ playheadPosition: 7, playbackState: "stopped" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("primary audio properties", () => {
  it.each([undefined, { fadeIn: 2, fadeOut: 3, origin: { offset: 1, duration: 12 } }])("restores the complete fade state through the real inspector and Undo/Redo %#", async (fade) => {
    const store = useProjectStore.getState(), project = store.project;
    if (fade) useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: [{ ...project.timeline.tracks[0], clips: [{ ...clip, fade }] }],
    } } });
    const original = structuredClone(current());
    render(<PrimaryAudioProperties clipId="music" />);
    const field = screen.getByRole("spinbutton", { name: "Fade in value" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "1.5" } });
    fireEvent.blur(field);
    await waitFor(() => expect(current().fade?.fadeIn).toBe(1.5));
    const changed = structuredClone(current());
    expect(changed.fade?.fadeOut).toBe(fade?.fadeOut ?? 0);
    if (fade) expect(changed.fade?.origin).toEqual({ ...fade.origin, fadeIn: false });
    await act(async () => { await store.undo(); });
    expect(current()).toEqual(original);
    await act(async () => { await store.redo(); });
    expect(current()).toEqual(changed);
  });

  it("persists frame-positioned volume automation, edits it in dB, and undoes the edit", async () => {
    render(<PrimaryAudioProperties clipId="music" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add volume keyframe" }),
    );
    await waitFor(() =>
      expect(current().automation?.volume).toEqual([{ time: 2, value: 1 }]),
    );
    const field = screen.getByRole("spinbutton", { name: "Volume value" });
    fireEvent.change(field, { target: { value: "-12" } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(current().automation?.volume?.[0].value).toBeCloseTo(
        Math.pow(10, -12 / 20),
      ),
    );
    expect(current().volume).toBe(1);
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(current().automation?.volume).toEqual([{ time: 2, value: 1 }]);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove volume keyframe" }),
    );
    await waitFor(() => expect(current().automation?.volume).toEqual([]));
  });
  it("does not create automation for a static level edit or allow a keyframe outside the clip", async () => {
    render(<PrimaryAudioProperties clipId="music" />);
    const field = screen.getByRole("spinbutton", { name: "Volume value" });
    fireEvent.change(field, { target: { value: "-6" } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(current().volume).toBeCloseTo(Math.pow(10, -6 / 20)),
    );
    expect(current().automation?.volume).toBeUndefined();
    act(() => useTimelineStore.getState().seekTo(0));
    expect(
      screen.getByRole("button", { name: "Add volume keyframe" }),
    ).toBeDisabled();
  });

  it("undoes a held-key volume automation adjustment in one step and keeps the next edit separate", async () => {
    const store = useProjectStore.getState();
    await store.executeAction({ id: "automation", timestamp: Date.now(), type: "audio/addAutomation", params: { clipId: "music", points: [{ time: 2, value: 1 }] } });
    store.actionHistory.clear();
    render(<PrimaryAudioProperties clipId="music" />);
    const slider = screen.getByRole("slider", { name: "Volume" });
    await act(async () => {
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      fireEvent.keyDown(slider, { key: "ArrowLeft", repeat: true });
      fireEvent.keyDown(slider, { key: "ArrowLeft", repeat: true });
      fireEvent.keyUp(slider, { key: "ArrowLeft" });
    });
    const adjusted = structuredClone(current().automation);
    expect(adjusted?.volume?.[0].value).toBeLessThan(1);
    const fade = screen.getByRole("spinbutton", { name: "Fade in value" });
    fireEvent.focus(fade);
    fireEvent.change(fade, { target: { value: "1.5" } });
    fireEvent.blur(fade);
    await waitFor(() => expect(current().fade?.fadeIn).toBe(1.5));
    await act(async () => { await store.undo(); });
    expect(current().automation).toEqual(adjusted);
    await act(async () => { await store.undo(); });
    expect(current().automation?.volume).toEqual([{ time: 2, value: 1 }]);
    expect(store.canUndo()).toBe(false);
  });

  it("Normalize loudness measures the clip, sets its gain to the target and undoes in one step", async () => {
    render(<PrimaryAudioProperties clipId="music" />);
    expect(screen.queryByRole("switch", { name: "Normalize loudness" })).toBeNull();
    const history = useProjectStore.getState().actionHistory;
    const before = history.getUndoStackSize();
    fireEvent.click(screen.getByRole("button", { name: "Normalize loudness" }));
    // -26 LUFS measured -> -14 LUFS target = +12 dB of clip gain.
    await waitFor(() =>
      expect(current().volume).toBeCloseTo(Math.pow(10, 12 / 20), 2),
    );
    expect(screen.getByTestId("normalize-loudness-status").textContent).toMatch(
      /-26\.0 → -14\.0 LUFS \(\+12\.0 dB\)/,
    );
    expect(history.getUndoStackSize()).toBe(before + 1);
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(current().volume).toBe(1);
  });

  it("adds a persisted noise reduction effect and removes it with ordinary Undo", async () => {
    render(<PrimaryAudioProperties clipId="music" />);
    fireEvent.click(screen.getByRole("switch", { name: "Noise reduction" }));
    await waitFor(() =>
      expect(
        current().audioEffects.some(
          (effect) => effect.type === "noiseReduction" && effect.enabled,
        ),
      ).toBe(true),
    );
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(current().audioEffects).toEqual([]);
  });
  it("applies Enhance to the extracted audible WAV when the selected video is muted", async () => {
    const project = useProjectStore.getState().project;
    const video = {
      ...clip,
      id: "video",
      trackId: "main",
      mediaId: "original-video",
      volume: 0,
    };
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            {
              ...project.timeline.tracks[0],
              id: "main",
              name: "Main",
              type: "video",
              clips: [video],
            },
            {
              ...project.timeline.tracks[0],
              clips: [
                {
                  ...clip,
                  metadata: {
                    separatedFromClipId: video.id,
                    sourceAudioTrackIndex: 0,
                  },
                },
              ],
            },
          ],
        },
      },
    });
    render(<PrimaryAudioProperties clipId={video.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Normalize loudness" }));
    // The muted video's extracted audio clip is the one measured and gained.
    await waitFor(() => expect(current().volume).toBeGreaterThan(1));
    expect(useProjectStore.getState().getClip(video.id)?.volume).toBe(0);
    for (const [label, sectionId] of [
      ["Noise reduction", "background-noise-removal"],
      ["Auto-duck under dialogue", "audio-ducking"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(useInspectorNavigationStore.getState().request).toMatchObject({
        clipId: clip.id,
        sectionId,
      });
      expect(useUIStore.getState().getSelectedClipIds()).toEqual([clip.id]);
    }
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(current().audioEffects).toEqual([]);
  });
});

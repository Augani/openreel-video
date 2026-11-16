import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { ClipComponent } from "./ClipComponent";
import { PrimaryAudioProperties } from "../inspector/PrimaryAudioProperties";
import { useProjectStore } from "../../../stores/project-store";
const video: Clip = {
  id: "video-clip",
  trackId: "main",
  mediaId: "video",
  startTime: 0,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
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
const track: Track = {
  id: "main",
  name: "Main",
  type: "video",
  clips: [video],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
};
const media: MediaItem = {
  id: "video",
  name: "Source.mp4",
  type: "video",
  blob: null,
  fileHandle: null,
  thumbnailUrl: "blob:thumbnail",
  waveformData: new Float32Array([0, 0.8, 0.5, 0]),
  metadata: {
    duration: 4,
    width: 640,
    height: 360,
    frameRate: 30,
    codec: "h264",
    sampleRate: 48000,
    channels: 2,
    fileSize: 0,
  },
};
const noop = () => undefined;
afterEach(cleanup);
describe("timeline waveform visibility", () => {
  it("draws persisted fades from inspector edits and restores the display with Undo", async () => {
    useProjectStore.getState().createNewProject("Fade display");
    const project = useProjectStore.getState().project;
    const audio = {
      ...video,
      id: "music",
      trackId: "music-track",
      mediaId: "audio",
      volume: Math.pow(10, -12 / 20),
    };
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            {
              ...track,
              id: audio.trackId,
              type: "audio",
              role: "music",
              clips: [audio],
            },
          ],
        },
        mediaLibrary: {
          items: [{ ...media, id: "audio", type: "audio", name: "Music.wav" }],
        },
      },
    });
    function Timeline() {
      const tracks = useProjectStore((state) => state.project.timeline.tracks);
      return (
        <ClipComponent
          clip={tracks[0].clips[0]}
          track={tracks[0]}
          allTracks={tracks}
          pixelsPerSecond={50}
          scrollX={0}
          viewportWidth={1000}
          isSelected={false}
          trackHeights={new Map([[audio.trackId, 50]])}
          timelineRef={{ current: null }}
          onSelect={noop}
          onMoveClip={noop}
          onSnapIndicator={noop}
        />
      );
    }
    const view = render(
      <>
        <PrimaryAudioProperties clipId={audio.id} />
        <Timeline />
      </>,
    );
    const curve = () =>
      view.container.querySelector("[data-clip-fade] polyline");
    expect(curve()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Select clip Music.wav" }),
    ).toHaveTextContent("Music.wav · −12 dB");
    const fadeIn = screen.getByRole("spinbutton", { name: "Fade in value" });
    fireEvent.change(fadeIn, { target: { value: "2" } });
    fireEvent.blur(fadeIn);
    await waitFor(() => expect(curve()).not.toBeNull());
    expect(useProjectStore.getState().getClip(audio.id)?.fade?.fadeIn).toBe(2);
    expect(curve()?.getAttribute("points")).toBe("4,26 100,14 196,14");
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(curve()).toBeNull();
    const fadeOut = screen.getByRole("spinbutton", { name: "Fade out value" });
    fireEvent.change(fadeOut, { target: { value: "1" } });
    fireEvent.blur(fadeOut);
    await waitFor(() =>
      expect(useProjectStore.getState().getClip(audio.id)?.fade?.fadeOut).toBe(
        1,
      ),
    );
    expect(curve()?.getAttribute("points")).toBe("4,14 148,14 196,26");
  });

});

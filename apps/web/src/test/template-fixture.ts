import { TitleEngine, type Project } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";

export function templateProjectFixture(name = "Template source"): Project {
  const project = createEmptyProject(
    name,
    { width: 640, height: 360, frameRate: 24 },
    true,
  );
  const title = new TitleEngine().createTextClip({
    id: "shaded-title",
    text: "Measured motion",
    trackId: project.timeline.tracks[0].id,
    startTime: 0,
    duration: 2,
    style: {
      shader: {
        shaderId: "paper-mesh-gradient",
        params: { color1: "#ee44aa" },
        progress: 0.37,
      },
    },
  });
  for (let index = 0; index < 33; index++)
    title.keyframes.push({
      id: `tracking-${index}`,
      time: index / 24,
      property: "position.x",
      value: index / 64,
      easing: "linear",
    });
  const video = project.timeline.tracks[1];
  return {
    ...project,
    textClips: [title],
    mediaLibrary: {
      items: [
        {
          id: "original-media",
          name: "Original.mp4",
          type: "video",
          blob: new Blob(["original bytes"], { type: "video/mp4" }),
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            width: 320,
            height: 180,
            duration: 2,
            frameRate: 24,
            codec: "h264",
            sampleRate: 48000,
            channels: 2,
            fileSize: 14,
          },
        },
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 2,
      tracks: project.timeline.tracks.map((track) =>
        track.id !== video.id
          ? track
          : {
              ...track,
              clips: [
                {
                  id: "footage",
                  mediaId: "original-media",
                  trackId: track.id,
                  startTime: 0,
                  duration: 2,
                  inPoint: 0,
                  outPoint: 2,
                  transform: title.transform,
                  effects: [],
                  audioEffects: [],
                  keyframes: [],
                  volume: 0,
                },
              ],
            },
      ),
    },
  };
}

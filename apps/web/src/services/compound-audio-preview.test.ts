import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip, Project, RenderedAudio } from "@openreel/core";
import {
  CompoundAudioPreview,
  compoundAudioSignature,
  type CompoundAudioOwner,
} from "./compound-audio-preview";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
function project(): Project {
  const leaf: Clip = {
    id: "leaf",
    trackId: "inner",
    mediaId: "source",
    startTime: 0,
    duration: 20,
    inPoint: 0,
    outPoint: 20,
    volume: 0.75,
    transform,
    effects: [],
    audioEffects: [],
    keyframes: [],
  };
  const inner = {
    id: "inner",
    name: "inner",
    type: "video" as const,
    clips: [leaf],
    transitions: [],
    hidden: false,
    muted: false,
    solo: false,
    locked: false,
  };
  const proxy = {
    ...leaf,
    id: "proxy",
    trackId: "root",
    mediaId: "compound:definition",
    volume: 0.25,
  };
  return {
    id: "project",
    name: "Project",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 30,
      sampleRate: 8000,
      channels: 2,
    },
    timeline: {
      duration: 20,
      subtitles: [],
      markers: [],
      tracks: [{ ...inner, id: "root", clips: [proxy] }],
    },
    mediaLibrary: {
      items: [
        {
          id: "source",
          name: "source.wav",
          type: "audio",
          blob: new Blob(["source"]),
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 20,
            sampleRate: 8000,
            channels: 2,
            hasAudio: true,
            width: 0,
            height: 0,
            frameRate: 0,
            fileSize: 6,
            codec: "pcm",
          },
        },
      ],
    },
    compoundClips: [
      {
        id: "definition",
        name: "Scene",
        color: "#8b5cf6",
        createdAt: 0,
        modifiedAt: 0,
        content: { tracks: [inner], clips: [leaf], duration: 20 },
      },
    ],
  };
}
const audio = (start: number, duration: number): RenderedAudio => ({
  startTime: start,
  duration,
  channels: 2,
  sampleRate: 8000,
  buffer: {
    duration,
    length: duration * 8000,
    numberOfChannels: 2,
    sampleRate: 8000,
  } as AudioBuffer,
});
function fixture(maxBytes?: number) {
  const owner: CompoundAudioOwner = {
    project: project(),
    actionExecutor: {},
    hasOpenProject: true,
  };
  const renderer = {
    initialize: vi.fn(async () => {}),
    renderAudio: vi.fn(
      async (
        _project: Project,
        start: number,
        duration: number,
        _options?: { preview?: boolean },
      ) => audio(start, duration),
    ),
    dispose: vi.fn(async () => {}),
  };
  const create = vi.fn(() => renderer);
  const service = new CompoundAudioPreview(() => owner, create, 4, 2, maxBytes);
  return { owner, renderer, create, service };
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe("bounded owned compound audio preview", () => {
  it("does not bake the live-applied track or master rack into the pre-mix", async () => {
    const { owner, service, renderer } = fixture();
    const rack = { effects: [{ id: "g", type: "gain" as const, params: { gainDb: -6 }, bypassed: false }] };
    const withRacks: Project = {
      ...owner.project,
      timeline: {
        ...owner.project.timeline,
        masterAudioRack: rack,
        tracks: owner.project.timeline.tracks.map((t) => ({ ...t, audioRack: rack })),
      },
    };
    owner.project = withRacks;
    await service.prepareAt(withRacks, 0);
    const [renderProject] = renderer.renderAudio.mock.calls[0];
    expect(renderProject.timeline.masterAudioRack).toBeUndefined();
    expect(renderProject.timeline.tracks[0].audioRack).toBeUndefined();
  });
  it("does not bake the live-applied track volume/pan automation into the pre-mix", async () => {
    const { owner, service, renderer } = fixture();
    const automation = {
      volume: [{ id: "v", time: 0, value: 0.5, easing: "linear" as const }],
      pan: [{ id: "p", time: 0, value: 0.5, easing: "linear" as const }],
    };
    const automated: Project = {
      ...owner.project,
      timeline: {
        ...owner.project.timeline,
        tracks: owner.project.timeline.tracks.map((t) => ({ ...t, automation })),
      },
    };
    owner.project = automated;
    await service.prepareAt(automated, 0);
    const [renderProject] = renderer.renderAudio.mock.calls[0];
    expect(renderProject.timeline.tracks[0].automation).toBeUndefined();
  });
  it("renders only the current range and schedules an already processed unity-rate window", async () => {
    const { owner, service, renderer } = fixture();
    await service.prepareAt(owner.project, 0);
    expect(renderer.renderAudio).toHaveBeenCalledOnce();
    const [renderProject, start, duration] = renderer.renderAudio.mock.calls[0];
    expect([start, duration]).toEqual([0, 4]);
    expect(renderProject.timeline.tracks[0].clips[0].volume).toBe(0.25);
    expect(service.schedulesAt(owner.project, 0)).toMatchObject([
      {
        trackId: "root",
        startTime: 0,
        endTime: 4,
        volume: 1,
        speed: 1,
        effects: [],
        volumeAutomation: [],
      },
    ]);
    await service.dispose();
  });
  it("deduplicates concurrent warmup requests", async () => {
    const { owner, service, renderer } = fixture();
    await Promise.all([
      service.prepareAt(owner.project, 0),
      service.prepareAt(owner.project, 0),
    ]);
    expect(renderer.initialize).toHaveBeenCalledOnce();
    expect(renderer.renderAudio).toHaveBeenCalledOnce();
    await service.dispose();
  });
  it("reuses audio when project/compound names, visual effects and waveforms change", async () => {
    const { owner, service, renderer } = fixture();
    await service.prepareAt(owner.project, 0);
    const before = compoundAudioSignature(owner.project),
      original = owner.project;
    owner.project = {
      ...original,
      name: "unrelated payload".repeat(10000),
      compoundClips: original.compoundClips!.map((clip) => ({
        ...clip,
        name: "Renamed",
      })),
      mediaLibrary: {
        items: original.mediaLibrary.items.map((item) => ({
          ...item,
          waveformData: new Float32Array(10000),
        })),
      },
      timeline: {
        ...original.timeline,
        tracks: original.timeline.tracks.map((track) => ({
          ...track,
          name: "Renamed",
          clips: track.clips.map((clip) => ({
            ...clip,
            transform: { ...clip.transform, rotation: 90 },
            effects: [
              {
                id: "look",
                type: "blur",
                enabled: true,
                params: { radius: 12 },
              },
            ],
          })),
        })),
      },
    };
    expect(compoundAudioSignature(owner.project)).toBe(before);
    expect(before.length).toBeLessThan(5000);
    await service.prepareAt(owner.project, 0);
    expect(renderer.renderAudio).toHaveBeenCalledOnce();
    await service.dispose();
  });
  it("invalidates a changed audio parameter and a replaced source blob with the same media id", async () => {
    const { owner, service, renderer } = fixture();
    await service.prepareAt(owner.project, 0);
    const first = owner.project;
    owner.project = {
      ...first,
      timeline: {
        ...first.timeline,
        tracks: first.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => ({ ...clip, volume: 0.5 })),
        })),
      },
    };
    await service.prepareAt(owner.project, 0);
    const second = owner.project;
    owner.project = {
      ...second,
      mediaLibrary: {
        items: second.mediaLibrary.items.map((item) => ({
          ...item,
          blob: new Blob(["replacement"]),
        })),
      },
    };
    await service.prepareAt(owner.project, 0);
    expect(renderer.renderAudio).toHaveBeenCalledTimes(3);
    expect(renderer.initialize).toHaveBeenCalledOnce();
    await service.dispose();
  });
  it("trims the last preview window to the clip end", async () => {
    const { owner, service, renderer } = fixture();
    const original = owner.project;
    owner.project = {
      ...original,
      timeline: {
        ...original.timeline,
        tracks: original.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => ({ ...clip, duration: 9.5 })),
        })),
      },
    };
    await service.prepareAt(owner.project, 9);
    expect(renderer.renderAudio.mock.calls[0].slice(1, 3)).toEqual([8, 1.5]);
    expect(service.schedulesAt(owner.project, 9)[0].endTime).toBe(9.5);
    await service.dispose();
  });
  it("warms the next window without retaining an entire long compound", async () => {
    const { owner, service, renderer } = fixture();
    await service.prepareAt(owner.project, 3);
    await vi.waitFor(() =>
      expect(renderer.renderAudio).toHaveBeenCalledTimes(2),
    );
    expect(
      renderer.renderAudio.mock.calls.map((call) => call.slice(1, 3)),
    ).toEqual([
      [0, 4],
      [4, 4],
    ]);
    await vi.waitFor(() => expect(service.stats().windows).toBe(2));
    expect(service.stats().bytes).toBe(2 * 4 * 8000 * 2 * 4);
    await service.dispose();
  });
  it("evicts obsolete windows under budget pressure without dropping the required current window", async () => {
    const { owner, service } = fixture(1);
    await service.prepareAt(owner.project, 0);
    await service.prepareAt(owner.project, 5);
    expect(service.stats().windows).toBe(1);
    expect(service.schedulesAt(owner.project, 5)[0].startTime).toBe(4);
    await service.dispose();
  });
  it("skips inaudible roots and does not create an audio renderer for a regular unity-speed clip", async () => {
    const { owner, service, create } = fixture();
    const original = owner.project;
    owner.project = {
      ...original,
      timeline: {
        ...original.timeline,
        tracks: original.timeline.tracks.map((track) => ({
          ...track,
          muted: true,
        })),
      },
    };
    await service.prepareAt(owner.project, 0);
    expect(create).not.toHaveBeenCalled();
    owner.project = {
      ...original,
      timeline: {
        ...original.timeline,
        tracks: original.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => ({ ...clip, mediaId: "source" })),
        })),
      },
    };
    await service.prepareAt(owner.project, 0);
    expect(create).not.toHaveBeenCalled();
    await service.dispose();
  });
  it("routes ordinary speed/reverse audio through the same canonical bounded renderer", async () => {
    const { owner, service, renderer } = fixture();
    const original = owner.project;
    owner.project = {
      ...original,
      timeline: {
        ...original.timeline,
        tracks: original.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => ({
            ...clip,
            mediaId: "source",
            speed: 2,
            reversed: true,
          })),
        })),
      },
    };
    await service.prepareAt(owner.project, 0);
    expect(
      renderer.renderAudio.mock.calls[0][0].timeline.tracks[0].clips[0],
    ).toMatchObject({ speed: 2, reversed: true });
    expect(service.schedulesAt(owner.project, 0)[0].speed).toBe(1);
    await service.dispose();
  });
  it.each(["project", "same-id-reload", "closed"])(
    "rejects late publication after %s",
    async (reason) => {
      const { owner, service, renderer } = fixture();
      let resolve!: (audio: RenderedAudio) => void;
      renderer.renderAudio.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const pending = service.prepareAt(owner.project, 0);
      await vi.waitFor(() =>
        expect(renderer.renderAudio).toHaveBeenCalledOnce(),
      );
      if (reason === "project")
        owner.project = { ...owner.project, id: "another" };
      if (reason === "same-id-reload") owner.actionExecutor = {};
      if (reason === "closed") owner.hasOpenProject = false;
      resolve(audio(0, 4));
      await pending;
      expect(service.stats().windows).toBe(0);
      await service.dispose();
      expect(renderer.dispose).toHaveBeenCalledOnce();
    },
  );
  it("retries initialization with a fresh owned renderer after a failure", async () => {
    const { owner, service, renderer, create } = fixture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValue(1000);
    renderer.initialize.mockRejectedValueOnce(new Error("unavailable decoder"));
    await service.prepareAt(owner.project, 0);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(service.stats().windows).toBe(0);
    expect(renderer.renderAudio).not.toHaveBeenCalled();
    vi.mocked(Date.now).mockReturnValue(3001);
    await service.prepareAt(owner.project, 0);
    expect(create).toHaveBeenCalledTimes(2);
    expect(service.stats().windows).toBe(1);
    await service.dispose();
    expect(renderer.dispose).toHaveBeenCalledTimes(2);
  });
  it("starts a replacement owner without waiting for obsolete decoding and joins retired cleanup", async () => {
    const { owner, service, renderer, create } = fixture();
    let resolve!: (audio: RenderedAudio) => void;
    renderer.renderAudio.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = service.prepareAt(owner.project, 0);
    await vi.waitFor(() => expect(renderer.renderAudio).toHaveBeenCalledOnce());
    const replacement = {
      initialize: vi.fn(async () => {}),
      renderAudio: vi.fn(
        async (
          _project: Project,
          start: number,
          duration: number,
          _options?: { preview?: boolean },
        ) => audio(start, duration),
      ),
      dispose: vi.fn(async () => {}),
    };
    create.mockReturnValueOnce(replacement);
    owner.actionExecutor = {};
    await service.prepareAt(owner.project, 0);
    expect(replacement.renderAudio).toHaveBeenCalledOnce();
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(service.schedulesAt(owner.project, 0)[0].audioBuffer).toBe(
      (await replacement.renderAudio.mock.results[0].value).buffer,
    );
    let disposed = false;
    const disposing = service.dispose().then(() => {
      disposed = true;
    });
    await vi.waitFor(() => expect(replacement.dispose).toHaveBeenCalledOnce());
    expect(disposed).toBe(false);
    resolve(audio(0, 4));
    await pending;
    await disposing;
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(service.stats().windows).toBe(0);
  });
  it("recreates the renderer with the project audio format", async () => {
    const { owner, service, renderer, create } = fixture();
    await service.prepareAt(owner.project, 0);
    expect(create).toHaveBeenLastCalledWith(owner.project.settings);
    owner.project = {
      ...owner.project,
      settings: { ...owner.project.settings, sampleRate: 48000, channels: 1 },
    };
    await service.prepareAt(owner.project, 0);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ sampleRate: 48000, channels: 1 }),
    );
    await service.dispose();
    expect(renderer.dispose).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Project } from "../types";
import { prepareClipSplit } from "../editing/clip-fragments";
import { applyTimelineToolEdits } from "../editing/timeline-tool-edit";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("animated image Split rendering", () => {
  it.each([false, true])(
    "retains the same looping frame in normal and transition decoders, reversed=%s",
    async (reversed) => {
      vi.stubGlobal("self", {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const { VideoEngine } = await import("./video-engine"),
        engine = new VideoEngine();
      const clip: Clip = {
        id: "gif",
        trackId: "main",
        mediaId: "image",
        startTime: 10,
        duration: 4,
        inPoint: 2,
        outPoint: 10,
        speed: 2,
        reversed,
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
      const media: MediaItem = {
        id: "image",
        name: "Loop.gif",
        type: "image",
        blob: new Blob(["gif"], { type: "image/gif" }),
        fileHandle: null,
        thumbnailUrl: null,
        waveformData: null,
        metadata: {
          duration: 2,
          width: 640,
          height: 360,
          frameRate: 2,
          sampleRate: 0,
          channels: 0,
          codec: "gif",
          fileSize: 3,
        },
      };
      const project: Project = {
        id: "gif-project",
        name: "Animated image",
        createdAt: 0,
        modifiedAt: 0,
        settings: {
          width: 640,
          height: 360,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2,
        },
        mediaLibrary: { items: [media] },
        timeline: {
          duration: 14,
          markers: [],
          subtitles: [],
          tracks: [
            {
              id: "main",
              name: "Main",
              type: "video",
              hidden: false,
              locked: false,
              muted: false,
              solo: false,
              transitions: [],
              clips: [clip],
            },
          ],
        },
      };
      let pixels: string[] = [];
      const canvas = { width: 640, height: 360 },
        ctx = {
          canvas,
          fillRect: vi.fn(() => {
            pixels = [];
          }),
          clearRect: vi.fn(() => {
            pixels = [];
          }),
          save: vi.fn(),
          restore: vi.fn(),
          drawImage: vi.fn(),
        };
      const frames = [0, 1, 2, 3].map((i) => ({
        tag: `frame-${i}`,
        width: 640,
        height: 360,
        close: vi.fn(),
      }));
      Object.assign(engine, {
        ensureInitialized: vi.fn(),
        compositeCanvas: canvas,
        compositeCtx: ctx,
        gifFrameCache: new Map([
          [
            media.id,
            { frames, delays: [500, 500, 500, 500], totalDuration: 2000 },
          ],
        ]),
        applyClipVideoProcessing: vi.fn(async (_id, image) => image),
        drawClipFrameToContext: vi.fn(async (_ctx, image) => {
          pixels.push(image.tag);
        }),
      });
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({
          width: 640,
          height: 360,
          tags: [...pixels],
          close: vi.fn(),
        })),
      );
      const after = applyTimelineToolEdits(
        project,
        prepareClipSplit(project, "gif", 11.5, "cut").edits,
      );
      const decoder = engine as unknown as {
        decodeClipBitmap(
          clip: Clip,
          media: MediaItem,
          time: number,
          width: number,
          height: number,
        ): Promise<{ tag: string }>;
      };
      for (const time of [10, 10.125, 11.49, 11.5, 11.75, 12.25, 13.99]) {
        const source = 2 + (reversed ? 4 - (time - 10) : time - 10) * 2;
        const expected = `frame-${Math.floor((source % 2) / 0.5)}`;
        const piece = after.timeline.tracks[0].clips.find(
          (item) =>
            time >= item.startTime && time < item.startTime + item.duration,
        )!;
        expect(
          (await decoder.decodeClipBitmap(piece, media, time, 640, 360)).tag,
        ).toBe(expected);
        const rendered = await engine.renderFrame(after, time);
        expect((rendered.image as unknown as { tags: string[] }).tags).toEqual([
          expected,
        ]);
      }
      expect(frames.every((frame) => frame.close.mock.calls.length === 0)).toBe(
        true,
      );
    },
  );
});

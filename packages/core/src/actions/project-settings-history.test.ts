import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import { ActionHistory } from "./action-history";
import type { Project } from "../types/project";

describe("project settings history with existing media", () => {
  it("restores all settings through Undo and Redo while retaining the actual media and waveform", async () => {
    const blob = new Blob(["existing media"]);
    const waveform = new Float32Array(100000).fill(0.25);
    const project: Project = {
      id: "settings-project",
      name: "Preserved content",
      createdAt: 1,
      modifiedAt: 1,
      settings: {
        width: 3840,
        height: 2160,
        frameRate: 24,
        sampleRate: 48000,
        channels: 2,
      },
      mediaLibrary: {
        items: [
          {
            id: "source",
            name: "source.wav",
            type: "audio",
            blob,
            fileHandle: null,
            thumbnailUrl: null,
            waveformData: waveform,
            metadata: {
              duration: 2,
              sampleRate: 48000,
              channels: 2,
              width: 0,
              height: 0,
              frameRate: 0,
              codec: "pcm",
              fileSize: blob.size,
            },
          },
        ],
      },
      timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
    };
    const original = { ...project.settings },
      media = project.mediaLibrary;
    const next = {
      width: 1080,
      height: 1920,
      frameRate: 60,
      sampleRate: 44100,
      channels: 1,
    };
    const history = new ActionHistory(),
      executor = new ActionExecutor(history);
    expect(
      (
        await executor.execute(
          {
            type: "project/updateSettings",
            id: "format",
            timestamp: 2,
            params: next,
          },
          project,
        )
      ).success,
    ).toBe(true);
    expect(project.settings).toEqual(next);
    expect(history.getUndoStackSize()).toBe(1);
    expect((await executor.undo(project)).success).toBe(true);
    expect(project.settings).toEqual(original);
    expect((await executor.redo(project)).success).toBe(true);
    expect(project.settings).toEqual(next);
    expect(project.mediaLibrary).toBe(media);
    expect(project.mediaLibrary.items[0].blob).toBe(blob);
    expect(project.mediaLibrary.items[0].waveformData).toBe(waveform);
    expect(project.mediaLibrary.items[0].waveformData?.[99999]).toBe(0.25);
  });

  it("undo removes an optional working colour space the project did not have before", async () => {
    const project: Project = {
      id: "colour-space",
      name: "Colour space",
      createdAt: 1,
      modifiedAt: 1,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [] },
      timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
    };
    const history = new ActionHistory(),
      executor = new ActionExecutor(history);
    await executor.execute(
      { type: "project/updateSettings", id: "cs", timestamp: 2, params: { workingColorSpace: "rec2020" } },
      project,
    );
    expect(project.settings.workingColorSpace).toBe("rec2020");
    await executor.undo(project);
    expect(project.settings.workingColorSpace).toBeUndefined();
    await executor.redo(project);
    expect(project.settings.workingColorSpace).toBe("rec2020");
  });

  it("undo clears the HDR graphics white the project did not have before", async () => {
    const project: Project = {
      id: "graphics-white",
      name: "Graphics white",
      createdAt: 1,
      modifiedAt: 1,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2, workingColorSpace: "rec2020" },
      mediaLibrary: { items: [] },
      timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
    };
    const history = new ActionHistory(),
      executor = new ActionExecutor(history);
    await executor.execute(
      { type: "project/updateSettings", id: "gw", timestamp: 2, params: { graphicsWhiteNits: 300 } },
      project,
    );
    expect(project.settings.graphicsWhiteNits).toBe(300);
    await executor.undo(project);
    expect(project.settings.graphicsWhiteNits).toBeUndefined();
    await executor.redo(project);
    expect(project.settings.graphicsWhiteNits).toBe(300);
  });
});

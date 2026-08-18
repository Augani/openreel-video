import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { ProjectState } from "../project-store";
import { useEngineStore } from "../engine-store";
import { splitCaptionIntoSingleLineCues } from "@openreel/core";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type SubtitleSlice = Pick<
  ProjectState,
  | "addSubtitle"
  | "removeSubtitle"
  | "updateSubtitle"
  | "getSubtitle"
  | "importSRT"
  | "exportSRT"
  | "applySubtitleStylePreset"
  | "getSubtitleStylePresets"
>;

export function createSubtitleSlice(set: Set, get: Get): SubtitleSlice {
  return {
    addSubtitle: async (subtitle, metadata) => {
      const { project, addTrack, createTextClip } = get();

      let captionsTrack = project.timeline.tracks.find(
        (t) => t.type === "text" && t.name === "Captions",
      );

      if (!captionsTrack) {
        const result = await addTrack("text");
        if (!result?.success) return;

        const updatedProject = get().project;
        const newTracks = updatedProject.timeline.tracks.filter(
          (t) =>
            t.type === "text" &&
            !project.timeline.tracks.some((old) => old.id === t.id),
        );
        captionsTrack = newTracks[0];

        if (captionsTrack) {
          set((state) => ({
            project: {
              ...state.project,
              timeline: {
                ...state.project.timeline,
                tracks: state.project.timeline.tracks.map((t) =>
                  t.id === captionsTrack!.id ? { ...t, name: "Captions" } : t,
                ),
              },
            },
          }));
          captionsTrack = { ...captionsTrack, name: "Captions" };
        }
      }

      if (!captionsTrack) return;

      const duration = subtitle.endTime - subtitle.startTime;
      const style = subtitle.style;

      createTextClip(
        captionsTrack.id,
        subtitle.startTime,
        subtitle.text,
        duration,
        style
          ? {
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              color: style.color,
              backgroundColor: style.backgroundColor || undefined,
            }
          : undefined,
        metadata,
      );
      if (typeof metadata?.captionSourceClipId === "string") {
        const sourceTrack = get().project.timeline.tracks.find((track) =>
          track.clips.some((clip) => clip.id === metadata.captionSourceClipId),
        );
        if (sourceTrack) get().groupTracks(sourceTrack.id, captionsTrack.id);
      }
    },

    removeSubtitle: (subtitleId) => {
      void get().executeAction({
        type: "subtitle/remove",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { subtitleId },
      });
    },

    updateSubtitle: (subtitleId, updates) => {
      const current = get().project.timeline.subtitles.find(
        (s) => s.id === subtitleId,
      );
      if (!current) return;
      void get().executeAction({
        type: "subtitle/replace",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { subtitleId, subtitle: { ...current, ...updates } },
      });
    },

    getSubtitle: (subtitleId) =>
      get().project.timeline.subtitles.find((s) => s.id === subtitleId),

    importSRT: async (
      srtContent: string,
      options?: { sourceClipId?: string; maxWordsPerLine?: number },
    ) => {
      const subtitleEngine = await useEngineStore
        .getState()
        .getSubtitleEngine();
      const { project, addSubtitle } = get();
      const { result } = subtitleEngine.importSRT(project.timeline, srtContent);
      const errorMessages = result.errors.map(
        (err: { line: number; message: string }) =>
          `Line ${err.line}: ${err.message}`,
      );

      if (result.subtitles.length === 0) {
        return {
          success: false,
          errors:
            errorMessages.length > 0
              ? errorMessages
              : ["No valid subtitles were found in this SRT file."],
        };
      }

      for (const subtitle of result.subtitles) {
        const maxWordsPerLine = options?.maxWordsPerLine;
        const cues = maxWordsPerLine
          ? splitCaptionIntoSingleLineCues(
              subtitle.text,
              subtitle.startTime,
              subtitle.endTime,
              maxWordsPerLine,
            )
          : [subtitle];
        for (const cue of cues) {
          await addSubtitle(
            {
              ...subtitle,
              text: cue.text,
              startTime: cue.startTime,
              endTime: cue.endTime,
            },
            {
              captionSource: normalizedCaptionSource(srtContent),
              captionSourceClipId: options?.sourceClipId,
              captionMaxWordsPerLine: maxWordsPerLine,
            },
          );
        }
      }

      return { success: true, errors: errorMessages };
    },

    exportSRT: async () => {
      const subtitleEngine = await useEngineStore
        .getState()
        .getSubtitleEngine();
      const { project } = get();
      const captionsTrackIds = new Set(
        project.timeline.tracks
          .filter((track) => track.type === "text" && track.name === "Captions")
          .map((track) => track.id),
      );
      const subtitles = get()
        .getAllTextClips()
        .filter(
          (clip) =>
            captionsTrackIds.has(clip.trackId) ||
            typeof clip.metadata?.captionSource === "string",
        )
        .map((clip) => ({
          id: clip.id,
          text: clip.text,
          startTime: clip.startTime,
          endTime: clip.startTime + clip.duration,
          style: {
            fontFamily: clip.style.fontFamily,
            fontSize: clip.style.fontSize,
            color: clip.style.color,
            backgroundColor: clip.style.backgroundColor ?? "transparent",
            position: "bottom" as const,
          },
        }));
      return subtitleEngine.exportSRT({ ...project.timeline, subtitles });
    },

    applySubtitleStylePreset: async (presetName: string) => {
      const subtitleEngine = await useEngineStore
        .getState()
        .getSubtitleEngine();

      const preset = subtitleEngine.getStylePreset(presetName);
      if (!preset) {
        console.error(`Unknown style preset: ${presetName}`);
        return false;
      }
      const captionsTrackIds = new Set(
        get().project.timeline.tracks
          .filter((track) => track.type === "text" && track.name === "Captions")
          .map((track) => track.id),
      );
      for (const clip of get().getAllTextClips()) {
        if (!captionsTrackIds.has(clip.trackId)) continue;
        get().updateTextStyle(clip.id, {
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          color: preset.color,
          backgroundColor: preset.backgroundColor,
        });
      }
      return true;
    },

    getSubtitleStylePresets: async () => {
      const subtitleEngine = await useEngineStore
        .getState()
        .getSubtitleEngine();
      return subtitleEngine.getStylePresets();
    },
  };
}

function normalizedCaptionSource(content: string): "srt" | "vtt" {
  return content.replace(/^\uFEFF/, "").trimStart().startsWith("WEBVTT")
    ? "vtt"
    : "srt";
}

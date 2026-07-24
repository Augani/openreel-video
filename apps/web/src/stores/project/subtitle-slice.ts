import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { ProjectState } from "../project-store";
import { useEngineStore } from "../engine-store";

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
    addSubtitle: async (subtitle) => {
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
      );
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

    importSRT: async (srtContent: string) => {
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
        await addSubtitle(subtitle);
      }

      return { success: true, errors: errorMessages };
    },

    exportSRT: async () => {
      const subtitleEngine = await useEngineStore
        .getState()
        .getSubtitleEngine();
      return subtitleEngine.exportSRT(get().project.timeline);
    },

    applySubtitleStylePreset: async (presetName: string) => {
      const subtitleEngine = await useEngineStore
        .getState()
        .getSubtitleEngine();

      const { project } = get();
      const result = subtitleEngine.applyStylePreset(
        project.timeline,
        presetName,
      );

      if ("error" in result) {
        console.error(result.error);
        return false;
      }

      const priorSubtitles = project.timeline.subtitles.map((s) => ({ ...s }));
      set({
        project: {
          ...project,
          timeline: result.timeline,
          modifiedAt: Date.now(),
        },
        clipRedoStack: [],
        templateRedoStack: [],
      });
      const actionId = uuidv4();
      get()
        .actionExecutor.getHistory()
        .push(
          {
            type: "subtitle/setAll",
            id: actionId,
            timestamp: Date.now(),
            params: { subtitles: result.timeline.subtitles },
          },
          {
            type: "subtitle/setAll",
            id: `inverse-${actionId}`,
            timestamp: Date.now(),
            params: { subtitles: priorSubtitles },
          },
        );
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

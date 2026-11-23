import { create } from "zustand";

type TimelineTool =
  | "select"
  | "blade"
  | "ripple"
  | "slip"
  | "roll"
  | "slide"
  | "stretch"
  | "trackSelectForward"
  | "trackSelectBackward"
  | "hand"
  | "zoom";

export type AssetSection =
  | "media"
  | "audio"
  | "text"
  | "effects"
  | "transitions"
  | "graphics"
  | "ai"
  | "recipes"
  | "markers"
  | "browser"
  | "metadata"
  | "comments"
  | "versions"
  | "templates"
  | "settings";

export type TargetKind = "video" | "audio";

/** Shared by the rail, menus and asset browser in both renderer targets. */
export const useEditorWorkspaceStore = create<{
  timelineTool: TimelineTool;
  setTimelineTool: (tool: TimelineTool) => void;
  /**
   * Premiere-style SOURCE PATCH: the timeline track each source component
   * (video / audio) is routed to by Insert / Overwrite. (Kept under its
   * original name, `targetTracks`, for saved layouts and callers.)
   */
  targetTracks: Partial<Record<TargetKind, string>>;
  setTargetTrack: (kind: TargetKind, trackId: string | null) => void;
  /** Same as setTargetTrack: route a source component to a track (null clears). */
  setSourcePatch: (kind: TargetKind, trackId: string | null) => void;
  /**
   * Multichannel source patching: the track patched to each audio channel group of the Source monitor's clip beyond
   * the first (A2, A3, ...; channel index 1+). Channel 0 (A1) is `targetTracks.audio`. A track belongs to one channel.
   */
  channelPatches: Record<number, string>;
  /** Channel groups whose patch indicator is switched off (nothing is placed for them), by channel index. */
  disabledChannels: number[];
  /** Patches a source audio channel (0 = A1) to a track, or clears it (null = automatic). A track is patched to one channel only. */
  setChannelPatch: (channel: number, trackId: string | null) => void;
  setChannelEnabled: (channel: number, enabled: boolean) => void;
  /**
   * Premiere TRACK TARGETING: the tracks whose target toggle (V1 / A1 style) is
   * on. Extract, Lift, Add Edit, Match Frame, Paste and the Source monitor
   * (when nothing is patched) act on these. Ids of removed tracks are ignored
   * wherever the list is read.
   */
  targetedTrackIds: string[];
  setTrackTargeted: (trackId: string, targeted: boolean) => void;
  toggleTrackTargeted: (trackId: string) => void;
  linkedSelection: boolean;
  setLinkedSelection: (enabled: boolean) => void;
  section: AssetSection;
  setSection: (section: AssetSection) => void;
  /** Markers panel view: sequence markers, or the clip / master-clip markers of timeline clips. */
  markerScope: "sequence" | "clips";
  setMarkerScope: (scope: "sequence" | "clips") => void;
  /** Marker the Markers panel should open for inline editing (set by Edit Marker / M twice). */
  editingMarkerId: string | null;
  setEditingMarkerId: (id: string | null) => void;
  /** Marker picked in the Markers panel or on the ruler (highlighted in both). */
  selectedMarkerId: string | null;
  setSelectedMarkerId: (id: string | null) => void;
  audioSource: string;
  setAudioSource: (source: string) => void;
  textSource: string;
  setTextSource: (source: string) => void;
  /** Default length of a J-cut / L-cut made from the context menu, in frames. */
  splitEditFrames: number;
  setSplitEditFrames: (frames: number) => void;
  transitionDuration: number;
  setTransitionDuration: (seconds: number) => void;
  mobileCaptionsOpen: boolean;
  setMobileCaptionsOpen: (open: boolean) => void;
  aiConnectionOpen: boolean;
  setAIConnectionOpen: (open: boolean) => void;
  multiCameraOpen: boolean;
  setMultiCameraOpen: (open: boolean) => void;
  multicamSourceOpen: boolean;
  setMulticamSourceOpen: (open: boolean) => void;
}>((set, get) => ({
  timelineTool: "select",
  setTimelineTool: (timelineTool) => set({ timelineTool }),
  targetTracks: {},
  setTargetTrack: (kind, trackId) =>
    set((state) => {
      const next = { ...state.targetTracks };
      if (trackId) next[kind] = trackId;
      else delete next[kind];
      // A1 patched to a track takes it from any other audio channel.
      if (kind === "audio" && trackId) {
        const channelPatches = Object.fromEntries(Object.entries(state.channelPatches).filter(([, id]) => id !== trackId)) as Record<number, string>;
        return { targetTracks: next, channelPatches };
      }
      return { targetTracks: next };
    }),
  setSourcePatch: (kind, trackId) => get().setTargetTrack(kind, trackId),
  channelPatches: {},
  disabledChannels: [],
  setChannelPatch: (channel, trackId) =>
    set((state) => {
      if (!Number.isInteger(channel) || channel < 0) return state;
      // A track serves one channel: patching it here frees it from any other channel (and from the video-style A1 patch).
      const channelPatches = Object.fromEntries(
        Object.entries(state.channelPatches).filter(([key, id]) => !(trackId && id === trackId && Number(key) !== channel)),
      ) as Record<number, string>;
      const targetTracks = { ...state.targetTracks };
      if (trackId && channel !== 0 && targetTracks.audio === trackId) delete targetTracks.audio;
      if (channel === 0) {
        if (trackId) targetTracks.audio = trackId;
        else delete targetTracks.audio;
        return { targetTracks, channelPatches };
      }
      if (trackId) channelPatches[channel] = trackId;
      else delete channelPatches[channel];
      return { targetTracks, channelPatches };
    }),
  setChannelEnabled: (channel, enabled) =>
    set((state) => {
      const has = state.disabledChannels.includes(channel);
      if (enabled === !has) return state;
      return { disabledChannels: enabled ? state.disabledChannels.filter((c) => c !== channel) : [...state.disabledChannels, channel] };
    }),
  targetedTrackIds: [],
  setTrackTargeted: (trackId, targeted) =>
    set((state) => {
      const has = state.targetedTrackIds.includes(trackId);
      if (targeted === has) return state;
      return {
        targetedTrackIds: targeted
          ? [...state.targetedTrackIds, trackId]
          : state.targetedTrackIds.filter((id) => id !== trackId),
      };
    }),
  toggleTrackTargeted: (trackId) =>
    get().setTrackTargeted(trackId, !get().targetedTrackIds.includes(trackId)),
  linkedSelection: true,
  setLinkedSelection: (linkedSelection) => set({ linkedSelection }),
  section: "media",
  setSection: (section) => set({ section }),
  markerScope: "sequence",
  setMarkerScope: (markerScope) => set({ markerScope }),
  editingMarkerId: null,
  setEditingMarkerId: (editingMarkerId) => set({ editingMarkerId }),
  selectedMarkerId: null,
  setSelectedMarkerId: (selectedMarkerId) => set({ selectedMarkerId }),
  audioSource: "music",
  setAudioSource: (audioSource) => set({ audioSource }),
  textSource: "text",
  setTextSource: (textSource) => set({ textSource }),
  splitEditFrames: 12,
  setSplitEditFrames: (frames) =>
    set({ splitEditFrames: Math.max(1, Math.min(300, Math.round(frames) || 12)) }),
  transitionDuration: 0.5,
  setTransitionDuration: (seconds) =>
    set({ transitionDuration: Math.max(1 / 120, Math.min(30, seconds)) }),
  mobileCaptionsOpen: false,
  setMobileCaptionsOpen: (mobileCaptionsOpen) => set({ mobileCaptionsOpen }),
  aiConnectionOpen: false,
  setAIConnectionOpen: (aiConnectionOpen) => set({ aiConnectionOpen }),
  multiCameraOpen: false,
  setMultiCameraOpen: (multiCameraOpen) => set({ multiCameraOpen }),
  multicamSourceOpen: false,
  setMulticamSourceOpen: (multicamSourceOpen) => set({ multicamSourceOpen }),
}));

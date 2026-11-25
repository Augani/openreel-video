import type { TransitionType } from "./effects";
import type { EmphasisAnimation } from "../graphics/types";
import type { StabilizationProfile } from "../video/stabilization/types";

export interface Timeline {
  readonly tracks: Track[];
  readonly subtitles: Subtitle[];
  readonly duration: number;
  readonly markers: Marker[];
  readonly beatMarkers?: TimelineBeatMarker[];
  readonly beatAnalysis?: TimelineBeatAnalysis;
  /**
   * Canvas letterbox fill behind clips whose aspect differs from the project
   * canvas. Raw values are part of the shared cross-platform project JSON
   * schema (identical on iOS/Android). `"color"` paints `layoutBackgroundColor`;
   * `"blur"` paints a blurred cover-fit copy of the base clip. Undefined keeps
   * the default black bars.
   */
  readonly backgroundFillMode?: "color" | "blur";
  readonly layoutBackgroundColor?: string;
  /** Master-bus effect rack, fader and trim applied after every track mixes. */
  readonly masterAudioRack?: AudioRack;
  /**
   * Hosted audio plugins (Audio Unit / VST3) on the MASTER bus. They process the whole summed mix (every track and bus,
   * after their own plugins and racks) BEFORE the master fader and the built-in master rack, and before any export
   * loudness normalisation or true-peak limiting. Keyframes are timeline seconds.
   */
  readonly masterPluginRack?: AudioPluginRack;
  /**
   * Submix buses of this sequence (Audio Track Mixer). Absent on old projects:
   * every track then plays straight into the master, exactly as before.
   */
  readonly audioBuses?: AudioBus[];
  /** Saved Audio Track Mixer states (faders, pans, mute/solo, effect racks). Absent on old projects. */
  readonly mixerSnapshots?: MixerSnapshot[];
}

/** Mixer state of one track inside a snapshot. */
export interface MixerTrackState {
  readonly muted: boolean;
  readonly solo: boolean;
  readonly soloSafe?: boolean;
  readonly audioRack?: AudioRack;
}

/** Mixer state of one submix bus inside a snapshot. */
export interface MixerBusState {
  readonly muted: boolean;
  readonly solo: boolean;
  readonly rack?: AudioRack;
}

/**
 * A saved Audio Track Mixer state. Recall restores fader, pan, mute, solo and effect rack of every track and bus
 * that still exists and the master rack; routing (outputs, sends) and clips are never touched.
 */
export interface MixerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly tracks: Record<string, MixerTrackState>;
  readonly buses: Record<string, MixerBusState>;
  readonly masterRack?: AudioRack;
}

export type AudioBusRole = "general" | "dialogue" | "music" | "effects";

/**
 * A submix bus. Tracks (and other buses) route their output into it; it has
 * its own effect rack (rack.effects), fader (rack.volume) and pan (rack.pan),
 * mute/solo and optional volume automation, then plays into `output`
 * (another bus id; absent = master). Buses live beside `tracks` rather than in
 * them so clip containers, sync lock and track targeting never see them.
 */
export interface AudioBus {
  readonly id: string;
  readonly name: string;
  readonly role?: AudioBusRole;
  readonly color?: string;
  readonly rack?: AudioRack;
  /** Hosted audio plugins (Audio Unit / VST3) on the bus's summed input, before its rack. */
  readonly pluginRack?: AudioPluginRack;
  readonly muted: boolean;
  readonly solo: boolean;
  /** Bus id this bus plays into; absent = master. */
  readonly output?: string;
  /** Fader automation in timeline seconds (linear gain 0..4), replaces rack.volume while it plays. */
  readonly automation?: { readonly volume?: AutomationPoint[] };
}

/** A track-to-bus send. Pre-fader sends ignore the track fader; both respect mute/solo. */
export interface AudioSend {
  readonly id: string;
  readonly busId: string;
  /** Linear send level 0..4 (1 = 0 dB). */
  readonly level: number;
  readonly preFader: boolean;
  readonly muted?: boolean;
  /** Send-level automation in timeline seconds (linear 0..4). */
  readonly automation?: AutomationPoint[];
}

export type AudioRackEffectType =
  | "gain"
  | "eq"
  | "compressor"
  | "limiter"
  | "reverb"
  | "delay"
  | "noiseReduction"
  | "deHum"
  | "deClick"
  | "deClip"
  | "deEss"
  | "deReverb"
  | "gate"
  | "brickwallLimiter"
  | "lowPass"
  | "chorus"
  | "flanger"
  | "phaser"
  | "distortion"
  | "stereoWidth"
  | "invertPolarity"
  | "channelMap";

/** One slot of a track/master effect rack. Bypass keeps the slot and its params. */
export interface AudioRackEffect {
  readonly id: string;
  readonly type: AudioRackEffectType;
  readonly params: Record<string, number | string | boolean>;
  readonly bypassed: boolean;
  /**
   * Parameter automation in timeline seconds, keyed by param key (gain, EQ and compressor params).
   * Values are in the param's own unit (dB for gains) and replace the static param while they play.
   */
  readonly automation?: Record<string, AutomationPoint[]>;
}

/**
 * Hosted audio plugins (Audio Unit today, VST3 behind the same protocol) on a track or a submix bus. The slots are
 * `nativePlugin` effects (the same shape a clip carries); they process the track's / bus's summed signal BEFORE the
 * built-in rack, fader and pan. Parameter automation is ordinary keyframes (property `effect.nativeplugin:<id>.<key>`)
 * in timeline seconds.
 */
export interface AudioPluginRack {
  readonly plugins: Effect[];
  readonly keyframes?: Keyframe[];
  /**
   * Preview mode (desktop). Absent or true: LIVE, the plugins are streamed block by block through the plugin host while the
   * preview plays, so a parameter change is heard at once. False: RENDERED, the preview plays the cached offline render.
   * Never changes the export, which always uses the offline render.
   */
  readonly livePreview?: boolean;
}

/** Ordered rack (max 5 slots) plus the bus fader and pan it feeds. */
export interface AudioRack {
  readonly effects: AudioRackEffect[];
  /** Linear bus volume 0..4 (1 = 0 dB). Defaults to 1. */
  readonly volume?: number;
  /** Track pan -1..1. Defaults to 0. Unused on the master bus. */
  readonly pan?: number;
}

export interface TimelineBeatMarker {
  readonly time: number;
  readonly strength: number;
  readonly index: number;
  readonly isDownbeat: boolean;
}

export interface TimelineBeatAnalysis {
  readonly bpm: number;
  readonly confidence: number;
  readonly sourceClipId?: string;
  readonly analyzedAt: number;
}

/**
 * Premiere-style track automation mode. Off ignores the lanes; Read plays them; Write overwrites the lanes
 * from the start of a pass; Touch writes while a control is held and returns to the existing curve on release;
 * Latch starts writing on touch and holds the last value to the end of the pass. Absent = read.
 */
export type TrackAutomationMode = "off" | "read" | "write" | "touch" | "latch";

export interface TrackAutomation {
  readonly volume?: AutomationPoint[];
  readonly pan?: AutomationPoint[];
}

export interface Track {
  readonly id: string;
  /**
   * Legacy serialization hint retained for older OpenReel readers. New code
   * must resolve behavior from the timeline item, not from this value.
   */
  readonly type: "video" | "audio" | "image" | "text" | "graphics";
  /** Standard tracks accept every timeline item kind. Missing means standard. */
  readonly mode?: "standard";
  /** Editorial meaning used for naming, captions, and audio mixing. */
  readonly role?:
    | "general"
    | "captions"
    | "dialogue"
    | "music"
    | "effects"
    | "ambience";
  readonly name: string;
  readonly clips: Clip[];
  readonly transitions: Transition[];
  readonly locked: boolean;
  /**
   * Premiere-style Sync Lock. Ripple-type edits (ripple delete, ripple trim,
   * Insert, Extract, paste-insert, close gap) keep this track in sync with the
   * edit by shifting its clips by the same amount. Absent means ON, so older
   * projects behave as before; only an explicit `false` opts a track out.
   */
  readonly syncLock?: boolean;
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  /**
   * Solo Safe: while other tracks are soloed this track keeps playing (live and in the export
   * mixdown) instead of being silenced. Mute still wins. Absent = false.
   */
  readonly soloSafe?: boolean;
  /** Tracks with the same id move and trim their related items together. */
  readonly groupId?: string;
  /** Premiere-style per-track effect rack (Audio Track Mixer). Absent on old projects. */
  readonly audioRack?: AudioRack;
  /** Hosted audio plugins on this track's summed clips, before `audioRack`. Absent on old projects. */
  readonly pluginRack?: AudioPluginRack;
  /** Output assignment: a bus id, or absent for the master. */
  readonly output?: string;
  /**
   * Fader / pan automation lanes in timeline seconds. volume is linear gain 0..4 and
   * replaces the rack fader while it plays; pan is -1..1 and replaces the rack pan.
   */
  readonly automation?: TrackAutomation;
  /** How the lanes behave during playback (see TrackAutomationMode). Absent = read. */
  readonly automationMode?: TrackAutomationMode;
  /** Aux sends to buses (in addition to the main output). */
  readonly sends?: AudioSend[];
  /** 5.1 sequences: the default surround position of this track's clips. Absent = front centre. */
  readonly surroundPan?: import("../audio/surround").SurroundPan;
}

export interface EditingTemplateApplicationSource {
  readonly templateId: string;
  readonly applicationId: string;
  readonly ownerClipId: string;
  readonly ownerTrackId?: string;
  readonly controlValues?: Record<string, unknown>;
}

export interface AppliedEditingTemplate {
  readonly templateId: string;
  readonly applicationId: string;
  readonly name: string;
  readonly category?: string;
  readonly appliedAt: number;
  readonly controlValues?: Record<string, unknown>;
}

/** What a clip is, for the Essential Sound panel. */
export type AudioType = "dialogue" | "music" | "sfx" | "ambience";

export const AUDIO_TYPES: readonly AudioType[] = ["dialogue", "music", "sfx", "ambience"];

/** The independently toggleable blocks the Essential Sound panel applies. */
export type EssentialSoundBlock = "loudness" | "repair" | "clarity" | "ducking";

export interface EssentialSoundOptions {
  readonly loudness: boolean;
  readonly repair: boolean;
  readonly clarity: boolean;
  readonly ducking: boolean;
  /** Repair: broadband noise reduction (dialogue only). */
  readonly reduceNoise: boolean;
  /** Repair: low-frequency rumble removal (dialogue only). */
  readonly reduceRumble: boolean;
  /** 0..1 strength of the clarity EQ preset. */
  readonly clarityAmount: number;
  /** How far ducked clips fall under dialogue, in dB (positive). */
  readonly duckAmountDb: number;
  /** Attack and release of the duck, in milliseconds. */
  readonly duckFadeMs: number;
  /** LUFS that Dialogue is matched to; Music sits 7 LU under it. */
  readonly dialogueTargetLufs: number;
}

/**
 * What the Essential Sound panel remembers about a clip so that switching a
 * block off, or Clear, puts back exactly what the panel replaced.
 */
export interface EssentialSoundState {
  readonly options: EssentialSoundOptions;
  readonly loudness?: {
    readonly targetLufs: number;
    /** Absent when the clip was silent or could not be measured. */
    readonly beforeLufs?: number;
    readonly afterLufs?: number;
    readonly clamped: boolean;
    readonly previousVolume: number;
    /** Absent when the clip had no volume automation before the panel. */
    readonly previousVolumeLane?: AutomationPoint[];
    /** Volume and lane as the panel left them; if they differ the user edited them. */
    readonly appliedVolume: number;
    readonly appliedVolumeLane?: AutomationPoint[];
  };
  readonly ducking?: {
    /** True when the duck is live (metadata.liveDucking); absent for ducks baked to keyframes by older versions. */
    readonly live?: boolean;
    readonly previousVolumeLane?: AutomationPoint[];
    readonly appliedVolumeLane?: AutomationPoint[];
  };
}

/**
 * Live ducking: the clip dips under Dialogue clips, computed from where those
 * clips are at render time (see audio/live-ducking.ts), never baked to keyframes.
 */
export interface LiveDuckingConfig {
  readonly enabled: boolean;
  /** How far the clip falls while dialogue plays, in dB (positive). */
  readonly amountDb: number;
  /** Ramp down, ending where the dialogue starts. */
  readonly attackMs: number;
  /** Ramp back up, starting where the dialogue ends. */
  readonly releaseMs: number;
  /** Dialogue gaps shorter than this keep the duck down. */
  readonly holdMs: number;
}

export interface ClipMetadata {
  readonly essentialSound?: EssentialSoundState;
  readonly liveDucking?: LiveDuckingConfig;
  readonly templateSource?: EditingTemplateApplicationSource;
  readonly appliedTemplates?: AppliedEditingTemplate[];
  readonly templateManaged?: boolean;
  readonly templateTrackType?: "text" | "graphics";
  readonly [key: string]: unknown;
}

export interface EffectMetadata {
  /** Added by the Essential Sound panel; `sig` is the params signature as applied. */
  readonly essentialSound?: {
    readonly block: EssentialSoundBlock;
    readonly key: string;
    readonly sig: string;
  };
  readonly templateSource?: EditingTemplateApplicationSource;
  readonly filterPreset?: {
    readonly presetId: string;
    readonly applicationId: string;
    readonly index: number;
  };
  readonly [key: string]: unknown;
}

export interface ChromaKeySettings {
  readonly enabled: boolean;
  readonly keyColor: { readonly r: number; readonly g: number; readonly b: number };
  readonly tolerance: number;
  readonly edgeSoftness: number;
  readonly spillSuppression: number;
}

export interface SpeedKeyframe {
  readonly id: string;
  readonly time: number;
  readonly speed: number;
  readonly easing: EasingType;
}

export interface FreezeFrame {
  readonly id: string;
  readonly clipId: string;
  readonly sourceTime: number;
  readonly startTime: number;
  readonly duration: number;
}

export interface ClipFade {
  readonly fadeIn: number;
  readonly fadeOut: number;
  /** The original clip clock retained by an internal cut. Editing one edge
   * anchors that edge locally while retaining the other edge's clock. */
  readonly origin?: {
    readonly offset: number;
    readonly duration: number;
    /** False anchors an explicitly edited edge to the current piece. */
    readonly fadeIn?: boolean;
    readonly fadeOut?: boolean;
    /** A retained out edge can have a different clock after the in edge was edited. */
    readonly out?: { readonly offset: number; readonly duration: number };
  };
}

export interface Clip {
  readonly id: string;
  readonly mediaId: string;
  readonly trackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly effects: Effect[];
  readonly audioEffects: Effect[];
  readonly transform: Transform;
  readonly blendMode?: import("../video/types").BlendMode;
  readonly blendOpacity?: number;
  readonly colorGrading?: import("../video/color-grading-engine").ClipColorGrading;
  readonly volume: number;
  /** 5.1 sequences: this clip's surround position; absent = the track's. */
  readonly surroundPan?: import("../audio/surround").SurroundPan;
  /** Modify > Audio Channels: which source channels the clip plays. Absent = the file's import preset (default: the file as it is). */
  readonly channelMap?: import("../audio/channel-map").ClipChannelMap;
  readonly fade?: ClipFade;
  readonly automation?: {
    volume?: AutomationPoint[];
    pan?: AutomationPoint[];
  };
  readonly keyframes: Keyframe[];
  readonly speed?: number;
  readonly reversed?: boolean;
  /**
   * Legacy "Smooth Slow Motion" (before `timeInterpolation`): optical flow on a slowed clip. Read through
   * `effectiveTimeInterpolation`; an explicit `timeInterpolation` always wins.
   */
  readonly smoothSlowMo?: boolean;
  /** Time Interpolation (Premiere): how frames between two source frames are made. Absent = Frame Sampling. */
  readonly timeInterpolation?: import("../video/time-interpolation/types").TimeInterpolation;
  /** Optical Flow quality (flow resolution, pyramid depth, refinements). Absent = medium. */
  readonly interpolationQuality?: "low" | "medium" | "high";
  readonly stabilization?: {
    enabled: boolean;
    strength: number;
    cropMode: "auto" | "none";
    analyzed?: boolean;
    analysisVersion?: number;
    profile?: StabilizationProfile;
    /** Warp Stabilizer settings (Result, Smoothness, Method, Framing, Rolling Shutter, Crop Less / Smooth More). */
    warp?: import("../video/stabilization/warp/types").WarpSettings;
    /** The measured camera motion of the clip's range; present once analysed. Settings are derived from it. */
    warpAnalysis?: import("../video/stabilization/warp/types").WarpAnalysis;
  };
  readonly emphasisAnimation?: EmphasisAnimation;
  readonly chromaKey?: ChromaKeySettings;
  /** Content-Aware Fill (Remove Object): the tracked object mask whose area is filled from other frames and the surroundings. */
  readonly objectRemoval?: import("../video/content-aware-fill/types").ObjectRemovalSettings;
  readonly speedKeyframes?: SpeedKeyframe[];
  readonly freezeFrames?: FreezeFrame[];
  readonly pitchCorrection?: boolean;
  /**
   * Input colour space override for this clip (an Interpret Footage preset). Wins over the footage item's own
   * `colorInterpretation` and its tags; absent = use the footage's. See `inputSpaceForItem`.
   */
  readonly colorInterpretation?: import("../color/source-color").FootageColorPreset;
  /**
   * OCIO mode only: the name of the colour space of the loaded config this clip's pixels are in. Wins over the project's
   * default input space; absent = the project's default. Ignored outside OCIO mode.
   */
  readonly ocioInputSpace?: string;
  /**
   * Essential Sound tag. When absent the type is inferred from the parent
   * track's `role` (see resolveAudioType in audio/essential-sound.ts).
   */
  readonly audioType?: AudioType;
  /** Zero-based index of the audio track within the source media file to use for this clip.
   * Undefined or 0 means the primary/first audio track. */
  readonly audioTrackIndex?: number;
  /** Timeline label colour; when unset the clip shows its media's label. */
  readonly label?: import("./project").MediaLabelId | null;
  /**
   * Clip markers (Premiere): `time` is in the clip's SOURCE media seconds, so they follow the
   * footage through trims, speed changes and reverse. See `editing/clip-markers.ts`.
   */
  readonly markers?: Marker[];
  readonly metadata?: ClipMetadata;
  /**
   * Clip group (Premiere's Group, Cmd+G): clips sharing a `groupId` select, move and delete together. Trims stay
   * per clip. Absent on every clip of a project saved before groups existed.
   */
  readonly groupId?: string;
}

export interface Effect {
  readonly id: string;
  readonly type: string;
  readonly params: Record<string, unknown>;
  readonly enabled: boolean;
  readonly metadata?: EffectMetadata;
}

export type FitMode = "contain" | "cover" | "stretch" | "none";

export interface Transform {
  readonly position: { x: number; y: number };
  readonly scale: { x: number; y: number };
  readonly rotation: number;
  readonly anchor: { x: number; y: number };
  readonly opacity: number;
  readonly borderRadius?: number;
  readonly fitMode?: FitMode;
  readonly rotate3d?: { x: number; y: number; z: number };
  readonly perspective?: number;
  readonly transformStyle?: "flat" | "preserve-3d";
  readonly crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface Keyframe {
  readonly id: string;
  readonly time: number;
  readonly property: string;
  readonly value: unknown;
  readonly easing: EasingType;
  /**
   * Optional per-keyframe temporal bezier handles (graph editor). When set with
   * easing "bezier", the keyframe engine interpolates the OUTGOING segment using
   * these control points (in/out in normalized 0..1 time/value space), matching
   * After Effects' value-graph Bezier handles. Honored by keyframeEngine.applyEasing.
   */
  readonly bezierHandles?: {
    readonly in: { readonly x: number; readonly y: number };
    readonly out: { readonly x: number; readonly y: number };
  };
  readonly roving?: boolean;
  /**
   * Temporal interpolation type of this key's INCOMING side (the handle ending the previous
   * segment). "auto-bezier" keeps that handle derived from neighbours; "continuous-bezier" tangent-links
   * it with the outgoing side. Other types are fully described by the segments' easing + handles.
   * Absent on legacy keyframes. Handles are always baked into bezierHandles, so every engine
   * evaluates identically.
   */
  readonly interpolationIn?: "auto-bezier" | "continuous-bezier";
  /** Temporal interpolation type of this key's OUTGOING side (the handle leaving it); see interpolationIn. */
  readonly interpolationOut?: "auto-bezier" | "continuous-bezier";
  /**
   * Spatial interpolation of the position PATH at this key (stored on the `position.x` key; the
   * `position.y` key at the same time is its partner). Absent or "linear" = straight segments, the
   * pre-existing behaviour. "auto-bezier" derives smooth tangents from neighbouring keys; "bezier"
   * and "continuous-bezier" use `spatialIn` / `spatialOut`. See animation/spatial-path.ts.
   */
  readonly spatialMode?: "linear" | "bezier" | "auto-bezier" | "continuous-bezier";
  /** Spatial handle toward the previous key, as an offset from this key's point in position units. */
  readonly spatialIn?: { readonly x: number; readonly y: number };
  /** Spatial handle toward the next key, as an offset from this key's point in position units. */
  readonly spatialOut?: { readonly x: number; readonly y: number };
}

export const EASING_TYPES = [
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "hold",
  "bezier",
  "smoothstep",
  "smootherstep",
  "snappy",
  "smooth",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInQuart",
  "easeOutQuart",
  "easeInOutQuart",
  "easeInQuint",
  "easeOutQuint",
  "easeInOutQuint",
  "easeInSine",
  "easeOutSine",
  "easeInOutSine",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
  "easeInCirc",
  "easeOutCirc",
  "easeInOutCirc",
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
  "easeInBackStrong",
  "easeOutBackStrong",
  "easeInOutBackStrong",
  "easeInElastic",
  "easeOutElastic",
  "easeInOutElastic",
  "easeInElasticSoft",
  "easeOutElasticSoft",
  "easeInOutElasticSoft",
  "easeInBounce",
  "easeOutBounce",
  "easeInOutBounce",
  "easeInBounceSmall",
  "easeOutBounceSmall",
  "easeInOutBounceSmall",
] as const;

export type EasingType = (typeof EASING_TYPES)[number];

export const MARKER_KINDS = ["comment", "chapter", "segmentation", "web"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

export const REVIEW_STATUSES = ["open", "resolved"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** One reply in a review comment's thread. */
export interface ReviewReply {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

export interface Marker {
  readonly id: string;
  readonly time: number;
  readonly label: string;
  readonly color: string;
  /** Seconds. 0 or absent means a point marker; > 0 is a range marker. */
  readonly duration?: number;
  readonly comment?: string;
  /** Marker type; absent means "comment". */
  readonly kind?: MarkerKind;
  /**
   * Review fields. A marker with an `author` or a `status` is a review
   * comment: it appears in the Comments panel, can be resolved and replied to.
   * Plain markers leave all of these absent.
   */
  readonly author?: string;
  readonly status?: ReviewStatus;
  readonly replies?: readonly ReviewReply[];
  /** Epoch milliseconds the comment was written. */
  readonly createdAt?: number;
}

export type TransitionEdge = "in" | "out";

export interface Transition {
  readonly id: string;
  readonly clipAId: string;
  readonly clipBId?: string;
  readonly edge?: TransitionEdge;
  readonly type: TransitionType;
  readonly duration: number;
  readonly params: Record<string, unknown>;
}

export type CaptionAnimationStyle =
  | "none"
  | "word-highlight"
  | "word-by-word"
  | "karaoke"
  | "bounce"
  | "typewriter";

export interface SubtitleWord {
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
}

export interface Subtitle {
  readonly id: string;
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly style?: SubtitleStyle;
  readonly words?: SubtitleWord[];
  readonly animationStyle?: CaptionAnimationStyle;
  /** Who is speaking (shown in the transcript, exported as a WebVTT voice tag). */
  readonly speaker?: string;
  /**
   * What the cue looked like before a speaker profile's colour/position was
   * baked onto it, so clearing or changing the speaker can put it back.
   */
  readonly speakerBase?: {
    readonly hadStyle: boolean;
    readonly color?: string;
    readonly position?: SubtitleStyle["position"];
    readonly cueSettings?: CueSettings;
  };
  /** BCP-47 language of the text. Captions without one belong to the default track. */
  readonly language?: string;
  /**
   * The caption track this cue belongs to (one track per language/version).
   * Cues without an id are on the default track.
   */
  readonly captionTrackId?: string;
  /**
   * Keep this cue out of the picture (Preview and burned-in export). The cue stays in the
   * transcript and in sidecar / embedded caption files. Set per track so two language
   * versions never draw on top of each other.
   */
  readonly hidden?: boolean;
  /** WebVTT cue settings (line / position / size / align). Overrides `style.position` when set. */
  readonly cueSettings?: CueSettings;
}

/**
 * WebVTT cue settings for horizontal text (vertical writing is not modelled).
 * `line` is a line number (snap to lines, negative counts from the bottom) or,
 * with `snapToLines: false`, a percentage of the frame height. `position` and
 * `size` are percentages of the frame width.
 */
export interface CueSettings {
  readonly line?: number;
  readonly snapToLines?: boolean;
  readonly lineAlign?: "start" | "center" | "end";
  readonly position?: number;
  readonly positionAlign?: "line-left" | "center" | "line-right";
  readonly size?: number;
  readonly align?: "start" | "center" | "end" | "left" | "right";
}

export interface SubtitleStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly color: string;
  readonly backgroundColor: string;
  readonly position: "top" | "center" | "bottom";
  readonly highlightColor?: string;
  readonly upcomingColor?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly shadowColor?: string;
  readonly shadowBlur?: number;
  readonly shadowOffsetX?: number;
  readonly shadowOffsetY?: number;
  /** Horizontal padding of the background box in px (default 10). */
  readonly boxPaddingX?: number;
  /** Vertical padding of the background box in px (default 0). */
  readonly boxPaddingY?: number;
  readonly boxRadius?: number;
  /** Title/action-safe margin as a fraction of the frame (0..0.25). Unset keeps the legacy 2x font size margin. */
  readonly safeMargin?: number;
}

export interface AutomationPoint {
  readonly time: number;
  readonly value: number;
}

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Monitor,
  Maximize2,
  Minimize2,
  Move,
  Loader2,
} from "lucide-react";
import { IconButton } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { getRenderBridge } from "../../bridges/render-bridge";
import {
  RendererFactory,
  type Renderer,
  isWebGPUSupported,
  getSpeedEngine,
  getMasterClock,
  getRealtimeAudioGraph,
  getParticleEngine,
  type Effect,
  type AudioClipSchedule,
  type TextClip,
  type ShapeClip,
  type SVGClip,
  type StickerClip,
  type Subtitle,
  type Track,
} from "@openreel/core";
import { useEngineStore } from "../../stores/engine-store";
import {
  type HandlePosition,
  type InteractionMode,
  type ClipTransform,
  DEFAULT_TRANSFORM,
  formatTime,
  renderTextClipToCanvas,
  getActiveTextClips,
  getActiveShapeClips,
  renderShapeClipToCanvas,
  getActiveSubtitles,
  renderSubtitleToCanvas,
  drawFrameWithTransform,
  applyEffectsToFrame,
  getTransitionAtTime,
  renderTransitionFrame,
  getAnimatedTransform,
  applyEmphasisAnimation,
  CropModeView,
  MotionPathOverlay,
  ParticleRenderer,
} from "./preview/index";
import { ProcessingOverlay } from "./ProcessingOverlay";
import type { MotionPathConfig, GSAPMotionPathPoint } from "@openreel/core";

const getAdaptivePoolSize = (width: number, height: number): number => {
  const pixels = width * height;
  if (pixels >= 3840 * 2160) return 6;
  if (pixels >= 2560 * 1440) return 5;
  if (pixels >= 1920 * 1080) return 4;
  return 3;
};

interface GPULayer {
  bitmap: ImageBitmap;
  transform: ClipTransform;
}

const renderFrameWithGPU = async (
  renderer: Renderer,
  frame: ImageBitmap,
  transform: ClipTransform,
  _canvasWidth: number,
  _canvasHeight: number,
): Promise<ImageBitmap | null> => {
  try {
    const device = renderer.getDevice();
    if (!device) {
      return null;
    }

    renderer.beginFrame();

    const texture = renderer.createTextureFromImage(frame);

    const gpuTransform = {
      position: transform.position,
      scale: transform.scale,
      rotation: transform.rotation,
      anchor: transform.anchor,
      opacity: transform.opacity,
      borderRadius: transform.borderRadius,
    };

    renderer.renderLayer({
      texture,
      transform: gpuTransform,
      effects: [],
      opacity: transform.opacity,
      borderRadius: transform.borderRadius || 0,
    });

    const result = await renderer.endFrame();
    renderer.releaseTexture(texture);

    return result;
  } catch {
    return null;
  }
};

const renderAllLayersWithGPU = async (
  renderer: Renderer,
  layers: GPULayer[],
  _canvasWidth: number,
  _canvasHeight: number,
): Promise<ImageBitmap | null> => {
  try {
    const device = renderer.getDevice();

    if (!device || layers.length === 0) {
      return null;
    }

    renderer.beginFrame();

    const textures: ReturnType<typeof renderer.createTextureFromImage>[] = [];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];

      const texture = renderer.createTextureFromImage(layer.bitmap);
      textures.push(texture);

      const gpuTransform = {
        position: layer.transform.position,
        scale: layer.transform.scale,
        rotation: layer.transform.rotation,
        anchor: layer.transform.anchor,
        opacity: layer.transform.opacity,
        borderRadius: layer.transform.borderRadius,
      };

      renderer.renderLayer({
        texture,
        transform: gpuTransform,
        effects: [],
        opacity: layer.transform.opacity,
        borderRadius: layer.transform.borderRadius || 0,
      });
    }

    const result = await renderer.endFrame();

    for (const texture of textures) {
      renderer.releaseTexture(texture);
    }

    return result;
  } catch (e) {
    console.error("[renderAllLayersWithGPU] Error:", e);
    return null;
  }
};

interface ClipWithPlaceholder {
  isPlaceholder?: boolean;
}

export const Preview: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const renderBridgeInitialized = useRef<boolean>(false);
  const lastGoodFrameRef = useRef<ImageBitmap | null>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const offscreenCtxRef = useRef<OffscreenCanvasRenderingContext2D | null>(
    null,
  );

  // Native video element for hardware-accelerated playback (much faster for 4K)
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const currentVideoMediaIdRef = useRef<string | null>(null);
  const nativePlaybackActiveRef = useRef<boolean>(false);

  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioGraphRef = useRef<ReturnType<typeof getRealtimeAudioGraph> | null>(
    null,
  );
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  const rendererRef = useRef<Renderer | null>(null);
  const rendererInitializedRef = useRef<boolean>(false);

  const [isMuted, setIsMuted] = useState(false);
  const [isRenderBridgeReady, setIsRenderBridgeReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [rendererType, setRendererType] = useState<string>("none");
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isDark = useThemeStore((state) => state.isDark);

  // Canvas interaction state for resize/move
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("none");
  const [activeHandle, setActiveHandle] = useState<HandlePosition | null>(null);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const interactionStartRef = useRef<{
    x: number;
    y: number;
    transform: { x: number; y: number; scaleX: number; scaleY: number };
  } | null>(null);
  const pendingTransformRef = useRef<{
    clipId: string;
    transform: {
      position?: { x: number; y: number };
      scale?: { x: number; y: number };
    };
  } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Track if we're currently interacting to prevent re-renders during resize/move
  const isInteractingRef = useRef<boolean>(false);
  // Throttle store updates during interaction (update at most every 32ms ~30fps)
  const lastStoreUpdateRef = useRef<number>(0);
  const STORE_UPDATE_THROTTLE_MS = 32;
  // Throttle playhead updates during playback to reduce React re-renders
  const lastPlayheadUpdateRef = useRef<number>(0);
  const PLAYHEAD_UPDATE_THROTTLE_MS = 50;
  // Live transform state for immediate visual feedback during interaction
  const [liveTransform, setLiveTransform] = useState<{
    position: { x: number; y: number };
    scale: { x: number; y: number };
  } | null>(null);

  // Track interaction target type (video clip or text clip)
  const [interactionTargetType, setInteractionTargetType] = useState<
    "clip" | "text-clip" | "shape-clip" | null
  >(null);
  const interactionTargetIdRef = useRef<string | null>(null);

  // Video element cache for native hardware-accelerated frame decoding (thumbnails/scrubbing)
  // Much more reliable than MediaBunny's CanvasSink for random-access seeking
  const videoElementCacheRef = useRef<
    Map<string, { video: HTMLVideoElement; url: string; lastUsed: number }>
  >(new Map());

  // Persistent decoder cache for efficient playback (legacy - kept for fallback)
  const decoderCacheRef = useRef<
    Map<
      string,
      {
        input: { [Symbol.dispose]?: () => void };
        sink: unknown;
        mediaId: string;
        lastUsed: number;
      }
    >
  >(new Map());

  // Track canvas size changes for resize handles positioning
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width, height });
        if (width > 0 && height > 0) {
          offscreenCanvasRef.current = new OffscreenCanvas(width, height);
          offscreenCtxRef.current = offscreenCanvasRef.current.getContext("2d");
        }
      }
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  // Project store - subscribe to the entire project to ensure re-renders
  // when any part of the project changes (including clips)
  const project = useProjectStore((state) => state.project);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);

  // Get text clips from TitleEngine
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const allTextClips = useMemo(() => {
    const titleEngine = getTitleEngine();
    return titleEngine?.getAllTextClips() || [];
  }, [getTitleEngine, project.modifiedAt]);

  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const allShapeClips = useMemo(() => {
    const graphicsEngine = getGraphicsEngine();
    const shapes = graphicsEngine?.getAllShapeClips() || [];
    const svgs = graphicsEngine?.getAllSVGClips() || [];
    const stickers = graphicsEngine?.getAllStickerClips() || [];
    return [...shapes, ...svgs, ...stickers];
  }, [getGraphicsEngine, project.modifiedAt]);

  // Get subtitles from project timeline
  const allSubtitles = useMemo(() => {
    return project.timeline.subtitles || [];
  }, [project.timeline.subtitles]);

  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );
  const updateTextTransform = useProjectStore(
    (state) => state.updateTextTransform,
  );
  const updateShapeTransform = useProjectStore(
    (state) => state.updateShapeTransform,
  );
  const timelineTracks = project.timeline.tracks;
  const settings = project.settings;

  // Keep a ref to timelineTracks for use in playback effect without causing re-runs
  const timelineTracksRef = useRef(timelineTracks);
  useEffect(() => {
    timelineTracksRef.current = timelineTracks;
  }, [timelineTracks]);

  // Keep a ref to allTextClips for use in playback effect
  const allTextClipsRef = useRef(allTextClips);
  useEffect(() => {
    allTextClipsRef.current = allTextClips;
  }, [allTextClips]);

  const allShapeClipsRef = useRef(allShapeClips);
  useEffect(() => {
    allShapeClipsRef.current = allShapeClips;
  }, [allShapeClips]);

  // Keep a ref to allSubtitles for use in playback effect
  const allSubtitlesRef = useRef(allSubtitles);
  useEffect(() => {
    allSubtitlesRef.current = allSubtitles;
  }, [allSubtitles]);

  // Keep a ref to isScrubbing for use in playback loop
  const isScrubbingRef = useRef(false);

  const selectedItems = useUIStore((state) => state.selectedItems);
  const cropMode = useUIStore((state) => state.cropMode);
  const cropClipId = useUIStore((state) => state.cropClipId);
  const setCropMode = useUIStore((state) => state.setCropMode);
  const exportState = useUIStore((state) => state.exportState);
  const motionPathMode = useUIStore((state) => state.motionPathMode);
  const motionPathClipId = useUIStore((state) => state.motionPathClipId);

  const {
    playheadPosition,
    playbackState,
    playbackRate,
    isScrubbing,
    pause,
    togglePlayback,
    seekTo,
    seekRelative,
    setPlayheadPosition,
  } = useTimelineStore();

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  const isPlaying = playbackState === "playing";

  const motionPathClip = React.useMemo(() => {
    if (!motionPathMode || !motionPathClipId) return null;
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === motionPathClipId);
      if (clip) return clip;
    }
    return null;
  }, [motionPathMode, motionPathClipId, project.timeline.tracks]);

  const [motionPathConfig, setMotionPathConfig] = React.useState<MotionPathConfig | null>(null);

  React.useEffect(() => {
    if (motionPathClip) {
      setMotionPathConfig({
        clipId: motionPathClip.id,
        enabled: true,
        pathType: "bezier",
        points: [],
        showPath: true,
        autoOrient: false,
        alignOrigin: [0.5, 0.5],
      });
    } else {
      setMotionPathConfig(null);
    }
  }, [motionPathClip]);

  const handleMotionPathPointMove = React.useCallback(
    (index: number, x: number, y: number) => {
      setMotionPathConfig((prev) => {
        if (!prev) return prev;
        const newPoints = [...prev.points];
        newPoints[index] = { ...newPoints[index], x, y };
        return { ...prev, points: newPoints };
      });
    },
    []
  );

  const handleMotionPathPointAdd = React.useCallback(
    (point: GSAPMotionPathPoint) => {
      setMotionPathConfig((prev) => {
        if (!prev) return prev;
        const newPoints = [...prev.points, point].sort((a, b) => a.time - b.time);
        return { ...prev, points: newPoints };
      });
    },
    []
  );

  const handleMotionPathPointRemove = React.useCallback((index: number) => {
    setMotionPathConfig((prev) => {
      if (!prev) return prev;
      const newPoints = prev.points.filter((_, i) => i !== index);
      return { ...prev, points: newPoints };
    });
  }, []);

  const handleMotionPathControlPointMove = React.useCallback(
    (pointIndex: number, handleType: "cp1" | "cp2", x: number, y: number) => {
      setMotionPathConfig((prev) => {
        if (!prev) return prev;
        const newPoints = [...prev.points];
        const point = newPoints[pointIndex];
        if (!point.controlPoints) {
          point.controlPoints = { cp1: { x: 0, y: 0 }, cp2: { x: 0, y: 0 } };
        }
        point.controlPoints[handleType] = { x, y };
        return { ...prev, points: newPoints };
      });
    },
    []
  );

  const particleEngine = React.useMemo(() => getParticleEngine(), []);
  const [particleUpdateTrigger, setParticleUpdateTrigger] = React.useState(
    () => particleEngine.getChangeVersion()
  );

  React.useEffect(() => {
    const unsubscribe = particleEngine.onEffectsChange(() => {
      setParticleUpdateTrigger(particleEngine.getChangeVersion());
    });
    return unsubscribe;
  }, [particleEngine]);

  const particleEffects = React.useMemo(() => {
    return particleEngine.getAllEffects();
  }, [particleEngine, particleUpdateTrigger]);

  // Calculate the actual end time for playback (where clips actually end)
  // This needs to recalculate whenever the timeline changes
  // Includes video/audio/image clips, text clips, and shape clips
  const actualEndTime = React.useMemo(() => {
    const tracks = project.timeline.tracks;
    let maxEnd = 0;

    for (const track of tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }

    for (const textClip of allTextClips) {
      const end = textClip.startTime + textClip.duration;
      if (end > maxEnd) maxEnd = end;
    }

    for (const shapeClip of allShapeClips) {
      const end = shapeClip.startTime + shapeClip.duration;
      if (end > maxEnd) maxEnd = end;
    }

    return maxEnd;
  }, [project.timeline.tracks, allTextClips, allShapeClips]);

  // RenderBridge is guaranteed to be initialized before Preview renders (see EditorInterface)
  useEffect(() => {
    if (renderBridgeInitialized.current) return;

    const bridge = getRenderBridge();
    if (canvasRef.current) {
      bridge.setCanvas(canvasRef.current);
    }
    renderBridgeInitialized.current = true;
    setIsRenderBridgeReady(true);
  }, []);

  useEffect(() => {
    return () => {
      for (const entry of decoderCacheRef.current.values()) {
        entry.input[Symbol.dispose]?.();
      }
      decoderCacheRef.current.clear();

      for (const entry of videoElementCacheRef.current.values()) {
        entry.video.src = "";
        URL.revokeObjectURL(entry.url);
      }
      videoElementCacheRef.current.clear();

      if (videoElementRef.current) {
        videoElementRef.current.pause();
        videoElementRef.current.src = "";
        videoElementRef.current = null;
      }
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
      currentVideoMediaIdRef.current = null;
    };
  }, []);

  // Set canvas internal resolution ONLY when project settings change
  // This follows the WebGPU best practice of keeping internal resolution fixed
  // and using CSS/transforms for display scaling (prevents flickering during resize)
  // Using useLayoutEffect to ensure canvas size is set before first paint
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Always ensure canvas has correct size
    if (canvas.width !== settings.width || canvas.height !== settings.height) {
      canvas.width = settings.width;
      canvas.height = settings.height;
    }
  }, [settings.width, settings.height]);

  useEffect(() => {
    if (isRenderBridgeReady && canvasRef.current) {
      const bridge = getRenderBridge();
      bridge.setCanvas(canvasRef.current);
    }
  }, [isRenderBridgeReady]);

  /**
   * Initialize WebGPU renderer for GPU-accelerated rendering (once on mount)
   */
  useEffect(() => {
    if (rendererInitializedRef.current || !canvasRef.current) return;

    const initializeRenderer = async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const factory = RendererFactory.getInstance();
        const renderer = await factory.createRenderer({
          canvas,
          width: settings.width,
          height: settings.height,
          preferredRenderer: isWebGPUSupported() ? "webgpu" : "canvas2d",
        });

        rendererRef.current = renderer;
        rendererInitializedRef.current = true;
        setRendererType(renderer.type);

        renderer.onDeviceLost(() => {
          console.warn("[Preview] GPU device lost, attempting recovery...");
          renderer.recreateDevice().then((success) => {
            if (!success) {
              console.error("[Preview] Failed to recover GPU device");
              setRendererType("canvas2d");
            }
          });
        });
      } catch (error) {
        console.warn("[Preview] Failed to initialize GPU renderer:", error);
        setRendererType("canvas2d");
      }
    };

    initializeRenderer();

    return () => {
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
        rendererInitializedRef.current = false;
      }
    };
  }, []);

  /**
   * Handle canvas resize events
   *
   * Update preview at 60fps when dragging to resize
   */
  useEffect(() => {
    if (rendererRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      if (
        canvas.width !== settings.width ||
        canvas.height !== settings.height
      ) {
        rendererRef.current.resize(settings.width, settings.height);
      }
    }
  }, [settings.width, settings.height]);

  const rateRef = useRef(playbackRate);
  const startPositionRef = useRef(playheadPosition);

  // MediaBunny playback resources - map of clipId to resources for multi-track playback
  const playbackResourcesRef = useRef<
    Map<
      string,
      {
        input: { [Symbol.dispose]?: () => void };
        sink: unknown;
        mediaId: string;
        clipId: string;
        trackIndex: number;
      }
    >
  >(new Map());

  const imageBitmapCacheRef = useRef<Map<string, ImageBitmap>>(new Map());

  useEffect(() => {
    rateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!isPlaying) {
      startPositionRef.current = playheadPosition;
    }
  }, [isPlaying, playheadPosition]);

  const cleanupPlaybackResources = useCallback(() => {
    const resources = playbackResourcesRef.current;
    for (const [, resource] of resources) {
      resource.input[Symbol.dispose]?.();
    }
    playbackResourcesRef.current = new Map();

    for (const [, bitmap] of imageBitmapCacheRef.current) {
      bitmap.close();
    }
    imageBitmapCacheRef.current = new Map();
  }, []);

  const cleanupAudioResources = useCallback(() => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch {
        // Ignore errors if already stopped
      }
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioGraphRef.current) {
      audioGraphRef.current.stopScheduler();
      audioGraphRef.current.stopAllClips();
    }
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : 1;
    }
    if (audioGraphRef.current) {
      audioGraphRef.current.setMasterVolume(isMuted ? 0 : 1);
    }
  }, [isMuted]);

  /**
   * Render overlay clips (text and shapes) respecting proper z-ordering with video/image tracks.
   * Track order determines layering: lower track index = rendered on top.
   *
   * @param mode - "below-video" renders only overlays that should appear below video tracks
   * "above-video" renders only overlays that should appear above video tracks
   * "all" renders all overlays (legacy behavior for when no video is present)
   */
  const renderOverlayClipsInTrackOrder = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      tracks: Track[],
      shapeClips: (ShapeClip | SVGClip | StickerClip)[],
      textClips: TextClip[],
      time: number,
      canvasWidth: number,
      canvasHeight: number,
      mode: "below-video" | "above-video" | "all" = "all",
    ) => {
      const videoImageTrackIndices = tracks
        .map((t, idx) => ({ track: t, originalIndex: idx }))
        .filter(
          ({ track }) =>
            (track.type === "video" || track.type === "image") && !track.hidden,
        )
        .map(({ originalIndex }) => originalIndex);

      const lowestVideoIndex =
        videoImageTrackIndices.length > 0
          ? Math.min(...videoImageTrackIndices)
          : Infinity;
      const highestVideoIndex =
        videoImageTrackIndices.length > 0
          ? Math.max(...videoImageTrackIndices)
          : -1;

      const overlayTracksWithIndex = tracks
        .map((t, idx) => ({ track: t, originalIndex: idx }))
        .filter(
          ({ track }) =>
            (track.type === "text" || track.type === "graphics") &&
            !track.hidden,
        );

      const tracksToRender = overlayTracksWithIndex.filter(
        ({ originalIndex }) => {
          if (mode === "below-video") {
            return originalIndex > highestVideoIndex;
          } else if (mode === "above-video") {
            return originalIndex < lowestVideoIndex;
          }
          return true;
        },
      );

      tracksToRender.sort((a, b) => b.originalIndex - a.originalIndex);

      for (const { track } of tracksToRender) {
        if (track.type === "graphics") {
          const trackShapeClips = shapeClips.filter(
            (sc) => sc.trackId === track.id,
          );
          for (const shapeClip of trackShapeClips) {
            renderShapeClipToCanvas(
              ctx,
              shapeClip,
              canvasWidth,
              canvasHeight,
              time,
            );
          }
        } else if (track.type === "text") {
          const trackTextClips = textClips.filter(
            (tc) => tc.trackId === track.id,
          );
          for (const textClip of trackTextClips) {
            renderTextClipToCanvas(
              ctx,
              textClip,
              canvasWidth,
              canvasHeight,
              time,
            );
          }
        }
      }
    },
    [],
  );

  /**
   * Set up audio playback from the AUDIO TRACK at a given timeline position
   * Uses RealtimeAudioGraph for real-time audio effects (reverb, delay, EQ, compressor)
   *
   * Audio effects can be on either:
   * 1. The audio clip on the audio track (preferred)
   * 2. A linked video clip on the video track (same mediaId, same startTime)
   *
   * @param timelinePosition - The current position in the timeline
   */
  const setupAudioFromAudioTrack = useCallback(
    async (timelinePosition: number): Promise<void> => {
      const tracks = timelineTracksRef.current;
      const audioTracks = tracks.filter((t) => t.type === "audio" && !t.hidden);
      const videoTracks = tracks.filter(
        (t) => (t.type === "video" || t.type === "image") && !t.hidden,
      );

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setMasterVolume(isMuted ? 0 : 1);

      const projectStore = useProjectStore.getState();
      const speedEngine = getSpeedEngine();
      const scheduledClips: AudioClipSchedule[] = [];

      for (const audioTrack of audioTracks) {
        audioGraph.createTrack({
          trackId: audioTrack.id,
          volume: 1,
          pan: 0,
          muted: audioTrack.muted || false,
          solo: audioTrack.solo || false,
          effects: [],
        });

        if (audioTrack.muted) {
          continue;
        }

        for (const audioClip of audioTrack.clips) {
          const clipEnd = audioClip.startTime + audioClip.duration;

          if (
            timelinePosition >= audioClip.startTime &&
            timelinePosition < clipEnd
          ) {
            const mediaItem = getMediaItem(audioClip.mediaId);
            if (!mediaItem?.blob) {
              continue;
            }

            let audioBuffer = audioBufferCacheRef.current.get(
              audioClip.mediaId,
            );
            if (!audioBuffer) {
              try {
                const audioContext = audioGraph.getAudioContext();
                const arrayBuffer = await mediaItem.blob.arrayBuffer();
                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                audioBufferCacheRef.current.set(audioClip.mediaId, audioBuffer);
              } catch (error) {
                console.warn(
                  `[Preview] Failed to decode audio for clip ${audioClip.id}:`,
                  error,
                );
                continue;
              }
            }

            const audioClipData = projectStore.getClip(audioClip.id);
            let audioEffects = audioClipData?.audioEffects || [];

            if (audioEffects.length === 0) {
              for (const videoTrack of videoTracks) {
                for (const videoClip of videoTrack.clips) {
                  if (
                    videoClip.mediaId === audioClip.mediaId &&
                    Math.abs(videoClip.startTime - audioClip.startTime) < 0.01
                  ) {
                    const videoClipData = projectStore.getClip(videoClip.id);
                    const linkedEffects = videoClipData?.audioEffects || [];
                    if (linkedEffects.length > 0) {
                      audioEffects = linkedEffects;
                      break;
                    }
                  }
                }
                if (audioEffects.length > 0) break;
              }
            }

            const enabledEffects = audioEffects.filter(
              (e: Effect) => e.enabled,
            );

            audioGraph.updateTrackEffects(audioTrack.id, enabledEffects);

            const clipLocalTime = timelinePosition - audioClip.startTime;
            const isReverse = speedEngine.isReverse(audioClip.id);

            let mediaOffset = (audioClip.inPoint || 0) + clipLocalTime;
            if (isReverse) {
              mediaOffset = audioBuffer.duration - mediaOffset;
              mediaOffset = Math.max(0, mediaOffset);
            }

            scheduledClips.push({
              clipId: audioClip.id,
              trackId: audioTrack.id,
              audioBuffer,
              startTime: audioClip.startTime,
              endTime: clipEnd,
              mediaOffset,
              volume: audioClip.volume ?? 1,
              pan: 0,
              effects: enabledEffects,
              speed: audioClip.speed ?? 1,
            });
          }
        }
      }

      if (scheduledClips.length > 0) {
        await audioGraph.resume();
        audioGraph.scheduleClips(scheduledClips);
      }
    },
    [getMediaItem, isMuted],
  );

  const preDecodeAllAudioBuffers = useCallback(async (): Promise<void> => {
    const tracks = timelineTracksRef.current;
    const audioTracks = tracks.filter((t) => t.type === "audio" && !t.hidden);
    const videoTracks = tracks.filter(
      (t) => (t.type === "video" || t.type === "image") && !t.hidden,
    );

    if (!audioGraphRef.current) {
      audioGraphRef.current = getRealtimeAudioGraph();
    }
    const audioGraph = audioGraphRef.current;
    const audioContext = audioGraph.getAudioContext();

    const allTracks = [...audioTracks, ...videoTracks];

    for (const track of allTracks) {
      for (const clip of track.clips) {
        if (audioBufferCacheRef.current.has(clip.mediaId)) {
          continue;
        }

        const mediaItem = getMediaItem(clip.mediaId);
        if (!mediaItem?.blob) {
          continue;
        }

        try {
          const arrayBuffer = await mediaItem.blob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          audioBufferCacheRef.current.set(clip.mediaId, audioBuffer);
        } catch {
        }
      }
    }
  }, [getMediaItem]);

  const getAudioClipsForScheduler = useCallback(
    (time: number): AudioClipSchedule[] => {
      const tracks = timelineTracksRef.current;
      const tracksWithAudio = tracks.filter(
        (t) => (t.type === "audio" || t.type === "video") && !t.hidden && !t.muted,
      );
      const schedules: AudioClipSchedule[] = [];
      const projectStore = useProjectStore.getState();

      for (const track of tracksWithAudio) {
        for (const clip of track.clips) {
          const clipEnd = clip.startTime + clip.duration;
          if (clipEnd <= time || clip.startTime > time + 1) {
            continue;
          }

          const audioBuffer = audioBufferCacheRef.current.get(clip.mediaId);
          if (!audioBuffer) {
            continue;
          }

          const clipData = projectStore.getClip(clip.id);
          const audioEffects = (clipData?.audioEffects || []).filter(
            (e: Effect) => e.enabled,
          );

          schedules.push({
            clipId: clip.id,
            trackId: track.id,
            audioBuffer,
            startTime: clip.startTime,
            endTime: clipEnd,
            mediaOffset: clip.inPoint || 0,
            volume: clip.volume ?? 1,
            pan: 0,
            effects: audioEffects,
            speed: clip.speed ?? 1,
          });
        }
      }

      return schedules;
    },
    [],
  );

  /**
   * Decode a single frame from a clip at a specific time using native video element
   * Native video elements provide reliable hardware-accelerated random-access seeking
   */
  const decodeClipFrame = useCallback(
    async (
      clip: {
        id: string;
        mediaId: string;
        startTime: number;
        inPoint?: number;
      },
      time: number,
      canvasWidth: number,
      canvasHeight: number,
    ): Promise<ImageBitmap | null> => {
      const mediaItem = getMediaItem(clip.mediaId);
      if (!mediaItem?.blob) return null;

      if (mediaItem.type === "image") {
        try {
          return await createImageBitmap(mediaItem.blob);
        } catch {
          return null;
        }
      }

      try {
        const clipLocalTime = time - clip.startTime;
        const speedEngine = getSpeedEngine();
        const adjustedLocalTime = speedEngine.getSourceTimeAtPlaybackTime(
          clip.id,
          clipLocalTime,
        );
        const mediaTime = (clip.inPoint || 0) + adjustedLocalTime;

        const cacheKey = clip.mediaId;
        let cached = videoElementCacheRef.current.get(cacheKey);

        if (!cached) {
          const url = URL.createObjectURL(mediaItem.blob);
          const video = document.createElement("video");
          video.src = url;
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          video.crossOrigin = "anonymous";

          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(
              () => reject(new Error("Video load timeout")),
              10000,
            );
            video.onloadedmetadata = () => {
              clearTimeout(timeoutId);
              resolve();
            };
            video.onerror = () => {
              clearTimeout(timeoutId);
              reject(new Error("Video load failed"));
            };
          });

          cached = { video, url, lastUsed: Date.now() };
          videoElementCacheRef.current.set(cacheKey, cached);

          if (videoElementCacheRef.current.size > 8) {
            let oldestKey = "";
            let oldestTime = Infinity;
            for (const [key, entry] of videoElementCacheRef.current.entries()) {
              if (entry.lastUsed < oldestTime) {
                oldestTime = entry.lastUsed;
                oldestKey = key;
              }
            }
            if (oldestKey) {
              const oldEntry = videoElementCacheRef.current.get(oldestKey);
              if (oldEntry) {
                oldEntry.video.src = "";
                URL.revokeObjectURL(oldEntry.url);
                videoElementCacheRef.current.delete(oldestKey);
              }
            }
          }
        }

        cached.lastUsed = Date.now();
        const { video } = cached;

        const clampedTime = Math.max(
          0,
          Math.min(mediaTime, video.duration - 0.001),
        );
        if (Math.abs(video.currentTime - clampedTime) > 0.01) {
          video.currentTime = clampedTime;
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);
              resolve();
            };
            video.addEventListener("seeked", onSeeked);
            setTimeout(resolve, 500);
          });
        }

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = canvasWidth;
        tempCanvas.height = canvasHeight;
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) return null;

        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = canvasWidth / canvasHeight;
        let drawWidth = canvasWidth;
        let drawHeight = canvasHeight;
        let offsetX = 0;
        let offsetY = 0;

        if (videoAspect > canvasAspect) {
          drawHeight = canvasWidth / videoAspect;
          offsetY = (canvasHeight - drawHeight) / 2;
        } else {
          drawWidth = canvasHeight * videoAspect;
          offsetX = (canvasWidth - drawWidth) / 2;
        }

        tempCtx.fillStyle = "#000000";
        tempCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        tempCtx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

        return await createImageBitmap(tempCanvas);
      } catch {
        const cached = videoElementCacheRef.current.get(clip.mediaId);
        if (cached) {
          cached.video.src = "";
          URL.revokeObjectURL(cached.url);
          videoElementCacheRef.current.delete(clip.mediaId);
        }
        return null;
      }
    },
    [getMediaItem],
  );

  // Render a single frame using MediaBunny (for scrubbing/seeking)
  const renderFrameDirectly = useCallback(
    async (time: number): Promise<boolean> => {
      const canvas = canvasRef.current;
      if (!canvas) return false;

      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = settings.width;
        canvas.height = settings.height;
      }

      const mainCtx = canvas.getContext("2d");
      if (!mainCtx) return false;

      if (
        !offscreenCanvasRef.current ||
        offscreenCanvasRef.current.width !== canvas.width ||
        offscreenCanvasRef.current.height !== canvas.height
      ) {
        offscreenCanvasRef.current = new OffscreenCanvas(
          canvas.width,
          canvas.height,
        );
        offscreenCtxRef.current = offscreenCanvasRef.current.getContext(
          "2d",
        ) as OffscreenCanvasRenderingContext2D;
      }

      const ctx =
        offscreenCtxRef.current as unknown as CanvasRenderingContext2D;
      if (!ctx) return false;

      const videoTracks = timelineTracks.filter(
        (t) => (t.type === "video" || t.type === "image") && !t.hidden,
      );

      let hasRenderedFrame = false;
      let shouldClearCanvas = true;

      const activeShapeClips = getActiveShapeClips(allShapeClips, time);
      const activeTextClips = getActiveTextClips(allTextClips, time);

      const transitionInfo = getTransitionAtTime(time, timelineTracks);

      if (transitionInfo) {
        try {
          const outgoingFrame = await decodeClipFrame(
            transitionInfo.clipA,
            time,
            canvas.width,
            canvas.height,
          );
          const incomingFrame = await decodeClipFrame(
            transitionInfo.clipB,
            time,
            canvas.width,
            canvas.height,
          );

          if (outgoingFrame && incomingFrame) {
            const processedOutgoing = await applyEffectsToFrame(
              transitionInfo.clipA.id,
              outgoingFrame,
            );
            const processedIncoming = await applyEffectsToFrame(
              transitionInfo.clipB.id,
              incomingFrame,
            );

            const validOutgoing =
              processedOutgoing.width > 0 && processedOutgoing.height > 0
                ? processedOutgoing
                : outgoingFrame;
            const validIncoming =
              processedIncoming.width > 0 && processedIncoming.height > 0
                ? processedIncoming
                : incomingFrame;

            const blendedFrame = await renderTransitionFrame(
              transitionInfo,
              validOutgoing,
              validIncoming,
            );

            if (
              blendedFrame &&
              blendedFrame.width > 0 &&
              blendedFrame.height > 0
            ) {
              if (shouldClearCanvas) {
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                shouldClearCanvas = false;
              }
              renderOverlayClipsInTrackOrder(
                ctx,
                timelineTracks,
                activeShapeClips,
                activeTextClips,
                time,
                canvas.width,
                canvas.height,
                "below-video",
              );
              ctx.drawImage(blendedFrame, 0, 0);
              renderOverlayClipsInTrackOrder(
                ctx,
                timelineTracks,
                activeShapeClips,
                activeTextClips,
                time,
                canvas.width,
                canvas.height,
                "above-video",
              );
              hasRenderedFrame = true;
            }
          } else if (outgoingFrame) {
            const processed = await applyEffectsToFrame(
              transitionInfo.clipA.id,
              outgoingFrame,
            );
            const validFrame =
              processed.width > 0 && processed.height > 0
                ? processed
                : outgoingFrame;
            if (shouldClearCanvas) {
              ctx.fillStyle = "#000000";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              shouldClearCanvas = false;
            }
            renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "below-video",
            );
            ctx.drawImage(validFrame, 0, 0);
            renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "above-video",
            );
            hasRenderedFrame = true;
          } else if (incomingFrame) {
            const processed = await applyEffectsToFrame(
              transitionInfo.clipB.id,
              incomingFrame,
            );
            const validFrame =
              processed.width > 0 && processed.height > 0
                ? processed
                : incomingFrame;
            if (shouldClearCanvas) {
              ctx.fillStyle = "#000000";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              shouldClearCanvas = false;
            }
            renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "below-video",
            );
            ctx.drawImage(validFrame, 0, 0);
            renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracks,
              activeShapeClips,
              activeTextClips,
              time,
              canvas.width,
              canvas.height,
              "above-video",
            );
            hasRenderedFrame = true;
          }
        } catch (error) {
          console.warn("[Preview] Transition render failed:", error);
        }
      }

      if (!hasRenderedFrame) {
        const hasVideoContent = videoTracks.some((track) =>
          track.clips.some(
            (clip) =>
              time >= clip.startTime && time < clip.startTime + clip.duration,
          ),
        );

        if (
          shouldClearCanvas &&
          (hasVideoContent ||
            activeShapeClips.length > 0 ||
            activeTextClips.length > 0)
        ) {
          ctx.fillStyle = hasVideoContent
            ? "#000000"
            : isDark
              ? "#0f0f11"
              : "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          shouldClearCanvas = false;
        }

        // Render ALL tracks in layer order using painter's algorithm
        // Higher index = rendered first (appears behind), Lower index = rendered last (appears on top)
        const allRenderableTracks = timelineTracks
          .map((track, idx) => ({ track, originalIndex: idx }))
          .filter(
            ({ track }) =>
              (track.type === "video" ||
                track.type === "image" ||
                track.type === "text" ||
                track.type === "graphics") &&
              !track.hidden,
          )
          .sort((a, b) => b.originalIndex - a.originalIndex);

        for (const { track } of allRenderableTracks) {
          if (track.type === "video" || track.type === "image") {
            for (const clip of track.clips) {
              const clipStart = clip.startTime;
              const clipEnd = clip.startTime + clip.duration;

              if (time >= clipStart && time < clipEnd) {
                const frame = await decodeClipFrame(
                  clip,
                  time,
                  canvas.width,
                  canvas.height,
                );

                if (frame) {
                  const clipLocalTime = time - clip.startTime;
                  let animatedTransform = getAnimatedTransform(
                    clip.transform as ClipTransform,
                    clip.keyframes,
                    clipLocalTime,
                  );

                  if (
                    clip.emphasisAnimation &&
                    clip.emphasisAnimation.type !== "none"
                  ) {
                    const emphasisState = applyEmphasisAnimation(
                      clip.emphasisAnimation,
                      clipLocalTime,
                    );
                    animatedTransform = {
                      ...animatedTransform,
                      opacity:
                        animatedTransform.opacity * emphasisState.opacity,
                      scale: {
                        x:
                          animatedTransform.scale.x *
                          emphasisState.scale *
                          emphasisState.scaleX,
                        y:
                          animatedTransform.scale.y *
                          emphasisState.scale *
                          emphasisState.scaleY,
                      },
                      position: {
                        x:
                          animatedTransform.position.x +
                          emphasisState.offsetX * canvas.width,
                        y:
                          animatedTransform.position.y +
                          emphasisState.offsetY * canvas.height,
                      },
                      rotation:
                        animatedTransform.rotation + emphasisState.rotation,
                    };
                  }

                  try {
                    const processedFrame = await applyEffectsToFrame(
                      clip.id,
                      frame,
                    );
                    if (processedFrame.width > 0 && processedFrame.height > 0) {
                      drawFrameWithTransform(
                        ctx,
                        processedFrame,
                        animatedTransform,
                        canvas.width,
                        canvas.height,
                      );
                      hasRenderedFrame = true;
                    } else {
                      drawFrameWithTransform(
                        ctx,
                        frame,
                        animatedTransform,
                        canvas.width,
                        canvas.height,
                      );
                      hasRenderedFrame = true;
                    }
                  } catch {
                    drawFrameWithTransform(
                      ctx,
                      frame,
                      animatedTransform,
                      canvas.width,
                      canvas.height,
                    );
                    hasRenderedFrame = true;
                  }
                }
              }
            }
          } else if (track.type === "graphics") {
            const trackShapeClips = activeShapeClips.filter(
              (sc) => sc.trackId === track.id,
            );
            for (const shapeClip of trackShapeClips) {
              renderShapeClipToCanvas(
                ctx,
                shapeClip,
                canvas.width,
                canvas.height,
                time,
              );
              hasRenderedFrame = true;
            }
          } else if (track.type === "text") {
            const trackTextClips = activeTextClips.filter(
              (tc) => tc.trackId === track.id,
            );
            for (const textClip of trackTextClips) {
              renderTextClipToCanvas(
                ctx,
                textClip,
                canvas.width,
                canvas.height,
                time,
              );
              hasRenderedFrame = true;
            }
          }
        }
      }

      const activeSubtitles = getActiveSubtitles(allSubtitles, time);
      if (activeSubtitles.length > 0 && ctx) {
        for (const subtitle of activeSubtitles) {
          renderSubtitleToCanvas(
            ctx,
            subtitle,
            canvas.width,
            canvas.height,
            time,
          );
        }
      }

      if (hasRenderedFrame && offscreenCanvasRef.current) {
        mainCtx.clearRect(0, 0, canvas.width, canvas.height);
        mainCtx.drawImage(offscreenCanvasRef.current, 0, 0);
      }

      return hasRenderedFrame;
    },
    [
      timelineTracks,
      getMediaItem,
      decodeClipFrame,
      settings.width,
      settings.height,
      allTextClips,
      allShapeClips,
      allSubtitles,
      renderOverlayClipsInTrackOrder,
      isDark,
    ],
  );

  const renderFallbackFrame = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (canvas.width === 0 || canvas.height === 0) {
        canvas.width = settings.width;
        canvas.height = settings.height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const emptyBg = isDark ? "#0f0f11" : "#ffffff";
      const emptyText = isDark ? "#52525b" : "#a1a1aa";
      const textPrimary = isDark ? "#ffffff" : "#18181b";
      const textSecondary = isDark ? "#a1a1aa" : "#71717a";

      const activeShapeClips = getActiveShapeClips(allShapeClips, time);
      const activeTextClips = getActiveTextClips(allTextClips, time);

      const videoTracks = timelineTracks.filter(
        (t) => (t.type === "video" || t.type === "image") && !t.hidden,
      );

      const hasVideoContent = videoTracks.some((track) =>
        track.clips.some(
          (clip) =>
            time >= clip.startTime && time < clip.startTime + clip.duration,
        ),
      );

      ctx.fillStyle = hasVideoContent
        ? isDark
          ? "#18181b"
          : "#f4f4f5"
        : emptyBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let hasRenderedContent = false;

      const allRenderableTracks = timelineTracks
        .map((track, idx) => ({ track, originalIndex: idx }))
        .filter(
          ({ track }) =>
            (track.type === "video" ||
              track.type === "image" ||
              track.type === "text" ||
              track.type === "graphics") &&
            !track.hidden,
        )
        .sort((a, b) => b.originalIndex - a.originalIndex);

      for (const { track } of allRenderableTracks) {
        if (track.type === "video" || track.type === "image") {
          for (const clip of track.clips) {
            const clipStart = clip.startTime;
            const clipEnd = clip.startTime + clip.duration;

            if (time >= clipStart && time < clipEnd) {
              const mediaItem = getMediaItem(clip.mediaId);
              if (mediaItem) {
                hasRenderedContent = true;
                ctx.fillStyle = textPrimary;
                ctx.font = "bold 24px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(
                  mediaItem.name,
                  canvas.width / 2,
                  canvas.height / 2,
                );
                ctx.font = "16px Inter, sans-serif";
                ctx.fillStyle = textSecondary;
                ctx.fillText(
                  `${formatTime(time)} / ${formatTime(clip.duration)}`,
                  canvas.width / 2,
                  canvas.height / 2 + 30,
                );
              } else if ((clip as ClipWithPlaceholder).isPlaceholder) {
                hasRenderedContent = true;
                ctx.fillStyle = textSecondary;
                ctx.font = "bold 20px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(
                  "Drop media here",
                  canvas.width / 2,
                  canvas.height / 2,
                );
                ctx.font = "14px Inter, sans-serif";
                ctx.fillStyle = emptyText;
                ctx.fillText(
                  "Replace this placeholder with your content",
                  canvas.width / 2,
                  canvas.height / 2 + 28,
                );
              }
            }
          }
        } else if (track.type === "graphics") {
          const trackShapeClips = activeShapeClips.filter(
            (sc) => sc.trackId === track.id,
          );
          for (const shapeClip of trackShapeClips) {
            renderShapeClipToCanvas(
              ctx,
              shapeClip,
              canvas.width,
              canvas.height,
              time,
            );
            hasRenderedContent = true;
          }
        } else if (track.type === "text") {
          const trackTextClips = activeTextClips.filter(
            (tc) => tc.trackId === track.id,
          );
          for (const textClip of trackTextClips) {
            renderTextClipToCanvas(
              ctx,
              textClip,
              canvas.width,
              canvas.height,
              time,
            );
            hasRenderedContent = true;
          }
        }
      }

      const activeSubtitles = getActiveSubtitles(allSubtitles, time);
      for (const subtitle of activeSubtitles) {
        renderSubtitleToCanvas(
          ctx,
          subtitle,
          canvas.width,
          canvas.height,
          time,
        );
      }

      const audioTracks = timelineTracks.filter(
        (t) => t.type === "audio" && !t.hidden,
      );
      const hasActiveAudioClip = audioTracks.some((track) =>
        track.clips.some(
          (clip) =>
            time >= clip.startTime && time < clip.startTime + clip.duration,
        ),
      );

      if (
        !hasRenderedContent &&
        activeTextClips.length === 0 &&
        activeShapeClips.length === 0 &&
        !hasActiveAudioClip
      ) {
        ctx.fillStyle = emptyText;
        ctx.font = "24px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          "Import media to get started",
          canvas.width / 2,
          canvas.height / 2,
        );
      }
    },
    [
      timelineTracks,
      getMediaItem,
      settings.width,
      settings.height,
      allTextClips,
      allShapeClips,
      allSubtitles,
      isDark,
    ],
  );

  // Check if we can use native video element playback (much faster, hardware-accelerated)
  const canUseNativeVideoPlayback = useCallback(
    (
      startPosition: number,
    ): {
      canUse: boolean;
      clips: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>;
      }>;
      imageClips?: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        trackIndex: number;
      }>;
    } => {
      const tracks = timelineTracks;
      const videoTracks = tracks.filter((t) => t.type === "video" && !t.hidden);

      const allVideoClips: Array<{
        clip: (typeof tracks)[0]["clips"][0];
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>;
      }> = [];
      const speedEngine = getSpeedEngine();

      for (const track of videoTracks) {
        for (const clip of track.clips) {
          if (clip.startTime + clip.duration > startPosition) {
            const mediaItem = getMediaItem(clip.mediaId);
            if (mediaItem?.blob && mediaItem.type === "video") {
              const clipSpeed = speedEngine.getClipSpeed(clip.id);
              const isReverse = speedEngine.isReverse(clip.id);
              if (clipSpeed !== 1 || isReverse) {
                return { canUse: false, clips: [] };
              }
              allVideoClips.push({ clip, mediaItem });
            }
          }
        }
      }

      if (allVideoClips.length === 0) return { canUse: false, clips: [] };

      allVideoClips.sort((a, b) => a.clip.startTime - b.clip.startTime);

      // Check for overlapping clips (multi-layer) - can't use native playback for compositing
      for (let i = 0; i < allVideoClips.length - 1; i++) {
        const current = allVideoClips[i];
        const next = allVideoClips[i + 1];
        const currentEnd = current.clip.startTime + current.clip.duration;
        if (next.clip.startTime < currentEnd) {
          return { canUse: false, clips: [] };
        }
      }

      // Note: Text/graphics overlays are now supported in native video playback
      // They are rendered using CPU canvas2D after the video frame

      // Collect image clips for background compositing (don't disable native playback)
      const imageTracks = tracks.filter((t) => t.type === "image" && !t.hidden);
      const imageClips: Array<{
        clip: (typeof tracks)[0]["clips"][0];
        trackIndex: number;
      }> = [];
      imageTracks.forEach((track) => {
        const trackIndex = tracks.indexOf(track);
        for (const clip of track.clips) {
          imageClips.push({ clip, trackIndex });
        }
      });

      return { canUse: true, clips: allVideoClips, imageClips };
    },
    [timelineTracks, getMediaItem, allTextClips, allShapeClips],
  );

  // Start native video playback using hardware-accelerated video elements (handles multiple clips)
  const startNativeVideoPlayback = useCallback(
    async (
      clips: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        mediaItem: NonNullable<ReturnType<typeof getMediaItem>>;
      }>,
      imageClips: Array<{
        clip: (typeof timelineTracks)[0]["clips"][0];
        trackIndex: number;
      }>,
      startPosition: number,
      onEnd: () => void,
    ): Promise<() => void> => {
      const canvas = canvasRef.current;
      if (!canvas || clips.length === 0) {
        onEnd();
        return () => {};
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onEnd();
        return () => {};
      }

      nativePlaybackActiveRef.current = true;

      const imageBitmapCache = new Map<string, ImageBitmap>();
      for (const { clip } of imageClips) {
        const mediaItem = getMediaItem(clip.mediaId);
        if (mediaItem?.type === "image" && mediaItem.blob) {
          try {
            const bitmap = await createImageBitmap(mediaItem.blob);
            imageBitmapCache.set(clip.id, bitmap);
          } catch (error) {
            console.warn(`Failed to cache image bitmap for ${clip.id}:`, error);
          }
        }
      }

      await preDecodeAllAudioBuffers();

      const videoCache = new Map<
        string,
        { video: HTMLVideoElement; url: string }
      >();
      const loadPromises: Promise<void>[] = [];

      for (const { clip, mediaItem } of clips) {
        if (!videoCache.has(clip.mediaId) && mediaItem.blob) {
          const url = URL.createObjectURL(mediaItem.blob);
          const video = document.createElement("video");
          video.src = url;
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";

          videoCache.set(clip.mediaId, { video, url });

          loadPromises.push(
            new Promise<void>((resolve, reject) => {
              video.onloadedmetadata = () => resolve();
              video.onerror = () =>
                reject(new Error(`Video load failed for ${clip.mediaId}`));
              setTimeout(() => resolve(), 5000); // Don't fail on timeout, just continue
            }),
          );
        }
      }

      await Promise.all(loadPromises);

      const masterClock = getMasterClock();
      masterClock.setDuration(actualEndTime);
      masterClock.seek(startPosition);

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setMasterVolume(isMuted ? 0 : 1);

      const tracksWithAudio = timelineTracks.filter(
        (t) => (t.type === "audio" || t.type === "video") && !t.hidden,
      );
      for (const audioTrack of tracksWithAudio) {
        audioGraph.createTrack({
          trackId: audioTrack.id,
          volume: 1,
          pan: 0,
          muted: audioTrack.muted || false,
          solo: audioTrack.solo || false,
          effects: [],
        });
      }

      await audioGraph.resume();
      audioGraph.seekTo(startPosition);
      audioGraph.startScheduler(() => {
        const tracksWithAudio = timelineTracks.filter(
          (t) => (t.type === "audio" || t.type === "video") && !t.hidden,
        );
        const schedules: AudioClipSchedule[] = [];
        for (const track of tracksWithAudio) {
          for (const audioClip of track.clips) {
            const mediaItem = getMediaItem(audioClip.mediaId);
            const hasAudio =
              mediaItem?.type === "audio" ||
              (mediaItem?.type === "video" &&
                mediaItem?.metadata?.channels &&
                mediaItem.metadata.channels > 0);
            if (!hasAudio) continue;

            const audioBuffer = audioBufferCacheRef.current.get(audioClip.mediaId);
            if (audioBuffer) {
              schedules.push({
                clipId: audioClip.id,
                trackId: track.id,
                audioBuffer,
                startTime: audioClip.startTime,
                endTime: audioClip.startTime + audioClip.duration,
                mediaOffset: audioClip.inPoint || 0,
                volume: 1,
                pan: 0,
                effects: [],
                speed: audioClip.speed ?? 1,
              });
            }
          }
        }
        return schedules;
      });

      await masterClock.play();

      let isActive = true;
      let rafId: number | null = null;
      let videoFrameCallbackId: number | null = null;
      let currentClipId: string | null = null;
      let currentVideo: HTMLVideoElement | null = null;

      // Check if requestVideoFrameCallback is supported
      const supportsVideoFrameCallback =
        "requestVideoFrameCallback" in HTMLVideoElement.prototype;

      const findClipAtTime = (time: number) => {
        for (const { clip, mediaItem } of clips) {
          if (time >= clip.startTime && time < clip.startTime + clip.duration) {
            return { clip, mediaItem };
          }
        }
        return null;
      };

      const drawFrame = async () => {
        if (!isActive || !nativePlaybackActiveRef.current) return;

        const currentPlayhead = masterClock.currentTime;

        if (currentPlayhead >= actualEndTime) {
          cleanup();
          setPlayheadPosition(0);
          startPositionRef.current = 0;
          onEnd();
          return;
        }

        if (!masterClock.isPlaying) {
          cleanup();
          if (!isScrubbingRef.current) {
            onEnd();
          }
          return;
        }

        const activeClip = findClipAtTime(currentPlayhead);

        if (!activeClip) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const sortedImageClipsNoVideo = [...imageClips].sort(
            (a, b) => b.trackIndex - a.trackIndex,
          );
          for (const { clip: imgClip } of sortedImageClipsNoVideo) {
            if (
              currentPlayhead >= imgClip.startTime &&
              currentPlayhead < imgClip.startTime + imgClip.duration
            ) {
              const bitmap = imageBitmapCache.get(imgClip.id);
              if (bitmap) {
                const latestImgClip = (() => {
                  for (const track of timelineTracksRef.current) {
                    const found = track.clips.find((c) => c.id === imgClip.id);
                    if (found) return found;
                  }
                  return imgClip;
                })();
                const imgClipLocalTime = currentPlayhead - imgClip.startTime;
                const imgTransform = getAnimatedTransform(
                  (latestImgClip.transform as ClipTransform) || DEFAULT_TRANSFORM,
                  latestImgClip.keyframes,
                  imgClipLocalTime,
                );
                drawFrameWithTransform(
                  ctx,
                  bitmap,
                  imgTransform,
                  canvas.width,
                  canvas.height,
                );
              }
            }
          }

          const activeShapeClipsNoVideo = getActiveShapeClips(
            allShapeClipsRef.current,
            currentPlayhead,
          );
          const activeTextClipsNoVideo = getActiveTextClips(
            allTextClipsRef.current,
            currentPlayhead,
          );

          if (activeShapeClipsNoVideo.length > 0 || activeTextClipsNoVideo.length > 0) {
            renderOverlayClipsInTrackOrder(
              ctx,
              timelineTracksRef.current,
              activeShapeClipsNoVideo,
              activeTextClipsNoVideo,
              currentPlayhead,
              canvas.width,
              canvas.height,
              "all",
            );
          }

          const activeSubtitlesNoVideo = getActiveSubtitles(
            allSubtitles,
            currentPlayhead,
          );
          for (const subtitle of activeSubtitlesNoVideo) {
            renderSubtitleToCanvas(
              ctx,
              subtitle,
              canvas.width,
              canvas.height,
              currentPlayhead,
            );
          }

          const nowNoClip = performance.now();
          if (nowNoClip - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
            lastPlayheadUpdateRef.current = nowNoClip;
            setPlayheadPosition(currentPlayhead);
          }
          rafId = requestAnimationFrame(() => { drawFrame(); });
          return;
        }

        const { clip } = activeClip;
        const cached = videoCache.get(clip.mediaId);

        if (!cached) {
          const nowNoCached = performance.now();
          if (nowNoCached - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
            lastPlayheadUpdateRef.current = nowNoCached;
            setPlayheadPosition(currentPlayhead);
          }
          rafId = requestAnimationFrame(() => { drawFrame(); });
          return;
        }

        const { video } = cached;

        if (currentClipId !== clip.id) {
          currentClipId = clip.id;
          currentVideo = video;
          if (video.paused) {
            video.play().catch(() => {});
          }
        }

        const clipLocalTime = currentPlayhead - clip.startTime;
        const targetMediaTime = (clip.inPoint || 0) + clipLocalTime;
        const drift = Math.abs(video.currentTime - targetMediaTime);
        if (drift > 0.1) {
          video.currentTime = targetMediaTime;
        }

        const latestClip = (() => {
          for (const track of timelineTracksRef.current) {
            const found = track.clips.find((c) => c.id === clip.id);
            if (found) return found;
          }
          return clip;
        })();

        let transform = getAnimatedTransform(
          (latestClip.transform as ClipTransform) || DEFAULT_TRANSFORM,
          latestClip.keyframes,
          clipLocalTime,
        );

        if (latestClip.emphasisAnimation && latestClip.emphasisAnimation.type !== "none") {
          const emphasisState = applyEmphasisAnimation(
            latestClip.emphasisAnimation,
            clipLocalTime,
          );
          transform = {
            ...transform,
            opacity: transform.opacity * emphasisState.opacity,
            scale: {
              x: transform.scale.x * emphasisState.scale * emphasisState.scaleX,
              y: transform.scale.y * emphasisState.scale * emphasisState.scaleY,
            },
            position: {
              x: transform.position.x + emphasisState.offsetX * canvas.width,
              y: transform.position.y + emphasisState.offsetY * canvas.height,
            },
            rotation: transform.rotation + emphasisState.rotation,
          };
        }

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Sort by track index descending (higher index = background = render first)
        const sortedImageClips = [...imageClips].sort(
          (a, b) => b.trackIndex - a.trackIndex,
        );
        for (const { clip: imgClip } of sortedImageClips) {
          if (
            currentPlayhead >= imgClip.startTime &&
            currentPlayhead < imgClip.startTime + imgClip.duration
          ) {
            const bitmap = imageBitmapCache.get(imgClip.id);
            if (bitmap) {
              const latestImgClip = (() => {
                for (const track of timelineTracksRef.current) {
                  const found = track.clips.find((c) => c.id === imgClip.id);
                  if (found) return found;
                }
                return imgClip;
              })();
              const imgClipLocalTime = currentPlayhead - imgClip.startTime;
              const imgTransform = getAnimatedTransform(
                (latestImgClip.transform as ClipTransform) || DEFAULT_TRANSFORM,
                latestImgClip.keyframes,
                imgClipLocalTime,
              );
              drawFrameWithTransform(
                ctx,
                bitmap,
                imgTransform,
                canvas.width,
                canvas.height,
              );
            }
          }
        }

        const allShapeClipsData = allShapeClipsRef.current;
        const activeShapeClips = getActiveShapeClips(
          allShapeClipsData,
          currentPlayhead,
        );
        const activeTextClips = getActiveTextClips(
          allTextClipsRef.current,
          currentPlayhead,
        );

        drawFrameWithTransform(ctx, video, transform, canvas.width, canvas.height);

        // Use CPU canvas2D for all overlays - more reliable than GPU compositing
        // Render all text/graphics overlays (they're above the video since backgrounds are separate)
        if (activeShapeClips.length > 0 || activeTextClips.length > 0) {
          renderOverlayClipsInTrackOrder(
            ctx,
            timelineTracksRef.current,
            activeShapeClips,
            activeTextClips,
            currentPlayhead,
            canvas.width,
            canvas.height,
            "all",
          );
        }

        const activeSubtitles = getActiveSubtitles(
          allSubtitles,
          currentPlayhead,
        );
        for (const subtitle of activeSubtitles) {
          renderSubtitleToCanvas(
            ctx,
            subtitle,
            canvas.width,
            canvas.height,
            currentPlayhead,
          );
        }

        const nowPlayhead = performance.now();
        if (nowPlayhead - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
          lastPlayheadUpdateRef.current = nowPlayhead;
          setPlayheadPosition(currentPlayhead);
        }

        // Schedule next frame using requestVideoFrameCallback for better sync with 4K
        if (supportsVideoFrameCallback && currentVideo && !currentVideo.paused) {
          videoFrameCallbackId = (
            currentVideo as HTMLVideoElement & {
              requestVideoFrameCallback: (
                callback: () => void,
              ) => number;
            }
          ).requestVideoFrameCallback(() => {
            drawFrame();
          });
        } else {
          rafId = requestAnimationFrame(() => {
            drawFrame();
          });
        }
      };

      const cleanup = () => {
        isActive = false;
        nativePlaybackActiveRef.current = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (videoFrameCallbackId && currentVideo) {
          (
            currentVideo as HTMLVideoElement & {
              cancelVideoFrameCallback: (id: number) => void;
            }
          ).cancelVideoFrameCallback?.(videoFrameCallbackId);
        }

        for (const [, { video, url }] of videoCache) {
          video.pause();
          video.src = "";
          URL.revokeObjectURL(url);
        }
        videoCache.clear();

        for (const [, bitmap] of imageBitmapCache) {
          bitmap.close();
        }
        imageBitmapCache.clear();

        videoElementRef.current = null;
        currentVideoMediaIdRef.current = null;
        masterClock.stop();
        audioGraph.stopScheduler();
      };

      rafId = requestAnimationFrame(() => { drawFrame(); });

      return cleanup;
    },
    [
      actualEndTime,
      allSubtitles,
      getMediaItem,
      isMuted,
      preDecodeAllAudioBuffers,
      setPlayheadPosition,
      timelineTracks,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = settings.width;
      canvas.height = settings.height;
    }

    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      cleanupPlaybackResources();
      cleanupAudioResources();
      return;
    }

    if (actualEndTime <= 0) {
      pause();
      return;
    }

    let isActive = true;
    const playbackStartPosition = startPositionRef.current;

    const findAllClipsAtTime = (time: number) => {
      const tracks = timelineTracksRef.current;
      const results: Array<{
        clip: (typeof tracks)[0]["clips"][0];
        track: (typeof tracks)[0];
        trackIndex: number;
      }> = [];

      tracks.forEach((track, originalIndex) => {
        if (
          (track.type === "video" || track.type === "image") &&
          !track.hidden
        ) {
          for (const clip of track.clips) {
            if (
              time >= clip.startTime &&
              time < clip.startTime + clip.duration
            ) {
              results.push({ clip, track, trackIndex: originalIndex });
            }
          }
        }
      });

      return results.sort((a, b) => a.trackIndex - b.trackIndex);
    };

    const findClipAtTime = (time: number) => {
      const results = findAllClipsAtTime(time);
      return results.length > 0 ? results[0] : null;
    };

    const startPlaybackForClip = async (
      clip: (typeof timelineTracksRef.current)[0]["clips"][0],
      _track: (typeof timelineTracksRef.current)[0],
      timelinePosition: number,
    ) => {
      try {
        const mediaItem = getMediaItem(clip.mediaId);
        if (!mediaItem?.blob) {
          const clipEndTime = clip.startTime + clip.duration;
          const nextResult = findClipAtTime(clipEndTime);
          if (nextResult && clipEndTime < actualEndTime && isActive) {
            startPlaybackForClip(
              nextResult.clip,
              nextResult.track,
              clipEndTime,
            );
          } else {
            pause();
          }
          return;
        }

        try {
          const mediabunny = await import("mediabunny");
          const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunny;

          const input = new Input({
            source: new BlobSource(mediaItem.blob),
            formats: ALL_FORMATS,
          });

          const videoTrack = await input.getPrimaryVideoTrack();
          if (!videoTrack || !isActive) {
            input[Symbol.dispose]?.();
            return;
          }

          const canDecode = await videoTrack.canDecode();
          if (!canDecode || !isActive) {
            input[Symbol.dispose]?.();
            return;
          }

          // Ensure canvas has valid dimensions BEFORE creating CanvasSink
          if (canvas.width === 0 || canvas.height === 0) {
            console.warn(
              "[Preview] Canvas has zero dimensions, setting from project settings",
            );
            canvas.width = settings.width;
            canvas.height = settings.height;
          }

          // Validate final canvas dimensions
          const sinkWidth = canvas.width || settings.width;
          const sinkHeight = canvas.height || settings.height;

          if (sinkWidth === 0 || sinkHeight === 0) {
            console.error(
              "[Preview] Cannot create CanvasSink with zero dimensions",
            );
            input[Symbol.dispose]?.();
            pause();
            return;
          }

          const sink = new CanvasSink(videoTrack, {
            width: sinkWidth,
            height: sinkHeight,
            fit: "contain",
            poolSize: getAdaptivePoolSize(sinkWidth, sinkHeight),
          });

          const speedEngine = getSpeedEngine();
          const clipLocalTime = Math.max(0, timelinePosition - clip.startTime);

          let currentSpeed = speedEngine.getClipSpeed(clip.id);
          let isReverse = speedEngine.isReverse(clip.id);
          let speedSourceClip = clip.id;

          // If video clip has default speed, check for linked audio clip's speed
          if (currentSpeed === 1 && !isReverse) {
            const tracks = timelineTracksRef.current;
            const audioTracks = tracks.filter((t) => t.type === "audio");

            for (const audioTrack of audioTracks) {
              for (const audioClip of audioTrack.clips) {
                if (
                  audioClip.mediaId === clip.mediaId &&
                  Math.abs(audioClip.startTime - clip.startTime) < 0.01
                ) {
                  const linkedSpeed = speedEngine.getClipSpeed(audioClip.id);
                  const linkedReverse = speedEngine.isReverse(audioClip.id);

                  if (linkedSpeed !== 1 || linkedReverse) {
                    currentSpeed = linkedSpeed;
                    isReverse = linkedReverse;
                    speedSourceClip = audioClip.id;
                    break;
                  }
                }
              }
              if (currentSpeed !== 1 || isReverse) break;
            }
          }

          const adjustedLocalTime = speedEngine.getSourceTimeAtPlaybackTime(
            speedSourceClip,
            clipLocalTime,
          );
          const mediaStartTime = (clip.inPoint || 0) + adjustedLocalTime;

          const mediaEndTime = Math.min(
            clip.outPoint || (clip.inPoint || 0) + clip.duration,
            (await videoTrack.computeDuration()) || Infinity,
          );

          await setupAudioFromAudioTrack(timelinePosition);

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            console.error("[Preview] Failed to get 2D context from canvas");
            input[Symbol.dispose]?.();
            return;
          }

          const frameDuration = 1000 / 30;

          let currentMediaTime = mediaStartTime;
          let currentPlayheadTime = timelinePosition;
          let lastFrameTimestamp = performance.now();
          let frameCount = 0;

          const processNextFrame = async () => {
            if (!isActive) {
              input[Symbol.dispose]?.();
              return;
            }

            try {
              if (currentMediaTime >= mediaEndTime) {
                input[Symbol.dispose]?.();
                cleanupAudioResources();

                const clipEndTime = clip.startTime + clip.duration;
                const nextResult = findClipAtTime(clipEndTime);

                if (nextResult && clipEndTime < actualEndTime && isActive) {
                  setPlayheadPosition(clipEndTime);
                  startPlaybackForClip(
                    nextResult.clip,
                    nextResult.track,
                    clipEndTime,
                  );
                } else if (!isScrubbingRef.current) {
                  setPlayheadPosition(0);
                  startPositionRef.current = 0;
                  pause();
                }
                return;
              }

              const frameResult = await (
                sink as {
                  getCanvas: (time: number) => Promise<{
                    canvas: HTMLCanvasElement | OffscreenCanvas;
                    timestamp: number;
                    duration: number;
                  } | null>;
                }
              ).getCanvas(currentMediaTime);

              frameCount++;

              if (!frameResult || !frameResult.canvas) {
                console.warn("[Preview] No frame at time", currentMediaTime);
                const skipTime = frameDuration / 1000;
                currentPlayheadTime += skipTime;
                currentMediaTime += skipTime * currentSpeed;
                if (isActive) {
                  animationRef.current =
                    requestAnimationFrame(processNextFrame);
                }
                return;
              }

              const { canvas: frameCanvas, duration } = frameResult;

              const frameWidth = "width" in frameCanvas ? frameCanvas.width : 0;
              const frameHeight =
                "height" in frameCanvas ? frameCanvas.height : 0;
              if (frameWidth === 0 || frameHeight === 0) {
                console.warn("[Preview] Frame has zero dimensions, skipping");
                const skipTime = frameDuration / 1000;
                currentPlayheadTime += skipTime;
                currentMediaTime += skipTime * currentSpeed;
                if (isActive) {
                  animationRef.current =
                    requestAnimationFrame(processNextFrame);
                }
                return;
              }

              const currentPlayhead = currentPlayheadTime;

              if (currentPlayhead >= actualEndTime) {
                if (!isScrubbingRef.current) {
                  setPlayheadPosition(0);
                  startPositionRef.current = 0;
                  pause();
                }
                input[Symbol.dispose]?.();
                return;
              }

              const clipLocalTime = currentPlayhead - clip.startTime;
              let transform = getAnimatedTransform(
                (clip.transform as ClipTransform) || DEFAULT_TRANSFORM,
                clip.keyframes,
                clipLocalTime,
              );

              if (
                clip.emphasisAnimation &&
                clip.emphasisAnimation.type !== "none"
              ) {
                const emphasisState = applyEmphasisAnimation(
                  clip.emphasisAnimation,
                  clipLocalTime,
                );
                transform = {
                  ...transform,
                  opacity: transform.opacity * emphasisState.opacity,
                  scale: {
                    x:
                      transform.scale.x *
                      emphasisState.scale *
                      emphasisState.scaleX,
                    y:
                      transform.scale.y *
                      emphasisState.scale *
                      emphasisState.scaleY,
                  },
                  position: {
                    x:
                      transform.position.x +
                      emphasisState.offsetX * canvas.width,
                    y:
                      transform.position.y +
                      emphasisState.offsetY * canvas.height,
                  },
                  rotation: transform.rotation + emphasisState.rotation,
                };
              }

              let processedFrame:
                | ImageBitmap
                | HTMLCanvasElement
                | OffscreenCanvas = frameCanvas;
              try {
                const frameBitmap = await createImageBitmap(frameCanvas);
                processedFrame = await applyEffectsToFrame(
                  clip.id,
                  frameBitmap,
                );
              } catch {}

              const useGPU =
                rendererRef.current && rendererRef.current.type === "webgpu";

              if (useGPU && processedFrame instanceof ImageBitmap) {
                const gpuResult = await renderFrameWithGPU(
                  rendererRef.current!,
                  processedFrame,
                  transform,
                  canvas.width,
                  canvas.height,
                );
                if (gpuResult) {
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(gpuResult, 0, 0);
                  gpuResult.close();
                } else {
                  ctx.fillStyle = "#000000";
                  ctx.fillRect(0, 0, canvas.width, canvas.height);
                  drawFrameWithTransform(
                    ctx,
                    processedFrame,
                    transform,
                    canvas.width,
                    canvas.height,
                  );
                }
              } else {
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                drawFrameWithTransform(
                  ctx,
                  processedFrame,
                  transform,
                  canvas.width,
                  canvas.height,
                );
              }

              const nowPh = performance.now();
              if (nowPh - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
                lastPlayheadUpdateRef.current = nowPh;
                setPlayheadPosition(currentPlayhead);
              }

              const now = performance.now();
              const elapsed = now - lastFrameTimestamp;
              const actualFrameDuration =
                duration > 0 ? duration * 1000 : frameDuration;
              const targetTime = actualFrameDuration / rateRef.current;

              const normalTimeAdvance = actualFrameDuration / 1000;
              const mediaTimeAdvance = normalTimeAdvance * currentSpeed;
              currentPlayheadTime += normalTimeAdvance;
              currentMediaTime += mediaTimeAdvance;

              const delay = Math.max(0, targetTime - elapsed);
              lastFrameTimestamp = now;

              if (isActive) {
                if (delay > 0) {
                  setTimeout(() => {
                    if (isActive) {
                      animationRef.current =
                        requestAnimationFrame(processNextFrame);
                    }
                  }, delay);
                } else {
                  animationRef.current =
                    requestAnimationFrame(processNextFrame);
                }
              }
            } catch (error) {
              console.error("[Preview] Frame error:", error);
              input[Symbol.dispose]?.();
              pause();
            }
          };

          animationRef.current = requestAnimationFrame(processNextFrame);
        } catch (error) {
          console.error("[Preview] MediaBunny setup error:", error);
          pause();
        }
      } catch (outerError) {
        console.error(
          "[Preview] startPlaybackForClip outer error:",
          outerError,
        );
        pause();
      }
    };

    const initClipResources = async (
      clip: (typeof timelineTracksRef.current)[0]["clips"][0],
      trackIndex: number,
    ) => {
      const mediaItem = getMediaItem(clip.mediaId);
      if (!mediaItem?.blob) {
        return null;
      }

      // Images don't need MediaBunny resources - they're rendered directly via createImageBitmap
      if (mediaItem.type === "image") {
        return null;
      }

      try {
        const mediabunny = await import("mediabunny");
        const { Input, ALL_FORMATS, BlobSource, CanvasSink } = mediabunny;

        const input = new Input({
          source: new BlobSource(mediaItem.blob),
          formats: ALL_FORMATS,
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) {
          input[Symbol.dispose]?.();
          return null;
        }

        const canDecode = await videoTrack.canDecode();
        if (!canDecode) {
          input[Symbol.dispose]?.();
          return null;
        }

        const sinkWidth = settings.width || 1920;
        const sinkHeight = settings.height || 1080;
        const sink = new CanvasSink(videoTrack, {
          width: sinkWidth,
          height: sinkHeight,
          fit: "contain",
          poolSize: getAdaptivePoolSize(sinkWidth, sinkHeight),
        });

        return {
          input,
          sink,
          mediaId: clip.mediaId,
          clipId: clip.id,
          trackIndex,
        };
      } catch (error) {
        console.error(
          `[Preview] Failed to init resources for clip ${clip.id}:`,
          error,
        );
        return null;
      }
    };

    const preCacheAllImageBitmaps = async () => {
      const tracks = timelineTracksRef.current;
      const imageTracks = tracks.filter(
        (t) => t.type === "image" && !t.hidden,
      );

      for (const track of imageTracks) {
        for (const clip of track.clips) {
          if (imageBitmapCacheRef.current.has(clip.id)) continue;

          const mediaItem = getMediaItem(clip.mediaId);
          if (mediaItem?.type === "image" && mediaItem.blob) {
            try {
              const bitmap = await createImageBitmap(mediaItem.blob);
              imageBitmapCacheRef.current.set(clip.id, bitmap);
            } catch (error) {
              console.warn(
                `[Preview] Failed to pre-cache image clip ${clip.id}:`,
                error,
              );
            }
          }
        }
      }
    };

    const startMultiTrackPlayback = async () => {
      const initialClips = findAllClipsAtTime(playbackStartPosition);
      const activeTextClips = getActiveTextClips(
        allTextClipsRef.current,
        playbackStartPosition,
      );
      const activeShapeClips = getActiveShapeClips(
        allShapeClipsRef.current,
        playbackStartPosition,
      );

      const audioTracks = timelineTracksRef.current.filter(
        (t) => t.type === "audio" && !t.hidden,
      );
      const hasActiveAudioClip = audioTracks.some((track) =>
        track.clips.some(
          (clip) =>
            playbackStartPosition >= clip.startTime &&
            playbackStartPosition < clip.startTime + clip.duration,
        ),
      );

      const hasAnyVisualContent =
        initialClips.length > 0 ||
        activeTextClips.length > 0 ||
        activeShapeClips.length > 0;
      const hasAnyContent = hasAnyVisualContent || hasActiveAudioClip;

      if (!hasAnyContent && actualEndTime <= 0) {
        pause();
        return;
      }

      await preCacheAllImageBitmaps();

      for (const { clip, trackIndex } of initialClips) {
        if (!playbackResourcesRef.current.has(clip.id)) {
          const resources = await initClipResources(clip, trackIndex);
          if (resources) {
            playbackResourcesRef.current.set(clip.id, resources);
          }
        }
      }

      const hasTextOrShapeContent =
        activeTextClips.length > 0 || activeShapeClips.length > 0;
      if (
        playbackResourcesRef.current.size === 0 &&
        !hasTextOrShapeContent &&
        !hasActiveAudioClip &&
        actualEndTime <= 0
      ) {
        pause();
        return;
      }

      await preDecodeAllAudioBuffers();

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setMasterVolume(isMuted ? 0 : 1);

      const tracksWithAudio = timelineTracksRef.current.filter(
        (t) => (t.type === "audio" || t.type === "video") && !t.hidden,
      );
      for (const track of tracksWithAudio) {
        audioGraph.createTrack({
          trackId: track.id,
          volume: 1,
          pan: 0,
          muted: track.muted || false,
          solo: track.solo || false,
          effects: [],
        });
      }

      await audioGraph.resume();

      const mainCtx = canvas.getContext("2d");
      if (!mainCtx) {
        console.error("[Preview] Failed to get 2D context");
        pause();
        return;
      }

      if (
        !offscreenCanvasRef.current ||
        offscreenCanvasRef.current.width !== canvas.width ||
        offscreenCanvasRef.current.height !== canvas.height
      ) {
        offscreenCanvasRef.current = new OffscreenCanvas(
          canvas.width,
          canvas.height,
        );
        offscreenCtxRef.current = offscreenCanvasRef.current.getContext(
          "2d",
        ) as OffscreenCanvasRenderingContext2D;
      }

      const ctx = offscreenCtxRef.current as unknown as CanvasRenderingContext2D;
      if (!ctx) {
        console.error("[Preview] Failed to get offscreen 2D context");
        pause();
        return;
      }

      const masterClock = getMasterClock();
      masterClock.setDuration(actualEndTime);
      masterClock.seek(playbackStartPosition);

      audioGraph.seekTo(playbackStartPosition);
      audioGraph.startScheduler(getAudioClipsForScheduler);

      await masterClock.play();

      const frameDuration = 1000 / 30;
      let lastFrameTimestamp = performance.now();
      let frameCount = 0;
      let isProcessingFrame = false;

      const processMultiTrackFrame = async () => {
        if (!isActive) {
          cleanupPlaybackResources();
          masterClock.pause();
          return;
        }

        if (isProcessingFrame) {
          return;
        }
        isProcessingFrame = true;

        const currentPlayhead = masterClock.currentTime;

        try {
          if (currentPlayhead >= actualEndTime) {
            isProcessingFrame = false;
            cleanupPlaybackResources();
            cleanupAudioResources();
            masterClock.stop();
            setPlayheadPosition(0);
            startPositionRef.current = 0;
            pause();
            return;
          }

          if (!masterClock.isPlaying) {
            isProcessingFrame = false;
            cleanupPlaybackResources();
            cleanupAudioResources();
            if (!isScrubbingRef.current) {
              pause();
            }
            return;
          }

          const activeClips = findAllClipsAtTime(currentPlayhead);
          const currentTextClips = getActiveTextClips(
            allTextClipsRef.current,
            currentPlayhead,
          );
          const currentShapeClips = getActiveShapeClips(
            allShapeClipsRef.current,
            currentPlayhead,
          );

          const audioTracksForFrame = timelineTracksRef.current.filter(
            (t) => t.type === "audio" && !t.hidden,
          );
          const hasCurrentAudioClip = audioTracksForFrame.some((track) =>
            track.clips.some(
              (clip) =>
                currentPlayhead >= clip.startTime &&
                currentPlayhead < clip.startTime + clip.duration,
            ),
          );

          const hasVisualContent =
            activeClips.length > 0 ||
            currentTextClips.length > 0 ||
            currentShapeClips.length > 0;
          const hasAnyContentAtPlayhead =
            hasVisualContent || hasCurrentAudioClip;

          if (!hasAnyContentAtPlayhead) {
            const nextClipTime = findNextClipStartTime(currentPlayhead);
            const nextTextTime = findNextTextClipStartTime(currentPlayhead);
            const nextShapeTime = findNextShapeClipStartTime(currentPlayhead);
            const nextAudioTime = findNextAudioClipStartTime(currentPlayhead);

            const nextTimes = [
              nextClipTime,
              nextTextTime,
              nextShapeTime,
              nextAudioTime,
            ].filter((t): t is number => t !== null && t < actualEndTime);
            const nextTime =
              nextTimes.length > 0 ? Math.min(...nextTimes) : null;

            if (nextTime !== null) {
              masterClock.seek(nextTime);
              audioGraph.seekTo(nextTime);
              isProcessingFrame = false;
              animationRef.current = requestAnimationFrame(
                processMultiTrackFrame,
              );
              return;
            } else {
              isProcessingFrame = false;
              cleanupPlaybackResources();
              cleanupAudioResources();
              if (!isScrubbingRef.current) {
                masterClock.stop();
                setPlayheadPosition(0);
                startPositionRef.current = 0;
                pause();
              }
              return;
            }
          }

          for (const { clip, trackIndex } of activeClips) {
            if (!playbackResourcesRef.current.has(clip.id)) {
              const resources = await initClipResources(clip, trackIndex);
              if (resources) {
                playbackResourcesRef.current.set(clip.id, resources);
              }
            }
          }

          const activeClipIds = new Set(activeClips.map((c) => c.clip.id));
          for (const [clipId, resources] of playbackResourcesRef.current) {
            if (!activeClipIds.has(clipId)) {
              resources.input[Symbol.dispose]?.();
              playbackResourcesRef.current.delete(clipId);
            }
          }

          const sortedClips = [...activeClips].sort(
            (a, b) => b.trackIndex - a.trackIndex,
          );

          const imageClipFrames: Array<{
            clip: (typeof sortedClips)[0]["clip"];
            transform: ClipTransform;
            frame: ImageBitmap;
          }> = [];

          const videoClipPromises: Array<
            Promise<{
              clip: (typeof sortedClips)[0]["clip"];
              transform: ClipTransform;
              frame: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
            } | null>
          > = [];

          for (const { clip, track } of sortedClips) {
            if (!isActive) continue;

            const clipLocalTime = currentPlayhead - clip.startTime;

            let transform = getAnimatedTransform(
              (clip.transform as ClipTransform) || DEFAULT_TRANSFORM,
              clip.keyframes,
              clipLocalTime,
            );

            if (
              clip.emphasisAnimation &&
              clip.emphasisAnimation.type !== "none"
            ) {
              const emphasisState = applyEmphasisAnimation(
                clip.emphasisAnimation,
                clipLocalTime,
              );
              transform = {
                ...transform,
                opacity: transform.opacity * emphasisState.opacity,
                scale: {
                  x:
                    transform.scale.x *
                    emphasisState.scale *
                    emphasisState.scaleX,
                  y:
                    transform.scale.y *
                    emphasisState.scale *
                    emphasisState.scaleY,
                },
                position: {
                  x:
                    transform.position.x + emphasisState.offsetX * canvas.width,
                  y:
                    transform.position.y +
                    emphasisState.offsetY * canvas.height,
                },
                rotation: transform.rotation + emphasisState.rotation,
              };
            }

            if (track.type === "image") {
              const cachedBitmap = imageBitmapCacheRef.current.get(clip.id);
              if (cachedBitmap) {
                imageClipFrames.push({ clip, transform, frame: cachedBitmap });
              }
              continue;
            }

            videoClipPromises.push(
              (async () => {
                const resources = playbackResourcesRef.current.get(clip.id);
                if (!resources) return null;

                const speedEngine = getSpeedEngine();
                const adjustedLocalTime =
                  speedEngine.getSourceTimeAtPlaybackTime(
                    clip.id,
                    clipLocalTime,
                  );
                const mediaTime = (clip.inPoint || 0) + adjustedLocalTime;

                try {
                  const frameResult = await (
                    resources.sink as {
                      getCanvas: (time: number) => Promise<{
                        canvas: HTMLCanvasElement | OffscreenCanvas;
                        timestamp: number;
                        duration: number;
                      } | null>;
                    }
                  ).getCanvas(mediaTime);

                  if (!isActive) return null;

                  if (frameResult?.canvas) {
                    let processedFrame:
                      | ImageBitmap
                      | HTMLCanvasElement
                      | OffscreenCanvas = frameResult.canvas;

                    try {
                      const frameBitmap = await createImageBitmap(
                        frameResult.canvas,
                      );
                      processedFrame = await applyEffectsToFrame(
                        clip.id,
                        frameBitmap,
                      );
                    } catch {}

                    return { clip, transform, frame: processedFrame };
                  }
                } catch (error) {
                  const errorMessage =
                    error instanceof Error ? error.message : String(error);
                  if (errorMessage.includes("disposed") || !isActive) {
                    return null;
                  }
                  console.warn(
                    `[Preview] Failed to get frame for clip ${clip.id}:`,
                    error,
                  );
                }
                return null;
              })(),
            );
          }

          const videoFrameResults = await Promise.all(videoClipPromises);
          const validVideoFrames = videoFrameResults.filter(
            (f): f is NonNullable<typeof f> => f !== null,
          );

          const validFrames = [...imageClipFrames, ...validVideoFrames];

          if (
            validFrames.length > 0 ||
            currentTextClips.length > 0 ||
            currentShapeClips.length > 0
          ) {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const activeShapeClips = getActiveShapeClips(
              allShapeClipsRef.current,
              currentPlayhead,
            );
            const activeTextClips = getActiveTextClips(
              allTextClipsRef.current,
              currentPlayhead,
            );
            const tracks = timelineTracksRef.current;

            const clipToTrackIndex = new Map<string, number>();
            tracks.forEach((track, idx) => {
              if (
                (track.type === "video" || track.type === "image") &&
                !track.hidden
              ) {
                for (const clip of track.clips) {
                  clipToTrackIndex.set(clip.id, idx);
                }
              }
            });

            const allRenderableTracks = tracks
              .map((track, idx) => ({ track, originalIndex: idx }))
              .filter(
                ({ track }) =>
                  (track.type === "video" ||
                    track.type === "image" ||
                    track.type === "text" ||
                    track.type === "graphics") &&
                  !track.hidden,
              )
              .sort((a, b) => b.originalIndex - a.originalIndex);

            const useGPU =
              rendererRef.current && rendererRef.current.type === "webgpu";

            if (useGPU) {
              const gpuLayers: GPULayer[] = [];
              const tempBitmaps: ImageBitmap[] = [];

              for (const { track, originalIndex } of allRenderableTracks) {
                if (track.type === "video") {
                  const trackFrames = validFrames.filter(
                    (f) => clipToTrackIndex.get(f.clip.id) === originalIndex,
                  );
                  for (const { transform, frame } of trackFrames) {
                    if (frame instanceof ImageBitmap) {
                      gpuLayers.push({
                        bitmap: frame,
                        transform,
                      });
                    }
                  }
                } else if (track.type === "image") {
                  const trackFrames = validFrames.filter(
                    (f) => clipToTrackIndex.get(f.clip.id) === originalIndex,
                  );
                  for (const { transform, frame } of trackFrames) {
                    drawFrameWithTransform(
                      ctx,
                      frame,
                      transform,
                      canvas.width,
                      canvas.height,
                    );
                  }
                } else if (track.type === "graphics") {
                  const trackShapeClips = activeShapeClips.filter(
                    (sc) => sc.trackId === track.id,
                  );
                  for (const shapeClip of trackShapeClips) {
                    const offscreen = new OffscreenCanvas(
                      canvas.width,
                      canvas.height,
                    );
                    const offCtx = offscreen.getContext("2d");
                    if (offCtx) {
                      renderShapeClipToCanvas(
                        offCtx as unknown as CanvasRenderingContext2D,
                        shapeClip,
                        canvas.width,
                        canvas.height,
                        currentPlayhead,
                      );
                      const bitmap = await createImageBitmap(offscreen);
                      tempBitmaps.push(bitmap);
                      gpuLayers.push({
                        bitmap,
                        transform: {
                          ...DEFAULT_TRANSFORM,
                          opacity: 1,
                          scale: { x: 1, y: 1 },
                          position: { x: 0, y: 0 },
                          anchor: { x: 0, y: 0 },
                        },
                      });
                    }
                  }
                } else if (track.type === "text") {
                  const trackTextClips = activeTextClips.filter(
                    (tc) => tc.trackId === track.id,
                  );
                  for (const textClip of trackTextClips) {
                    const offscreen = new OffscreenCanvas(
                      canvas.width,
                      canvas.height,
                    );
                    const offCtx = offscreen.getContext("2d");
                    if (offCtx) {
                      renderTextClipToCanvas(
                        offCtx as unknown as CanvasRenderingContext2D,
                        textClip,
                        canvas.width,
                        canvas.height,
                        currentPlayhead,
                      );
                      const bitmap = await createImageBitmap(offscreen);
                      tempBitmaps.push(bitmap);
                      gpuLayers.push({
                        bitmap,
                        transform: {
                          ...DEFAULT_TRANSFORM,
                          opacity: 1,
                          scale: { x: 1, y: 1 },
                          position: { x: 0, y: 0 },
                          anchor: { x: 0, y: 0 },
                        },
                      });
                    }
                  }
                }
              }

              if (gpuLayers.length > 0) {
                const gpuResult = await renderAllLayersWithGPU(
                  rendererRef.current!,
                  gpuLayers,
                  canvas.width,
                  canvas.height,
                );
                if (gpuResult) {
                  ctx.drawImage(gpuResult, 0, 0);
                  gpuResult.close();
                } else {
                  for (const layer of gpuLayers) {
                    drawFrameWithTransform(
                      ctx,
                      layer.bitmap,
                      layer.transform,
                      canvas.width,
                      canvas.height,
                    );
                  }
                }
              }

              for (const bitmap of tempBitmaps) {
                bitmap.close();
              }
            } else {
              for (const { track, originalIndex } of allRenderableTracks) {
                if (track.type === "video" || track.type === "image") {
                  const trackFrames = validFrames.filter(
                    (f) => clipToTrackIndex.get(f.clip.id) === originalIndex,
                  );
                  for (const { transform, frame } of trackFrames) {
                    drawFrameWithTransform(
                      ctx,
                      frame,
                      transform,
                      canvas.width,
                      canvas.height,
                    );
                  }
                } else if (track.type === "graphics") {
                  const trackShapeClips = activeShapeClips.filter(
                    (sc) => sc.trackId === track.id,
                  );
                  for (const shapeClip of trackShapeClips) {
                    renderShapeClipToCanvas(
                      ctx,
                      shapeClip,
                      canvas.width,
                      canvas.height,
                      currentPlayhead,
                    );
                  }
                } else if (track.type === "text") {
                  const trackTextClips = activeTextClips.filter(
                    (tc) => tc.trackId === track.id,
                  );
                  for (const textClip of trackTextClips) {
                    renderTextClipToCanvas(
                      ctx,
                      textClip,
                      canvas.width,
                      canvas.height,
                      currentPlayhead,
                    );
                  }
                }
              }
            }

            const activeSubtitles = getActiveSubtitles(
              allSubtitlesRef.current,
              currentPlayhead,
            );
            for (const subtitle of activeSubtitles) {
              renderSubtitleToCanvas(
                ctx,
                subtitle,
                canvas.width,
                canvas.height,
                currentPlayhead,
              );
            }

            mainCtx.drawImage(offscreenCanvasRef.current!, 0, 0);

            try {
              lastGoodFrameRef.current?.close();
              lastGoodFrameRef.current = await createImageBitmap(offscreenCanvasRef.current!);
            } catch {}
          } else if (lastGoodFrameRef.current) {
            ctx.drawImage(
              lastGoodFrameRef.current,
              0,
              0,
              canvas.width,
              canvas.height,
            );

            const activeSubtitles = getActiveSubtitles(
              allSubtitlesRef.current,
              currentPlayhead,
            );
            for (const subtitle of activeSubtitles) {
              renderSubtitleToCanvas(
                ctx,
                subtitle,
                canvas.width,
                canvas.height,
                currentPlayhead,
              );
            }

            mainCtx.drawImage(offscreenCanvasRef.current!, 0, 0);
          }

          frameCount++;
          masterClock.reportVideoTime(currentPlayhead);
          const nowMulti = performance.now();
          if (nowMulti - lastPlayheadUpdateRef.current >= PLAYHEAD_UPDATE_THROTTLE_MS) {
            lastPlayheadUpdateRef.current = nowMulti;
            setPlayheadPosition(currentPlayhead);
          }

          const now = performance.now();
          const elapsed = now - lastFrameTimestamp;
          const targetTime = frameDuration / rateRef.current;

          const delay = Math.max(0, targetTime - elapsed);
          lastFrameTimestamp = now;

          isProcessingFrame = false;

          if (isActive) {
            if (delay > 0) {
              setTimeout(() => {
                if (isActive) {
                  animationRef.current = requestAnimationFrame(
                    processMultiTrackFrame,
                  );
                }
              }, delay);
            } else {
              animationRef.current = requestAnimationFrame(
                processMultiTrackFrame,
              );
            }
          }
        } catch (error) {
          isProcessingFrame = false;
          console.error("[Preview] Multi-track frame error:", error);
          cleanupPlaybackResources();
          pause();
        }
      };

      animationRef.current = requestAnimationFrame(processMultiTrackFrame);
    };

    const findNextClipStartTime = (afterTime: number): number | null => {
      const tracks = timelineTracksRef.current;
      const videoTracks = tracks.filter(
        (t) => (t.type === "video" || t.type === "image") && !t.hidden,
      );
      let nextStart: number | null = null;

      for (const track of videoTracks) {
        for (const clip of track.clips) {
          if (clip.startTime > afterTime) {
            if (nextStart === null || clip.startTime < nextStart) {
              nextStart = clip.startTime;
            }
          }
        }
      }

      return nextStart;
    };

    const findNextTextClipStartTime = (afterTime: number): number | null => {
      const textClips = allTextClipsRef.current;
      let nextStart: number | null = null;

      for (const clip of textClips) {
        if (clip.startTime > afterTime) {
          if (nextStart === null || clip.startTime < nextStart) {
            nextStart = clip.startTime;
          }
        }
      }

      return nextStart;
    };

    const findNextShapeClipStartTime = (afterTime: number): number | null => {
      const shapeClips = allShapeClipsRef.current;
      let nextStart: number | null = null;

      for (const clip of shapeClips) {
        if (clip.startTime > afterTime) {
          if (nextStart === null || clip.startTime < nextStart) {
            nextStart = clip.startTime;
          }
        }
      }

      return nextStart;
    };

    const findNextAudioClipStartTime = (afterTime: number): number | null => {
      const tracks = timelineTracksRef.current;
      const audioTracks = tracks.filter((t) => t.type === "audio" && !t.hidden);
      let nextStart: number | null = null;

      for (const track of audioTracks) {
        for (const clip of track.clips) {
          if (clip.startTime > afterTime) {
            if (nextStart === null || clip.startTime < nextStart) {
              nextStart = clip.startTime;
            }
          }
        }
      }

      return nextStart;
    };

    const startPlayback = async () => {
      const nativeCheck = canUseNativeVideoPlayback(playbackStartPosition);

      if (nativeCheck.canUse && nativeCheck.clips.length > 0) {
        try {
          const cleanup = await startNativeVideoPlayback(
            nativeCheck.clips,
            nativeCheck.imageClips || [],
            playbackStartPosition,
            () => pause(),
          );
          return cleanup;
        } catch (error) {
          console.warn(
            "[Preview] Native video playback failed, falling back to MediaBunny:",
            error,
          );
        }
      }
      await startMultiTrackPlayback();
    };

    startPlayback().catch((error) => {
      console.error("[Preview] startPlayback error:", error);
    });

    return () => {
      isActive = false;
      nativePlaybackActiveRef.current = false;
      const masterClock = getMasterClock();
      if (masterClock.isPlaying || masterClock.isPaused) {
        startPositionRef.current = masterClock.currentTime;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (videoElementRef.current) {
        videoElementRef.current.pause();
        videoElementRef.current.src = "";
        videoElementRef.current = null;
      }
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
      masterClock.pause();
      cleanupAudioResources();
    };
  }, [
    isPlaying,
    canUseNativeVideoPlayback,
    startNativeVideoPlayback,
    actualEndTime,
    setPlayheadPosition,
    pause,
    getMediaItem,
    cleanupPlaybackResources,
    cleanupAudioResources,
    setupAudioFromAudioTrack,
    preDecodeAllAudioBuffers,
    getAudioClipsForScheduler,
    isMuted,
    settings.width,
    settings.height,
  ]);

  const lastModifiedAtRef = useRef<number>(project.modifiedAt);

  useEffect(() => {
    if (isPlaying) return;

    // COMPLETELY skip rendering during resize/move interactions
    // The last rendered frame stays visible, preventing black flashing
    if (isInteractingRef.current) {
      lastModifiedAtRef.current = project.modifiedAt;
      return;
    }
    lastModifiedAtRef.current = project.modifiedAt;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderFrame = async () => {
      const rendered = await renderFrameDirectly(playheadPosition);
      if (!rendered) {
        renderFallbackFrame(playheadPosition);
      }
    };

    renderFrame();
  }, [
    playheadPosition,
    isPlaying,
    renderFrameDirectly,
    renderFallbackFrame,
    project.modifiedAt,
    isDark,
  ]);

  const selectedClipId = useMemo(() => {
    const clipSelection = selectedItems.find((item) => item.type === "clip");
    return clipSelection?.id || null;
  }, [selectedItems]);

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const track of timelineTracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId);
      if (clip) return clip;
    }
    return null;
  }, [selectedClipId, timelineTracks]);

  const clipAtPlayhead = useMemo(() => {
    const videoTracks = timelineTracks.filter(
      (t) => (t.type === "video" || t.type === "image") && !t.hidden,
    );
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;
        if (playheadPosition >= clipStart && playheadPosition < clipEnd) {
          return clip;
        }
      }
    }
    return null;
  }, [timelineTracks, playheadPosition]);

  const selectedTextClipId = useMemo(() => {
    const textClipSelection = selectedItems.find(
      (item) => item.type === "text-clip",
    );
    return textClipSelection?.id || null;
  }, [selectedItems]);

  const selectedTextClip = useMemo<TextClip | null>(() => {
    if (!selectedTextClipId) return null;
    return allTextClips.find((clip) => clip.id === selectedTextClipId) || null;
  }, [selectedTextClipId, allTextClips]);

  const activeTextClip = selectedTextClip;

  const clipBounds = useMemo(() => {
    const clip = selectedClip || clipAtPlayhead;
    if (!clip || !canvasRef.current || !overlayRef.current) return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const clipTransform = clip.transform || {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchor: { x: 0.5, y: 0.5 },
    };

    const transform = liveTransform
      ? {
          ...clipTransform,
          position: liveTransform.position,
          scale: liveTransform.scale,
        }
      : clipTransform;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    const clipWidth = canvasWidth * transform.scale.x * displayScale;
    const clipHeight = canvasHeight * transform.scale.y * displayScale;

    const offsetX = transform.position.x * displayScale;
    const offsetY = transform.position.y * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + actualWidth / 2 + offsetX;
    const centerY = canvasOffsetY + actualHeight / 2 + offsetY;

    return {
      x: centerX - clipWidth / 2,
      y: centerY - clipHeight / 2,
      width: clipWidth,
      height: clipHeight,
      centerX,
      centerY,
      displayScale,
    };
  }, [
    selectedClip,
    clipAtPlayhead,
    settings.width,
    settings.height,
    canvasSize,
    liveTransform,
  ]);

  const textClipBounds = useMemo(() => {
    if (!selectedTextClip || !canvasRef.current || !overlayRef.current)
      return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const { transform, style, text } = selectedTextClip;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    const lines = text.split("\n");
    const lineHeight = style.fontSize * style.lineHeight;
    const estimatedHeight = lines.length * lineHeight;
    const estimatedWidth =
      style.fontSize * Math.max(...lines.map((l) => l.length)) * 0.6;

    const textWidth = estimatedWidth * transform.scale.x * displayScale;
    const textHeight = estimatedHeight * transform.scale.y * displayScale;

    const posX = transform.position.x * canvasWidth * displayScale;
    const posY = transform.position.y * canvasHeight * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + posX;
    const centerY = canvasOffsetY + posY;

    return {
      x: centerX - textWidth / 2,
      y: centerY - textHeight / 2,
      width: textWidth,
      height: textHeight,
      centerX,
      centerY,
      displayScale,
      isTextClip: true,
    };
  }, [selectedTextClip, settings.width, settings.height, canvasSize]);

  const selectedShapeClipId = useMemo(() => {
    const shapeClipSelection = selectedItems.find(
      (item) => item.type === "shape-clip",
    );
    return shapeClipSelection?.id || null;
  }, [selectedItems]);

  const selectedShapeClip = useMemo<
    ShapeClip | SVGClip | StickerClip | null
  >(() => {
    if (!selectedShapeClipId) return null;
    return (
      allShapeClips.find((clip) => clip.id === selectedShapeClipId) || null
    );
  }, [selectedShapeClipId, allShapeClips]);

  const activeShapeClip = selectedShapeClip;

  const shapeClipBounds = useMemo(() => {
    if (!selectedShapeClip || !canvasRef.current || !overlayRef.current)
      return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const { transform } = selectedShapeClip;
    const shapeSize = 200;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    const shapeWidth = shapeSize * transform.scale.x * displayScale;
    const shapeHeight = shapeSize * transform.scale.y * displayScale;

    const posX = transform.position.x * canvasWidth * displayScale;
    const posY = transform.position.y * canvasHeight * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + posX;
    const centerY = canvasOffsetY + posY;

    return {
      x: centerX - shapeWidth / 2,
      y: centerY - shapeHeight / 2,
      width: shapeWidth,
      height: shapeHeight,
      centerX,
      centerY,
      displayScale,
      isShapeClip: true,
    };
  }, [selectedShapeClip, settings.width, settings.height, canvasSize]);

  const selectedSubtitleId = useMemo(() => {
    const subtitleSelection = selectedItems.find(
      (item) => item.type === "subtitle",
    );
    return subtitleSelection?.id || null;
  }, [selectedItems]);

  const selectedSubtitleObj = useMemo<Subtitle | null>(() => {
    if (!selectedSubtitleId) return null;
    return allSubtitles.find((sub) => sub.id === selectedSubtitleId) || null;
  }, [selectedSubtitleId, allSubtitles]);

  const subtitleBounds = useMemo(() => {
    if (!selectedSubtitleObj || !canvasRef.current || !overlayRef.current)
      return null;
    if (
      playheadPosition < selectedSubtitleObj.startTime ||
      playheadPosition >= selectedSubtitleObj.endTime
    )
      return null;

    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const fontSize = selectedSubtitleObj.style?.fontSize || 24;
    const position = selectedSubtitleObj.style?.position || "bottom";
    const lines = selectedSubtitleObj.text.split("\n");
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;

    const canvasWidth = settings.width;
    const canvasHeight = settings.height;

    const canvasAspect = canvasWidth / canvasHeight;
    const elementAspect = canvasRect.width / canvasRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let letterboxOffsetX = 0;
    let letterboxOffsetY = 0;

    if (elementAspect > canvasAspect) {
      actualHeight = canvasRect.height;
      actualWidth = actualHeight * canvasAspect;
      letterboxOffsetX = (canvasRect.width - actualWidth) / 2;
    } else {
      actualWidth = canvasRect.width;
      actualHeight = actualWidth / canvasAspect;
      letterboxOffsetY = (canvasRect.height - actualHeight) / 2;
    }

    const displayScale = actualWidth / canvasWidth;

    let baseY: number;
    if (position === "top") {
      baseY = fontSize * 2;
    } else if (position === "center") {
      baseY = canvasHeight / 2 - totalHeight / 2;
    } else {
      baseY = canvasHeight - fontSize * 2 - totalHeight;
    }

    const subtitleWidth = canvasWidth * 0.8 * displayScale;
    const subtitleHeight = totalHeight * displayScale;

    const canvasOffsetX = canvasRect.left - overlayRect.left + letterboxOffsetX;
    const canvasOffsetY = canvasRect.top - overlayRect.top + letterboxOffsetY;

    const centerX = canvasOffsetX + actualWidth / 2;
    const topY = canvasOffsetY + baseY * displayScale;

    return {
      x: centerX - subtitleWidth / 2,
      y: topY,
      width: subtitleWidth,
      height: subtitleHeight,
      centerX,
      centerY: topY + subtitleHeight / 2,
      displayScale,
    };
  }, [
    selectedSubtitleObj,
    settings.width,
    settings.height,
    canvasSize,
    playheadPosition,
  ]);

  const handleHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      const clip = selectedClip || clipAtPlayhead;
      if (!clip) return;

      const transform = clip.transform || {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
        anchor: { x: 0.5, y: 0.5 },
      };

      isInteractingRef.current = true;
      setInteractionMode("resize");
      setActiveHandle(handle);
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [selectedClip, clipAtPlayhead],
  );

  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const clip = selectedClip || clipAtPlayhead;
      if (!clip) return;

      const transform = clip.transform || {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
        anchor: { x: 0.5, y: 0.5 },
      };

      isInteractingRef.current = true;
      setInteractionMode("move");
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [selectedClip, clipAtPlayhead],
  );

  const handleTextClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeTextClip) return;

      const { transform } = activeTextClip;

      isInteractingRef.current = true;
      setInteractionMode("move");
      setInteractionTargetType("text-clip");
      interactionTargetIdRef.current = activeTextClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeTextClip],
  );

  const handleTextHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeTextClip) return;

      const { transform } = activeTextClip;

      isInteractingRef.current = true;
      setInteractionMode("resize");
      setActiveHandle(handle);
      setInteractionTargetType("text-clip");
      interactionTargetIdRef.current = activeTextClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeTextClip],
  );

  const handleShapeClipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeShapeClip) return;

      const { transform } = activeShapeClip;

      isInteractingRef.current = true;
      setInteractionMode("move");
      setInteractionTargetType("shape-clip");
      interactionTargetIdRef.current = activeShapeClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeShapeClip],
  );

  const handleShapeHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();

      if (!activeShapeClip) return;

      const { transform } = activeShapeClip;

      isInteractingRef.current = true;
      setInteractionMode("resize");
      setActiveHandle(handle);
      setInteractionTargetType("shape-clip");
      interactionTargetIdRef.current = activeShapeClip.id;
      interactionStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transform: {
          x: transform.position.x,
          y: transform.position.y,
          scaleX: transform.scale.x,
          scaleY: transform.scale.y,
        },
      };
    },
    [activeShapeClip],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (interactionMode === "none" || !interactionStartRef.current) return;

      if (
        interactionTargetType === "text-clip" &&
        textClipBounds &&
        activeTextClip
      ) {
        const deltaX = e.clientX - interactionStartRef.current.x;
        const deltaY = e.clientY - interactionStartRef.current.y;
        const { displayScale } = textClipBounds;

        let newTransform: {
          position?: { x: number; y: number };
          scale?: { x: number; y: number };
        } = {};

        if (interactionMode === "move") {
          const newX =
            interactionStartRef.current.transform.x +
            deltaX / displayScale / settings.width;
          const newY =
            interactionStartRef.current.transform.y +
            deltaY / displayScale / settings.height;
          newTransform = { position: { x: newX, y: newY } };
        } else if (interactionMode === "resize" && activeHandle) {
          const startTransform = interactionStartRef.current.transform;
          let newScaleX = startTransform.scaleX;
          let newScaleY = startTransform.scaleY;

          const scaleDeltaX = deltaX / displayScale / 100;
          const scaleDeltaY = deltaY / displayScale / 100;

          switch (activeHandle) {
            case "e":
            case "se":
            case "ne":
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "w":
            case "sw":
            case "nw":
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "s":
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
            case "n":
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
          }

          newTransform = {
            position: { x: startTransform.x, y: startTransform.y },
            scale: { x: newScaleX, y: newScaleY },
          };
        }

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            const now = performance.now();
            if (
              now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS &&
              interactionTargetIdRef.current
            ) {
              lastStoreUpdateRef.current = now;
              updateTextTransform(interactionTargetIdRef.current, newTransform);
            }
            rafIdRef.current = null;
          });
        }
        return;
      }

      if (
        interactionTargetType === "shape-clip" &&
        shapeClipBounds &&
        activeShapeClip
      ) {
        const deltaX = e.clientX - interactionStartRef.current.x;
        const deltaY = e.clientY - interactionStartRef.current.y;
        const { displayScale } = shapeClipBounds;

        let newTransform: {
          position?: { x: number; y: number };
          scale?: { x: number; y: number };
        } = {};

        if (interactionMode === "move") {
          const newX =
            interactionStartRef.current.transform.x +
            deltaX / displayScale / settings.width;
          const newY =
            interactionStartRef.current.transform.y +
            deltaY / displayScale / settings.height;
          newTransform = { position: { x: newX, y: newY } };
        } else if (interactionMode === "resize" && activeHandle) {
          const startTransform = interactionStartRef.current.transform;
          let newScaleX = startTransform.scaleX;
          let newScaleY = startTransform.scaleY;

          const scaleDeltaX = deltaX / displayScale / 100;
          const scaleDeltaY = deltaY / displayScale / 100;

          switch (activeHandle) {
            case "e":
            case "se":
            case "ne":
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "w":
            case "sw":
            case "nw":
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              if (lockAspectRatio) newScaleY = newScaleX;
              break;
            case "s":
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
            case "n":
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
              if (lockAspectRatio) newScaleX = newScaleY;
              break;
          }

          newTransform = {
            position: { x: startTransform.x, y: startTransform.y },
            scale: { x: newScaleX, y: newScaleY },
          };
        }

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            const now = performance.now();
            if (
              now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS &&
              interactionTargetIdRef.current
            ) {
              lastStoreUpdateRef.current = now;
              updateShapeTransform(
                interactionTargetIdRef.current,
                newTransform,
              );
            }
            rafIdRef.current = null;
          });
        }
        return;
      }

      if (!clipBounds) return;
      const clip = selectedClip || clipAtPlayhead;
      if (!clip) return;

      const deltaX = e.clientX - interactionStartRef.current.x;
      const deltaY = e.clientY - interactionStartRef.current.y;
      const { displayScale } = clipBounds;

      let newTransform: {
        position?: { x: number; y: number };
        scale?: { x: number; y: number };
      } = {};

      if (interactionMode === "move") {
        const newX =
          interactionStartRef.current.transform.x + deltaX / displayScale;
        const newY =
          interactionStartRef.current.transform.y + deltaY / displayScale;

        newTransform = { position: { x: newX, y: newY } };
      } else if (interactionMode === "resize" && activeHandle) {
        const startTransform = interactionStartRef.current.transform;
        let newScaleX = startTransform.scaleX;
        let newScaleY = startTransform.scaleY;
        let newX = startTransform.x;
        let newY = startTransform.y;

        const scaleDeltaX = deltaX / displayScale / (settings.width / 2);
        const scaleDeltaY = deltaY / displayScale / (settings.height / 2);

        switch (activeHandle) {
          case "e":
            newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
            if (lockAspectRatio) newScaleY = newScaleX;
            break;
          case "w":
            newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
            if (lockAspectRatio) newScaleY = newScaleX;
            newX = startTransform.x + deltaX / displayScale / 2;
            break;
          case "s":
            newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
            if (lockAspectRatio) newScaleX = newScaleY;
            break;
          case "n":
            newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
            if (lockAspectRatio) newScaleX = newScaleY;
            newY = startTransform.y + deltaY / displayScale / 2;
            break;
          case "se":
            if (lockAspectRatio) {
              const avgDelta = (scaleDeltaX + scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
            }
            break;
          case "sw":
            if (lockAspectRatio) {
              const avgDelta = (-scaleDeltaX + scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY + scaleDeltaY);
            }
            newX = startTransform.x + deltaX / displayScale / 2;
            break;
          case "ne":
            if (lockAspectRatio) {
              const avgDelta = (scaleDeltaX - scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX + scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
            }
            newY = startTransform.y + deltaY / displayScale / 2;
            break;
          case "nw":
            if (lockAspectRatio) {
              const avgDelta = (-scaleDeltaX - scaleDeltaY) / 2;
              newScaleX = Math.max(0.1, startTransform.scaleX + avgDelta);
              newScaleY = newScaleX;
            } else {
              newScaleX = Math.max(0.1, startTransform.scaleX - scaleDeltaX);
              newScaleY = Math.max(0.1, startTransform.scaleY - scaleDeltaY);
            }
            newX = startTransform.x + deltaX / displayScale / 2;
            newY = startTransform.y + deltaY / displayScale / 2;
            break;
        }

        newTransform = {
          position: { x: newX, y: newY },
          scale: { x: newScaleX, y: newScaleY },
        };
      }

      pendingTransformRef.current = {
        clipId: clip.id,
        transform: newTransform,
      };

      const currentTransform = clip.transform || {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
      };
      setLiveTransform({
        position: newTransform.position || currentTransform.position,
        scale: newTransform.scale || currentTransform.scale,
      });

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          const now = performance.now();
          if (
            pendingTransformRef.current &&
            now - lastStoreUpdateRef.current >= STORE_UPDATE_THROTTLE_MS
          ) {
            lastStoreUpdateRef.current = now;
            updateClipTransform(
              pendingTransformRef.current.clipId,
              pendingTransformRef.current.transform,
            );
          }
          rafIdRef.current = null;
        });
      }
    },
    [
      interactionMode,
      activeHandle,
      clipBounds,
      selectedClip,
      clipAtPlayhead,
      updateClipTransform,
      settings.width,
      settings.height,
      lockAspectRatio,
      interactionTargetType,
      textClipBounds,
      activeTextClip,
      updateTextTransform,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (pendingTransformRef.current) {
      updateClipTransform(
        pendingTransformRef.current.clipId,
        pendingTransformRef.current.transform,
      );
      pendingTransformRef.current = null;
    }
    setInteractionTargetType(null);
    interactionTargetIdRef.current = null;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const wasInteracting = isInteractingRef.current;
    isInteractingRef.current = false;
    setInteractionMode("none");
    setActiveHandle(null);
    interactionStartRef.current = null;
    setLiveTransform(null);

    if (wasInteracting) {
      renderFrameDirectly(playheadPosition);
    }
  }, [updateClipTransform, renderFrameDirectly, playheadPosition]);

  const handleCropChange = useCallback(
    (crop: { x: number; y: number; width: number; height: number }) => {
      if (cropClipId) {
        updateClipTransform(cropClipId, { crop });
      }
    },
    [cropClipId, updateClipTransform],
  );

  const handleCropComplete = useCallback(() => {
    setCropMode(false);
  }, [setCropMode]);

  const handleCropCancel = useCallback(() => {
    setCropMode(false);
  }, [setCropMode]);

  useEffect(() => {
    if (interactionMode !== "none") {
      const handleGlobalMouseUp = () => {
        if (pendingTransformRef.current) {
          updateClipTransform(
            pendingTransformRef.current.clipId,
            pendingTransformRef.current.transform,
          );
          pendingTransformRef.current = null;
        }
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const wasInteracting = isInteractingRef.current;
        isInteractingRef.current = false;
        setInteractionMode("none");
        setActiveHandle(null);
        interactionStartRef.current = null;
        setLiveTransform(null);

        if (wasInteracting) {
          renderFrameDirectly(playheadPosition);
        }
      };

      window.addEventListener("mouseup", handleGlobalMouseUp);
      return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
    }
  }, [
    interactionMode,
    renderFrameDirectly,
    playheadPosition,
    updateClipTransform,
  ]);

  const handleScrubClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const newTime = percentage * (actualEndTime || 10);
      seekTo(newTime);
    },
    [actualEndTime, seekTo],
  );

  const handleSkipBack = useCallback(() => {
    seekRelative(-5);
  }, [seekRelative]);

  const handleSkipForward = useCallback(() => {
    seekRelative(5);
  }, [seekRelative]);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container
        .requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
        })
        .catch((err) => {
          console.error("Error entering fullscreen:", err);
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          setIsFullscreen(false);
        })
        .catch((err) => {
          console.error("Error exiting fullscreen:", err);
        });
    }
  }, []);

  const handleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const progressPercentage =
    actualEndTime > 0 ? (playheadPosition / actualEndTime) * 100 : 0;

  const showResizeHandles = !isPlaying && selectedClip && clipBounds;

  const showTextClipHandles = !isPlaying && selectedTextClip && textClipBounds;

  const showShapeClipHandles =
    !isPlaying && selectedShapeClip && shapeClipBounds;

  const showSubtitleOverlay =
    !isPlaying && selectedSubtitleObj && subtitleBounds;

  const cropClip = useMemo(() => {
    if (!cropMode || !cropClipId) return null;

    for (const track of timelineTracks) {
      const clip = track.clips.find((c) => c.id === cropClipId);
      if (clip) return clip;
    }
    return null;
  }, [cropMode, cropClipId, timelineTracks]);

  const cropMediaData = useMemo(() => {
    if (!cropMode || !cropClipId || !cropClip) return null;

    const mediaItem = getMediaItem(cropClip.mediaId);
    if (!mediaItem) return null;

    let src: string | null = null;
    if (mediaItem.blob) {
      src = URL.createObjectURL(mediaItem.blob);
    } else if (mediaItem.originalUrl) {
      src = mediaItem.originalUrl;
    }

    if (!src) return null;

    return {
      src,
      type: mediaItem.type as "video" | "image",
    };
  }, [cropMode, cropClipId, cropClip, getMediaItem]);

  const cropVideoSrc = cropMediaData?.src ?? null;
  const cropMediaType = cropMediaData?.type ?? "video";

  const shouldShowCropMode = cropMode && cropClipId && cropClip && cropVideoSrc;

  return (
    <div
      ref={containerRef}
      data-tour="preview"
      className="flex-1 bg-background flex flex-col relative group overflow-hidden"
    >
      {/* Crop Mode View - Full Screen Overlay */}
      {shouldShowCropMode && (
        <CropModeView
          clip={cropClip!}
          videoSrc={cropVideoSrc}
          mediaType={cropMediaType}
          currentTime={playheadPosition}
          canvasWidth={canvasSize.width}
          canvasHeight={canvasSize.height}
          onCropChange={handleCropChange}
          onComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}

      {/* Video Area */}
      <div
        className={`flex-1 relative flex items-center justify-center bg-background-secondary/30 transition-all duration-300 ${
          isMaximized || isFullscreen ? "p-0" : "p-4"
        }`}
        onMouseMove={interactionMode !== "none" ? handleMouseMove : undefined}
        onMouseUp={handleMouseUp}
      >
        <div
          ref={overlayRef}
          className={`relative bg-black overflow-hidden transition-all duration-300 ${
            isMaximized || isFullscreen
              ? "rounded-none ring-0 shadow-none"
              : "shadow-2xl rounded-xl ring-1 ring-border shadow-[0_0_50px_rgba(0,0,0,0.5)]"
          }`}
          style={
            isMaximized || isFullscreen
              ? {
                  width: "100%",
                  height: "100%",
                  maxWidth: "none",
                }
              : {
                  height: "450px",
                  width: `calc(450px * ${settings.width} / ${settings.height})`,
                  maxWidth: "800px",
                }
          }
        >
          <canvas
            ref={canvasRef}
            width={settings.width}
            height={settings.height}
            className="w-full h-full object-contain bg-black"
            style={{
              cursor: "default",
            }}
          />

          {/* Processing Overlay */}
          <ProcessingOverlay />

          {/* Motion Path Overlay */}
          {motionPathMode && motionPathConfig && motionPathClip && (
            <div className="absolute inset-0 pointer-events-auto z-30">
              <MotionPathOverlay
                config={motionPathConfig}
                canvasWidth={settings.width}
                canvasHeight={settings.height}
                currentTime={playheadPosition - motionPathClip.startTime}
                clipDuration={motionPathClip.duration}
                onPointMove={handleMotionPathPointMove}
                onPointAdd={handleMotionPathPointAdd}
                onPointRemove={handleMotionPathPointRemove}
                onControlPointMove={handleMotionPathControlPointMove}
                disabled={isPlaying}
              />
            </div>
          )}

          {/* Particle Effects Renderer */}
          {particleEffects.length > 0 && (
            <div className="absolute inset-0 pointer-events-none z-20">
              <ParticleRenderer
                effects={particleEffects}
                width={settings.width}
                height={settings.height}
                currentTime={playheadPosition}
                isPlaying={isPlaying}
              />
            </div>
          )}

          {/* Export Overlay */}
          {exportState.isExporting && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-background-secondary/95 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-border">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Loader2 size={20} className="text-primary animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      Exporting Video
                    </h3>
                    <p className="text-xs text-text-muted">
                      {exportState.phase || "Preparing..."}
                    </p>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-text-secondary">
                      Export Progress
                    </span>
                    <span className="text-[10px] text-text-muted font-mono">
                      {Math.round(exportState.progress)}%
                    </span>
                  </div>
                  <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-primary-hover transition-all duration-300"
                      style={{ width: `${exportState.progress}%` }}
                    />
                  </div>
                </div>

                <p className="text-[10px] text-text-muted text-center">
                  Please wait while your video is being exported...
                </p>
              </div>
            </div>
          )}

          {/* Resize/Transform Overlay */}
          {!cropMode && showResizeHandles && clipBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: clipBounds.x,
                top: clipBounds.y,
                width: clipBounds.width,
                height: clipBounds.height,
              }}
            >
              {/* Selection border */}
              <div className="absolute inset-0 border-2 border-primary pointer-events-none" />

              {/* Move handle (center) */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-primary/80 rounded-full flex items-center justify-center cursor-move pointer-events-auto hover:bg-primary transition-colors"
                onMouseDown={handleClipMouseDown}
                title="Drag to move"
              >
                <Move size={14} className="text-white" />
              </div>

              {/* Aspect ratio lock toggle */}
              <button
                className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] rounded pointer-events-auto transition-colors ${
                  lockAspectRatio
                    ? "bg-primary text-white"
                    : "bg-background-tertiary text-text-secondary border border-border hover:bg-background-elevated"
                }`}
                onClick={() => setLockAspectRatio(!lockAspectRatio)}
                title={
                  lockAspectRatio ? "Unlock aspect ratio" : "Lock aspect ratio"
                }
              >
                {lockAspectRatio ? "🔒 Locked" : "🔓 Free"}
              </button>

              {/* Corner resize handles */}
              <div
                className="absolute -left-2 -top-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-nw-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "nw")}
              />
              <div
                className="absolute -right-2 -top-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-ne-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "ne")}
              />
              <div
                className="absolute -left-2 -bottom-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-sw-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "sw")}
              />
              <div
                className="absolute -right-2 -bottom-2 w-4 h-4 bg-white border-2 border-primary rounded-sm cursor-se-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "se")}
              />

              {/* Edge resize handles */}
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-4 bg-white border-2 border-primary rounded-sm cursor-n-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "n")}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-6 h-4 bg-white border-2 border-primary rounded-sm cursor-s-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "s")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-6 bg-white border-2 border-primary rounded-sm cursor-w-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "w")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 bg-white border-2 border-primary rounded-sm cursor-e-resize pointer-events-auto hover:bg-primary hover:border-white transition-colors"
                onMouseDown={(e) => handleHandleMouseDown(e, "e")}
              />
            </div>
          )}

          {/* Text Clip Resize/Transform Overlay */}
          {showTextClipHandles && textClipBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: textClipBounds.x,
                top: textClipBounds.y,
                width: textClipBounds.width,
                height: textClipBounds.height,
              }}
            >
              {/* Selection border - cyan for text clips */}
              <div className="absolute inset-0 border-2 border-cyan-500 pointer-events-none" />

              {/* Move handle (center) */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-cyan-500/80 rounded-full flex items-center justify-center cursor-move pointer-events-auto hover:bg-cyan-500 transition-colors"
                onMouseDown={handleTextClipMouseDown}
                title="Drag to move text"
              >
                <Move size={14} className="text-white" />
              </div>

              {/* Corner resize handles */}
              <div
                className="absolute -left-2 -top-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-nw-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "nw")}
              />
              <div
                className="absolute -right-2 -top-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-ne-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "ne")}
              />
              <div
                className="absolute -left-2 -bottom-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-sw-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "sw")}
              />
              <div
                className="absolute -right-2 -bottom-2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-se-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "se")}
              />

              {/* Edge resize handles */}
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-n-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "n")}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-6 h-4 bg-white border-2 border-cyan-500 rounded-sm cursor-s-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "s")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-6 bg-white border-2 border-cyan-500 rounded-sm cursor-w-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "w")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 bg-white border-2 border-cyan-500 rounded-sm cursor-e-resize pointer-events-auto hover:bg-cyan-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleTextHandleMouseDown(e, "e")}
              />
            </div>
          )}

          {/* Shape Clip Resize/Transform Overlay */}
          {showShapeClipHandles && shapeClipBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: shapeClipBounds.x,
                top: shapeClipBounds.y,
                width: shapeClipBounds.width,
                height: shapeClipBounds.height,
              }}
            >
              {/* Selection border - green for shape clips */}
              <div className="absolute inset-0 border-2 border-green-500 pointer-events-none" />

              {/* Move handle (center) */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-green-500/80 rounded-full flex items-center justify-center cursor-move pointer-events-auto hover:bg-green-500 transition-colors"
                onMouseDown={handleShapeClipMouseDown}
                title="Drag to move shape"
              >
                <Move size={14} className="text-white" />
              </div>

              {/* Corner resize handles */}
              <div
                className="absolute -left-2 -top-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-nw-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "nw")}
              />
              <div
                className="absolute -right-2 -top-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-ne-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "ne")}
              />
              <div
                className="absolute -left-2 -bottom-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-sw-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "sw")}
              />
              <div
                className="absolute -right-2 -bottom-2 w-4 h-4 bg-white border-2 border-green-500 rounded-sm cursor-se-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "se")}
              />

              {/* Edge resize handles */}
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-4 bg-white border-2 border-green-500 rounded-sm cursor-n-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "n")}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-6 h-4 bg-white border-2 border-green-500 rounded-sm cursor-s-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "s")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-6 bg-white border-2 border-green-500 rounded-sm cursor-w-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "w")}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 bg-white border-2 border-green-500 rounded-sm cursor-e-resize pointer-events-auto hover:bg-green-500 hover:border-white transition-colors"
                onMouseDown={(e) => handleShapeHandleMouseDown(e, "e")}
              />
            </div>
          )}

          {/* Subtitle Selection Overlay */}
          {showSubtitleOverlay && subtitleBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: subtitleBounds.x,
                top: subtitleBounds.y,
                width: subtitleBounds.width,
                height: subtitleBounds.height,
              }}
            >
              {/* Selection border - yellow/orange for subtitles */}
              <div className="absolute inset-0 border-2 border-yellow-500 rounded-lg pointer-events-none animate-pulse" />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-yellow-500 rounded text-[10px] font-medium text-black whitespace-nowrap">
                Subtitle Selected - Edit in Inspector
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Player Controls with integrated Scrub Bar */}
      <div
        className={`border-t border-border transition-all duration-300 ${
          isMaximized || isFullscreen
            ? "absolute bottom-0 left-0 right-0 z-50 bg-background-secondary backdrop-blur-sm"
            : "z-20 bg-background-secondary"
        }`}
      >
        {/* Scrub Bar - integrated at top of controls */}
        <div
          className="h-1.5 bg-background-tertiary cursor-pointer group hover:h-2.5 transition-all relative"
          onClick={handleScrubClick}
        >
          <div
            className="h-full bg-primary relative pointer-events-none shadow-[0_0_10px_rgba(34,197,94,0.5)]"
            style={{ width: `${progressPercentage}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity transform scale-0 group-hover:scale-100 duration-100 border border-black/20" />
          </div>
        </div>

        {/* Controls row */}
        <div className="h-12 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="font-mono text-text-primary tabular-nums text-sm w-24 tracking-wider">
            {formatTime(playheadPosition)}
          </div>

          {rendererType !== "none" && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                rendererType === "webgpu"
                  ? "bg-green-500/20 text-green-400"
                  : "bg-gray-500/20 text-gray-400"
              }`}
              title={`Rendering with ${rendererType.toUpperCase()}`}
            >
              {rendererType.toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-6">
          <IconButton
            icon={SkipBack}
            onClick={handleSkipBack}
            title="Skip back 5s"
          />
          <button
            onClick={() => {
              togglePlayback();
            }}
            className="w-10 h-10 rounded-full bg-primary hover:bg-primary-hover active:bg-primary-active flex items-center justify-center text-white transition-all shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_25px_rgba(34,197,94,0.6)] transform hover:scale-105"
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <IconButton
            icon={SkipForward}
            onClick={handleSkipForward}
            title="Skip forward 5s"
          />
        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-2 rounded-lg hover:bg-background-elevated transition-colors ${
              isMuted
                ? "text-red-500"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <div className="w-px h-4 bg-border mx-2" />
          <button
            onClick={handleFullscreen}
            title={isFullscreen ? "Exit Full Screen" : "Full Screen"}
            className={`p-2 rounded-lg transition-colors ${
              isFullscreen
                ? "text-primary bg-primary/20"
                : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            }`}
          >
            <Monitor size={16} />
          </button>
          <button
            onClick={handleMaximize}
            title={isMaximized ? "Restore Size" : "Maximize Preview"}
            className={`p-2 rounded-lg transition-colors ${
              isMaximized
                ? "text-primary bg-primary/20"
                : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
            }`}
          >
            {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
};

export default Preview;

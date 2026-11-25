import { useVoiceOverStore } from "./services/voiceover/voiceover-recorder";
import { useProjectStore } from "./stores/project-store";
import { useObjectMaskStore } from "./stores/object-mask-store";
import { getEffectsBridge } from "./bridges/effects-bridge";
import { getActiveEffectPreviewEngine } from "./components/editor/panels/effect-previews/active-engine";
import { previewGpuStats } from "./components/editor/panels/effect-previews/effect-renderer";
import { getProgramRenderer } from "./components/editor/preview/device-loss";
import type { Renderer } from "@openreel/core";
import { useInspectorNavigationStore } from "./stores/inspector-navigation-store";
import { useTimelineStore } from "./stores/timeline-store";
import { useEditorWorkspaceStore } from "./stores/editor-workspace-store";
import { useUIStore } from "./stores/ui-store";
import { useSettingsStore } from "./stores/settings-store";
import { useChatStore } from "./stores/chat-store";
import { useAIConnectionStore } from "./stores/ai-connection-store";
import { useSourceMonitorStore } from "./stores/source-monitor-store";
import { useProjectPanelStore } from "./stores/project-panel-store";
import { useMulticamStore } from "./stores/multicam-monitor-store";
import * as multicamController from "./services/multicam-controller";
import { nestSelectedClips, openSequence } from "./services/sequence-commands";
import { getPlaybackEvents, getPlaybackStageTraces, getPlaybackStalls } from "./components/editor/preview/playback-watchdog";
import { NATIVE_PLUGIN_BLOCK_FRAMES, applyRackStemsToTimeline, bakeNativePluginAutomation, getSharedRackStemCache, pluginRackSteps, setNativePluginBackend, nativePluginKeyframeProperty, nativePluginSteps, resolveClipAudioEffects, getMemoryGovernor, ProjectSerializer, RealtimeAudioGraph, effectLatencySamples, getAudioEffectsEngine, planTimelineDelayCompensation, ensureRepairWorklet, processChannels, analyzeAudioIssues, getRepairMeter, ensureCreativeFxWorklet, renderCreativeFx, SidechainKeyHub, trackOwnerId, AudioRackBus, createRackEffect, getAudioEngine, getExportEngine, getRealtimeAudioGraph, getVideoEngine, measureLoudness } from "@openreel/core";
import { useLoudnessStore } from "./stores/loudness-store";
import { renderCacheService } from "./services/render-cache-service";
import { useExportQueueStore } from "./stores/export-queue-store";
import { openEditorProject } from "./services/project-replacement";
import { projectManager } from "./services/project-manager";
import { useProjectLockStore, retryProjectLock } from "./services/project-lock";
import { autoSaveManager } from "./services/auto-save";
import { useEngineStore } from "./stores/engine-store";
import { analyzeTimelineLoudness } from "./services/loudness";
import { deleteMediaBlob } from "./services/media-storage";
import { proxyRecordId } from "@openreel/core";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { previewProxyCache } from "./stores/preview-proxy-store";
import { useProxyIngestStore, startProxyIngest } from "./services/proxy-ingest";
import { getNativeDecodeSamples, clearNativeDecodeSamples } from "./services/native-decode";
import * as desktopIngest from "./services/desktop-ingest";
import { editClipSpeed } from "./services/clip-speed-edit";
import {
  getMixdownCache,
  isolateBusStem,
  planAddBus,
  planAddSend,
  planRemoveBus,
  planRemoveSend,
  planSetBusAutomation,
  planSetBusOutput,
  planSetSend,
  planSetTrackOutput,
  planStemsPreset,
  planUpdateBus,
  applyProEffect,
  proEffectGpuUniforms,
  computeSecondaryMatte,
  matteCoverage,
  secondaryUniforms,
} from "@openreel/core";
import { MotionShaderRenderer } from "@openreel/core/motion/motion-shader-renderer";
import * as timeInterpolationModule from "@openreel/core/video/time-interpolation/index";
import * as timeInterpolationScenesModule from "@openreel/core/video/time-interpolation/synthetic-scenes";
import * as morphCutAnalysisModule from "@openreel/core/video/morph-cut/analysis";
import * as morphCutRenderModule from "@openreel/core/video/morph-cut/render";
import * as morphCutRegistryModule from "@openreel/core/video/morph-cut/registry";
import * as morphCutFacesModule from "@openreel/core/video/morph-cut/synthetic-faces";
import * as morphCutAnalyseJobModule from "@openreel/core/video/morph-cut/analyse-job";
import * as morphCutServiceModule from "./services/morph-cut-service";
import * as warpStabilizerServiceModule from "./services/warp-stabilizer-service";
import * as warpRegistryModule from "@openreel/core/video/stabilization/warp/registry";
import * as proEffectsModule from "@openreel/core/video/pro-effects";
import * as proEffectShadersModule from "@openreel/core/video/pro-effect-shaders";
import * as proEffectsExtraModule from "@openreel/core/video/pro-effects-extra";
import { useSourceVrViewStore, useVrViewStore } from "./stores/vr-view-store";
import * as vrMathModule from "@openreel/core/vr/vr-math";
import * as vrTestImagesModule from "@openreel/core/vr/vr-test-images";
import { isVrRuntimeLoaded, loadVrRuntime } from "@openreel/core/video/vr-runtime-loader";
import * as temporalEffectsModule from "@openreel/core/video/temporal-effects";
import * as echoCompositorModule from "@openreel/core/video/echo-compositor";
import * as motionShaderRendererModule from "@openreel/core/motion/motion-shader-renderer";
import * as maskPathModule from "@openreel/core/video/mask-path";
import * as blendReferenceModule from "@openreel/core/video/blend-reference";
import * as motionGpuCompositorModule from "@openreel/core/motion/motion-gpu-compositor";
import * as motionGpuBlendModule from "@openreel/core/motion/motion-gpu-blend";
import * as canvas2dFallbackRendererModule from "@openreel/core/video/canvas2d-fallback-renderer";
import * as colorGradingEngineModule from "@openreel/core/video/color-grading-engine";
import * as hueCurvesModule from "@openreel/core/video/hue-curves";
import * as lumetriPipelineModule from "@openreel/core/video/lumetri-pipeline";
import * as gpuGradeChainModule from "@openreel/core/video/gpu-grade-chain";
import * as gpuFrameReadbackModule from "@openreel/core/video/gpu-frame-readback";
import * as yuv420SdrModule from "@openreel/core/export/yuv420-sdr";
import * as gpuGradePlanModule from "@openreel/core/video/gpu-grade-plan";
import * as hdrWorkingModule from "@openreel/core/color/hdr-working";
import * as cameraLogModule from "@openreel/core/color/camera-log";
import * as acesModule from "@openreel/core/color/aces";
import * as acesOutputModule from "@openreel/core/color/aces-output";
import * as ocioSettingsModule from "@openreel/core/color/ocio/settings";
import * as ocioGpuEvalModule from "@openreel/core/video/ocio-gpu-eval";
import * as inputTransformModule from "@openreel/core/color/input-transform";
import * as hdrGpuModule from "@openreel/core/video/hdr-gpu";
import * as hdrScopeFeedModule from "@openreel/core/video/hdr-scope-feed";
import * as colorOutputModule from "@openreel/core/export/color-output";
import * as burnInModule from "@openreel/core/video/burn-in";
import * as evaluateKeyframesModule from "@openreel/core/animation/evaluate-keyframes";
import * as spatialPathModule from "@openreel/core/animation/spatial-path";
import { PRO_EFFECT_SHADER_DEFS } from "@openreel/core/video/pro-effect-shaders";
import { computeScopeStats } from "@openreel/core/video/scope-stats";
import { useColorMonitorStore } from "./stores/color-monitor-store";
import { usePluginManagerStore } from "./stores/plugin-manager-store";
import { initPluginRegistry, installPluginFromFiles } from "./services/plugin-service";
import * as nativePluginHost from "./services/native-plugin-host";
import { findProjectMissingPlugins } from "./services/native-plugin-report";
import { getPluginRackPreview, usePluginRackPreviewState } from "./services/plugin-rack-preview";
import { analyzeBusLoudnessNow, previewStemPlan, renderProjectStems } from "./services/audio-stems";
import * as graphicCommands from "./services/graphic-commands";
import * as sequenceCommands from "./services/sequence-commands";
import { useGraphicTemplatesStore } from "./stores/graphic-templates-store";
import { getBuiltInGraphicTemplate, parseGraphicTemplatePackage, serializeGraphicTemplate, fingerprintBlob, computeFingerprint, fingerprintMismatch } from "@openreel/core";
import { getPluginHost, getPluginRegistry } from "@openreel/core";
import { useOnboardingStore } from "./stores/onboarding-store";
import { startLessons } from "./components/onboarding/learn/lesson-mount";
import { useLessonSession } from "./components/onboarding/learn/lesson-session";

/**
 * Handle on the live stores for the Playwright suite (apps/web/e2e). Only
 * installed when the dev server starts with VITE_OPENREEL_E2E=1, so normal
 * and production bundles never expose it.
 */
/**
 * Mounts the lazy AI onboarding sheet into its own root, so the AI path can be driven end to end
 * without the onboarding host (the welcome band) being present.
 */
async function mountAiOnboardingSheet(): Promise<void> {
  const [{ createRoot }, { createElement }, sheet] = await Promise.all([
    import("react-dom/client"),
    import("react"),
    import("./components/onboarding/ai"),
  ]);
  const host = document.createElement("div");
  host.id = "e2e-ai-onboarding-host";
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = (): void => {
    root.unmount();
    host.remove();
  };
  root.render(createElement(sheet.default, { onClose: close }));
}

/**
 * The VR effects runtime, the VR effect CPU references and the spherical metadata reader are lazy chunks in the
 * product. The hook loads them before it installs, so the pixel-parity specs that drive them directly through
 * `core.proEffects` / `core.proEffectShaders` find them ready, unless the page sets `window.__openreelLazyVr` (an init
 * script) to test the product's own lazy path (vr-lazy.spec.ts).
 */
let preloadedVr: {
  vrEffects: typeof import("@openreel/core/video/vr-effects");
  vrImageEffects: typeof import("@openreel/core/video/vr-image-effects");
  sphericalMetadata: typeof import("@openreel/core/export/spherical-metadata");
} | null = null;

export async function prepareE2EHook(): Promise<void> {
  if ((window as unknown as { __openreelLazyVr?: boolean }).__openreelLazyVr) return;
  const [vrEffects, vrImageEffects, sphericalMetadata] = await Promise.all([
    import("@openreel/core/video/vr-effects"),
    import("@openreel/core/video/vr-image-effects"),
    import("@openreel/core/export/spherical-metadata"),
    loadVrRuntime(),
  ]);
  preloadedVr = { vrEffects, vrImageEffects, sphericalMetadata };
}

export function installE2EHook(): void {
  (window as unknown as { __openreelE2E?: unknown }).__openreelE2E = {
    project: useProjectStore,
    /** Object mask tool and Remove Object UI state (tracking tolerance, running analysis). */
    objectMask: useObjectMaskStore,
    /** AI onboarding path (WP-B): the chat and connection stores plus a stand-alone sheet mount. */
    chat: useChatStore,
    aiConnection: useAIConnectionStore,
    onboardingAi: { mount: mountAiOnboardingSheet },
    timeline: useTimelineStore,
    /** Voice-over recorder (pre-roll, punch, takes): phase, prefs and the last placed take. */
    voiceover: useVoiceOverStore,
    /** Effects panel live previews: the mounted preview engine (stats, cache, source) or null. */
    effectPreviews: getActiveEffectPreviewEngine,
    /** Preview GPU budget: shared lanes / shader renderers / live engine-owned WebGL contexts (created, released, live). */
    previewGpu: previewGpuStats,
    /** Program monitor GPU: renderer type, and a forced device loss (optionally with recovery made to fail) for the recovery e2e. */
    program: {
      rendererType: () => getProgramRenderer()?.type ?? null,
      loseDevice: (options?: { failRecovery?: boolean }): boolean => {
        const renderer = getProgramRenderer() as (Renderer & { getDevice?: () => { destroy(): void } | null }) | null;
        const device = renderer?.getDevice?.();
        if (!renderer || !device) return false;
        if (options?.failRecovery) renderer.recreateDevice = async () => false;
        device.destroy();
        return true;
      },
    },
    /** Inspector previews: opens an inspector section (motion-presets, text-animation, emphasis-animation, particle-effects, video-effects). */
    inspectorNav: useInspectorNavigationStore,
    workspace: useEditorWorkspaceStore,
    ui: useUIStore,
    settings: useSettingsStore,
    source: useSourceMonitorStore,
    multicam: useMulticamStore,
    multicamController,
    speed: { editClipSpeed },
    // Memory governor state for the 4K memory gate (apps/web/e2e/soak/memory-4k-layered.spec.ts).
    playbackStalls: () => [...getPlaybackStalls()],
    playbackStageTraces: () => [...getPlaybackStageTraces()],
    playbackEvents: () => [...getPlaybackEvents()],
    memoryGovernor: () => ({ ...getMemoryGovernor().reading, policy: getMemoryGovernor().policy }),
    /** Opens a decoder of `bytes` in the governor, as the preview does per source; returns its release. */
    registerMemoryDecoder: (id: string, bytes: number) => getMemoryGovernor().registerDecoder(id, bytes),
    forceMemoryPressure: (level: "normal" | "elevated" | "critical" | null) => getMemoryGovernor().force(level),
    audioClock: () => {
      const ctx = getRealtimeAudioGraph().getAudioContext();
      return { time: ctx.currentTime, state: ctx.state };
    },
    sequence: { nestSelectedClips, openSequence },
    audio: { RealtimeAudioGraph, effectLatencySamples, getAudioEffectsEngine, planTimelineDelayCompensation, AudioRackBus, createRackEffect, getAudioEngine, getRealtimeAudioGraph, getExportEngine, measureLoudness, ensureRepairWorklet, processChannels, analyzeAudioIssues, getRepairMeter, ensureCreativeFxWorklet, renderCreativeFx, SidechainKeyHub, trackOwnerId },
    nativePlugins: { host: nativePluginHost, findMissing: findProjectMissingPlugins, nativePluginKeyframeProperty, nativePluginSteps, resolveClipAudioEffects, bakeNativePluginAutomation, blockFrames: NATIVE_PLUGIN_BLOCK_FRAMES, setBackend: setNativePluginBackend, rack: { steps: pluginRackSteps, applyStems: applyRackStemsToTimeline, stemCache: getSharedRackStemCache(), preview: getPluginRackPreview(), previewState: usePluginRackPreviewState } },
    liveInsertProbe: (options: unknown) => import("./e2e-live-insert").then((module) => module.liveInsertProbe(options as Parameters<typeof module.liveInsertProbe>[0])),
    loudness: useLoudnessStore,
    projectPanel: useProjectPanelStore,
    /** Proxy workflow: `cache.decodes[mediaId].source` says which file the preview decoder was given. */
    proxy: { cache: previewProxyCache, ingest: useProxyIngestStore, startProxyIngest, desktop: { ...desktopIngest, store: desktopIngest.useDesktopIngestStore }, deleteProxyBytes: (mediaId: string) => deleteMediaBlob(proxyRecordId(mediaId)) },
    /** Desktop native decode (ProRes...): IPC round trips of every frame request since the last clear. */
    nativeDecode: { samples: getNativeDecodeSamples, clear: clearNativeDecodeSamples },
    /** Desktop project files: the Open flow (native dialog), the file the project is tied to, and its lock. */
    projectFile: { openEditorProject, projectManager, lock: useProjectLockStore, retryProjectLock },
    renderCache: renderCacheService,
    exportQueue: useExportQueueStore,
    vrView: useVrViewStore,
    sourceVrView: useSourceVrViewStore,
    backgroundTasks,
    /** Changed-source guard: the full-content fingerprint the renderer sends to the desktop copy path. */
    sourceFingerprint: { fingerprintBlob, computeFingerprint, fingerprintMismatch },
    autoSave: autoSaveManager,
    /** Learn path (desktop onboarding): lesson stores and the real Learn sheet, opened through the host. */
    learn: {
      onboarding: useOnboardingStore,
      session: useLessonSession,
      startLessons,
      /** Opens the real sheet through the onboarding host (DesktopApp mounts it), exactly like the Help menu. */
      openSheet: (sheet: "learn" | "lessons") => useOnboardingStore.getState().showSheet(sheet),
    },
    mixdownCache: getMixdownCache(),
    engine: useEngineStore,
    video: { getVideoEngine },
    /** Activity of the WebGPU grade chains: the render engine's and the live preview bridge's. */
    gradeChainStats: () => ({ engine: getVideoEngine().getGpuGradeStats(), preview: getEffectsBridge().getGpuGradeStats() }),
    analyzeTimelineLoudness,
    routing: {
      planAddBus,
      planAddSend,
      planRemoveBus,
      planRemoveSend,
      planSetBusAutomation,
      planSetBusOutput,
      planSetSend,
      planSetTrackOutput,
      planStemsPreset,
      planUpdateBus,
      isolateBusStem,
    },
    stems: { analyzeBusLoudnessNow, previewStemPlan, renderProjectStems },
    colorMonitor: useColorMonitorStore,
    secondary: {
      PRO_EFFECT_SHADER_DEFS,
      applyProEffect,
      proEffectGpuUniforms,
      computeSecondaryMatte,
      matteCoverage,
      secondaryUniforms,
      MotionShaderRenderer,
      computeScopeStats,
    },
    ProjectSerializer,
    /** Effect plugins: the shared registry/host the renderer uses, the manager dialog state and install entry points. */
    plugins: { registry: getPluginRegistry(), host: getPluginHost(), manager: usePluginManagerStore, init: initPluginRegistry, installFromFiles: installPluginFromFiles },
    /**
     * Core modules the pixel-parity specs drive directly. Exposed here (not via
     * dev-server /@fs URLs) so the same specs run against a production bundle.
     */
    core: {
      timeInterpolation: timeInterpolationModule,
      timeInterpolationScenes: timeInterpolationScenesModule,
      morphCutAnalysis: morphCutAnalysisModule,
      morphCutRender: morphCutRenderModule,
      morphCutRegistry: morphCutRegistryModule,
      morphCutFaces: morphCutFacesModule,
      morphCutJob: morphCutAnalyseJobModule,
      morphCutService: morphCutServiceModule,
      warpStabilizer: warpStabilizerServiceModule,
      warpRegistry: warpRegistryModule,
      proEffects: proEffectsModule,
      proEffectShaders: proEffectShadersModule,
      proEffectsExtra: proEffectsExtraModule,
      vrMath: vrMathModule,
      vrTestImages: vrTestImagesModule,
      vrEffects: preloadedVr?.vrEffects,
      vrImageEffects: preloadedVr?.vrImageEffects,
      sphericalMetadata: preloadedVr?.sphericalMetadata,
      /** The lazy VR effects runtime: whether it is loaded and how to load it. */
      vrRuntime: { isLoaded: isVrRuntimeLoaded, load: loadVrRuntime },
      // The monitor VR view renderer is a lazy chunk in the product; tests load it the same way.
      loadVrView: () => import("@openreel/core/video/vr-view"),
      temporalEffects: temporalEffectsModule,
      echoCompositor: echoCompositorModule,
      motionShaderRenderer: motionShaderRendererModule,
      maskPath: maskPathModule,
      canvas2dFallbackRenderer: canvas2dFallbackRendererModule,
      blendReference: blendReferenceModule,
      motionGpuCompositor: motionGpuCompositorModule,
      motionGpuBlend: motionGpuBlendModule,
      colorGradingEngine: colorGradingEngineModule,
      hueCurves: hueCurvesModule,
      lumetriPipeline: lumetriPipelineModule,
      gpuGradeChain: gpuGradeChainModule,
      gpuFrameReadback: gpuFrameReadbackModule,
      yuv420Sdr: yuv420SdrModule,
      gpuGradePlan: gpuGradePlanModule,
      hdrWorking: hdrWorkingModule,
      cameraLog: cameraLogModule,
      aces: acesModule,
      acesOutput: acesOutputModule,
      ocioSettings: ocioSettingsModule,
      ocioGpuEval: ocioGpuEvalModule,
      // The OCIO runtime is a lazy chunk in the product; tests load it the same way.
      loadOcioRuntime: () => import("@openreel/core/color/ocio/runtime"),
      inputTransform: inputTransformModule,
      // The transition engine and mask raster are lazy chunks in the product; the transitions spec loads them the same way.
      loadTransitions: async () => ({
        engine: await import("@openreel/core/video/transition-engine"),
        masks: await import("@openreel/core/video/transition-masks"),
        extra: await import("@openreel/core/video/transition-extra-render"),
        plans: await import("@openreel/core/video/transition-plans"),
      }),
      hdrGpu: hdrGpuModule,
      hdrScopeFeed: hdrScopeFeedModule,
      colorOutput: colorOutputModule,
      burnIn: burnInModule,
      evaluateKeyframes: evaluateKeyframesModule,
      spatialPath: spatialPathModule,
    },
    sequences: sequenceCommands,
    graphics: {
      ...graphicCommands,
      templates: useGraphicTemplatesStore,
      getBuiltInGraphicTemplate,
      parseGraphicTemplatePackage,
      serializeGraphicTemplate,
    },
  };
}

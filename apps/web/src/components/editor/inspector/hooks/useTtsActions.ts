import { useState, useCallback, useRef, useEffect } from "react";
import type { TtsProvider } from "../../../../stores/settings-store";
import { useProjectStore } from "../../../../stores/project-store";
import { useTtsAudioStore } from "../../../../stores/tts-store";
import { PIPER_VOICES } from "../tts-constants";
import type { ElevenLabsVoice } from "../tts-types";

interface UseTtsActionsOptions {
  provider: TtsProvider;
  selectedVoice: string;
  text: string;
  speed: number;
  enhanceText: boolean;
  enhancedPreview: string | null;
  allVoices: ElevenLabsVoice[];
  favoriteVoices: Array<{ voiceId: string; name: string; previewUrl?: string }>;
  generateWithElevenLabs: (text: string, voiceId: string, signal?: AbortSignal) => Promise<Blob>;
  generateWithPiper: (text: string, voice: string, speed: number, signal?: AbortSignal) => Promise<Blob>;
  enhanceViaLlm: (text: string, signal?: AbortSignal) => Promise<string>;
  setText: (text: string) => void;
  setError: (error: string | null) => void;
  setEnhancedPreview: (preview: string | null) => void;
}

interface UseTtsActionsReturn {
  isGenerating: boolean;
  isPlaying: boolean;
  isEnhancing: boolean;
  generatedAudio: Blob | null;
  hasUnsavedAudio: boolean;
  successMsg: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  getSelectedVoiceName: () => string;
  handleEnhance: () => Promise<void>;
  generateSpeech: () => Promise<void>;
  togglePlayback: () => void;
  handleAudioEnded: () => void;
  saveToMedia: () => Promise<void>;
  addToTimeline: () => Promise<void>;
  downloadAudio: () => void;
  setGeneratedAudio: (blob: Blob | null) => void;
}

export function useTtsActions(options: UseTtsActionsOptions): UseTtsActionsReturn {
  const {
    provider,
    selectedVoice,
    text,
    speed,
    enhanceText,
    enhancedPreview,
    allVoices,
    favoriteVoices,
    generateWithElevenLabs,
    generateWithPiper,
    enhanceViaLlm,
    setText,
    setError,
    setEnhancedPreview,
  } = options;

  const importMedia = useProjectStore((state) => state.importMedia);
  const project = useProjectStore((state) => state.project);

  // Audio state lives in Zustand store so it survives tab switches
  const generatedAudio = useTtsAudioStore((s) => s.generatedAudio);
  const isAudioSaved = useTtsAudioStore((s) => s.isAudioSaved);
  const audioUrl = useTtsAudioStore((s) => s.audioUrl);
  const storeSetAudio = useTtsAudioStore((s) => s.setGeneratedAudio);
  const storeMarkSaved = useTtsAudioStore((s) => s.markAudioSaved);
  const storeClearAudio = useTtsAudioStore((s) => s.clearAudio);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  const hasUnsavedAudio = generatedAudio !== null && !isAudioSaved;

  // Warn on browser tab close when unsaved audio exists
  useEffect(() => {
    if (!hasUnsavedAudio) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedAudio]);

  // Restore audio src when component remounts with existing audio
  useEffect(() => {
    if (audioRef.current && audioUrl) {
      audioRef.current.src = audioUrl;
    }
  }, [audioUrl]);

  // Pause audio and abort in-flight requests on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (generateAbortRef.current) {
        generateAbortRef.current.abort();
      }
    };
  }, []);

  const setGeneratedAudio = useCallback((blob: Blob | null) => {
    if (blob) {
      storeSetAudio(blob);
    } else {
      storeClearAudio();
    }
  }, [storeSetAudio, storeClearAudio]);

  const getSelectedVoiceName = useCallback((): string => {
    if (provider === "piper") {
      return PIPER_VOICES.find((v) => v.id === selectedVoice)?.name ?? "TTS";
    }
    const fav = favoriteVoices.find((v) => v.voiceId === selectedVoice);
    if (fav) return fav.name;
    const apiVoice = allVoices.find((v) => v.voice_id === selectedVoice);
    if (apiVoice) return apiVoice.name;
    return "TTS";
  }, [provider, selectedVoice, favoriteVoices, allVoices]);

  const handleEnhance = useCallback(async () => {
    if (!text.trim()) {
      setError("Please enter some text");
      return;
    }

    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;

    setIsEnhancing(true);
    setError(null);

    try {
      const result = await enhanceViaLlm(text.trim(), controller.signal);
      setEnhancedPreview(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to enhance text");
    } finally {
      setIsEnhancing(false);
    }
  }, [text, enhanceViaLlm, setError, setEnhancedPreview]);

  const generateSpeech = useCallback(async () => {
    if (!text.trim() && !enhancedPreview) {
      setError("Please enter some text");
      return;
    }

    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;

    setIsGenerating(true);
    setError(null);

    try {
      const finalText = (enhanceText && enhancedPreview) ? enhancedPreview : text.trim();

      const blob = provider === "elevenlabs"
        ? await generateWithElevenLabs(finalText, selectedVoice, controller.signal)
        : await generateWithPiper(finalText, selectedVoice, speed, controller.signal);

      storeSetAudio(blob);

      if (audioRef.current) {
        const url = useTtsAudioStore.getState().audioUrl;
        if (url) audioRef.current.src = url;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to generate speech");
    } finally {
      setIsGenerating(false);
    }
  }, [text, enhancedPreview, enhanceText, selectedVoice, speed, provider, generateWithPiper, generateWithElevenLabs, setError, storeSetAudio]);

  const togglePlayback = useCallback(() => {
    if (!audioRef.current || !audioUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying, audioUrl]);

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const importToMediaAssets = useCallback(async (): Promise<string | null> => {
    if (!generatedAudio || !project) return null;

    const voiceName = getSelectedVoiceName();
    const timestamp = Date.now();
    const fileName = `${voiceName}_${timestamp}.wav`;

    const file = new File([generatedAudio], fileName, { type: "audio/wav" });
    const importResult = await importMedia(file);

    if (!importResult.success || !importResult.actionId) {
      const errorMsg =
        typeof importResult.error === "string"
          ? importResult.error
          : "Failed to import audio";
      throw new Error(errorMsg);
    }

    return importResult.actionId;
  }, [generatedAudio, project, getSelectedVoiceName, importMedia]);

  const saveToMedia = useCallback(async () => {
    if (!generatedAudio || !project) return;

    setIsGenerating(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await importToMediaAssets();
      storeClearAudio();
      setText("");
      setSuccessMsg("Saved to Media Assets");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save to media");
    } finally {
      setIsGenerating(false);
    }
  }, [generatedAudio, project, importToMediaAssets, setError, storeClearAudio, setText]);

  const addToTimeline = useCallback(async () => {
    if (!generatedAudio || !project) return;

    setIsGenerating(true);
    setError(null);

    try {
      const mediaId = await importToMediaAssets();
      if (!mediaId) return;

      const { addClipToNewTrack } = useProjectStore.getState();
      await addClipToNewTrack(mediaId);
      storeClearAudio();
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to timeline");
    } finally {
      setIsGenerating(false);
    }
  }, [generatedAudio, project, importToMediaAssets, setText, setError, storeClearAudio]);

  const downloadAudio = useCallback(() => {
    if (!generatedAudio) return;
    storeMarkSaved();

    const voiceName = getSelectedVoiceName();
    const timestamp = Date.now();
    const fileName = `${voiceName}_${timestamp}.wav`;

    const url = URL.createObjectURL(generatedAudio);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [generatedAudio, getSelectedVoiceName, storeMarkSaved]);

  return {
    isGenerating,
    isPlaying,
    isEnhancing,
    generatedAudio,
    hasUnsavedAudio,
    successMsg,
    audioRef,
    getSelectedVoiceName,
    handleEnhance,
    generateSpeech,
    togglePlayback,
    handleAudioEnded,
    saveToMedia,
    addToTimeline,
    downloadAudio,
    setGeneratedAudio,
  };
}

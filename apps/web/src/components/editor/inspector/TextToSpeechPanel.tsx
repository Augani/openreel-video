import React, { useState, useCallback, useRef } from "react";
import {
  Mic,
  Play,
  Pause,
  Plus,
  Loader2,
  Volume2,
  User,
  Download,
  Settings,
} from "lucide-react";
import { Slider } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { isSessionUnlocked, getSecret } from "../../../services/secure-storage";
import { OPENREEL_TTS_URL, ELEVENLABS_API_URL } from "../../../config/api-endpoints";

type TtsProvider = "piper" | "elevenlabs";

const TTS_PROVIDERS = [
  { id: "piper" as const, label: "Piper (Free)", description: "Built-in open-source TTS" },
  { id: "elevenlabs" as const, label: "ElevenLabs", description: "Premium AI voices" },
];

interface Voice {
  id: string;
  name: string;
  gender: "male" | "female";
  language: string;
}

const PIPER_VOICES: Voice[] = [
  { id: "amy", name: "Amy", gender: "female", language: "en-US" },
  { id: "ryan", name: "Ryan", gender: "male", language: "en-US" },
];

const ELEVENLABS_VOICES: Voice[] = [
  { id: "rachel", name: "Rachel", gender: "female", language: "en-US" },
  { id: "drew", name: "Drew", gender: "male", language: "en-US" },
  { id: "bella", name: "Bella", gender: "female", language: "en-US" },
  { id: "antoni", name: "Antoni", gender: "male", language: "en-US" },
  { id: "elli", name: "Elli", gender: "female", language: "en-US" },
  { id: "josh", name: "Josh", gender: "male", language: "en-US" },
  { id: "adam", name: "Adam", gender: "male", language: "en-US" },
  { id: "sam", name: "Sam", gender: "male", language: "en-US" },
];

export const TextToSpeechPanel: React.FC = () => {
  const importMedia = useProjectStore((state) => state.importMedia);
  const project = useProjectStore((state) => state.project);
  const { defaultTtsProvider, openSettings, configuredServices } = useSettingsStore();

  const defaultProvider: TtsProvider =
    defaultTtsProvider === "elevenlabs" && configuredServices.includes("elevenlabs")
      ? "elevenlabs"
      : "piper";

  const [provider, setProvider] = useState<TtsProvider>(defaultProvider);
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string>("amy");
  const [speed, setSpeed] = useState(1.0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const hasElevenLabsKey = configuredServices.includes("elevenlabs");
  const voices = provider === "elevenlabs" ? ELEVENLABS_VOICES : PIPER_VOICES;

  const generateWithPiper = useCallback(async (inputText: string, voice: string, spd: number): Promise<Blob> => {
    const response = await fetch(`${OPENREEL_TTS_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: inputText, voice, speed: spd }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          "Rate limit reached. Please wait a minute before generating more speech. This free service is limited to 10 requests per minute.",
        );
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.error || "Failed to generate speech");
    }

    return response.blob();
  }, []);

  const generateWithElevenLabs = useCallback(async (inputText: string, voice: string): Promise<Blob> => {
    if (!isSessionUnlocked()) {
      throw new Error("Session locked. Unlock in Settings > API Keys first.");
    }

    const apiKey = await getSecret("elevenlabs");
    if (!apiKey) {
      throw new Error("ElevenLabs API key not found. Add it in Settings > API Keys.");
    }

    // Default voice IDs from ElevenLabs
    const voiceMap: Record<string, string> = {
      rachel: "21m00Tcm4TlvDq8ikWAM",
      drew: "29vD33N1CtxCmqQRPOHJ",
      clyde: "2EiwWnXFnvU5JabPnv8n",
      paul: "5Q0t7uMcjvnagumLfvZi",
      domi: "AZnzlk1XvdvUeBnXmlld",
      bella: "EXAVITQu4vr4xnSDxMaL",
      antoni: "ErXwobaYiN019PkySvjV",
      elli: "MF3mGyEYCl7XYWbV9V6O",
      josh: "TxGEqnHWrfWFTfGW9XjX",
      arnold: "VR6AewLTigWG4xSOukaG",
      adam: "pNInz6obpgDQGcFmaJgB",
      sam: "yoZ06aMxZJJ28mfd3POQ",
    };

    const voiceId = voiceMap[voice] ?? voiceMap.rachel;

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: inputText,
          model_id: "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.5 },
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as Record<string, unknown>).detail as string
        || (errorData as Record<string, unknown>).message as string
        || `ElevenLabs error (${response.status})`,
      );
    }

    return response.blob();
  }, []);

  const generateSpeech = useCallback(async () => {
    if (!text.trim()) {
      setError("Please enter some text");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedAudio(null);

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    try {
      const blob = provider === "elevenlabs"
        ? await generateWithElevenLabs(text.trim(), selectedVoice)
        : await generateWithPiper(text.trim(), selectedVoice, speed);

      setGeneratedAudio(blob);

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      if (audioRef.current) {
        audioRef.current.src = url;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate speech",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [text, selectedVoice, speed, provider, generateWithPiper, generateWithElevenLabs]);

  const togglePlayback = useCallback(() => {
    if (!audioRef.current || !audioUrlRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const addToTimeline = useCallback(async () => {
    if (!generatedAudio || !project) return;

    setIsGenerating(true);

    try {
      const voiceName =
        voices.find((v) => v.id === selectedVoice)?.name || "TTS";
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

      const mediaId = importResult.actionId;
      const { addClipToNewTrack } = useProjectStore.getState();
      await addClipToNewTrack(mediaId);

      setText("");
      setGeneratedAudio(null);
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to add to timeline",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [generatedAudio, project, selectedVoice, importMedia]);

  const downloadAudio = useCallback(() => {
    if (!generatedAudio) return;

    const voiceName = voices.find((v) => v.id === selectedVoice)?.name || "TTS";
    const timestamp = Date.now();
    const fileName = `${voiceName}_${timestamp}.wav`;

    const url = URL.createObjectURL(generatedAudio);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [generatedAudio, selectedVoice]);

  const selectedVoiceData = voices.find((v) => v.id === selectedVoice);
  const charCount = text.length;
  const maxChars = 5000;

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">
      <audio ref={audioRef} onEnded={handleAudioEnded} className="hidden" />

      <div className="flex items-center justify-between p-2 bg-primary/10 rounded-lg border border-primary/30">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-primary" />
          <div>
            <span className="text-[11px] font-medium text-text-primary">
              Text to Speech
            </span>
            <p className="text-[9px] text-text-muted">AI voice generation</p>
          </div>
        </div>
        <button
          onClick={() => openSettings("api-keys")}
          className="p-1.5 rounded-md hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="API Key Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      {/* Provider selector */}
      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Provider
        </label>
        <div className="flex gap-1.5">
          {TTS_PROVIDERS.map((p) => {
            const isDisabled = p.id === "elevenlabs" && !hasElevenLabsKey;
            return (
              <button
                key={p.id}
                onClick={() => {
                  if (isDisabled) {
                    openSettings("api-keys");
                    return;
                  }
                  setProvider(p.id);
                  // Reset voice when switching provider
                  setSelectedVoice(p.id === "elevenlabs" ? "rachel" : "amy");
                  setGeneratedAudio(null);
                }}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] transition-colors ${
                  provider === p.id
                    ? "bg-primary text-white font-medium"
                    : isDisabled
                      ? "bg-background-tertiary text-text-muted border border-border opacity-60 cursor-default"
                      : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
                }`}
                title={isDisabled ? "Add ElevenLabs API key in Settings" : p.description}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {provider === "elevenlabs" && !hasElevenLabsKey && (
          <p className="text-[9px] text-amber-400">
            Add your ElevenLabs API key in Settings to use premium voices.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Text
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter the text you want to convert to speech..."
          className="w-full h-24 px-3 py-2 text-[11px] bg-background-tertiary rounded-lg border border-border focus:border-primary focus:outline-none resize-none"
          maxLength={maxChars}
        />
        <div className="flex justify-end">
          <span
            className={`text-[9px] ${charCount > maxChars * 0.9 ? "text-red-400" : "text-text-muted"}`}
          >
            {charCount}/{maxChars}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Voice
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(provider === "elevenlabs" ? ELEVENLABS_VOICES : PIPER_VOICES).map((voice) => (
            <button
              key={voice.id}
              onClick={() => setSelectedVoice(voice.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] transition-colors ${
                selectedVoice === voice.id
                  ? "bg-primary text-white font-medium"
                  : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
              }`}
            >
              <User size={10} />
              <span>{voice.name}</span>
              <span className="text-[8px] opacity-70">{voice.gender === "female" ? "F" : "M"}</span>
            </button>
          ))}
        </div>
      </div>

      {provider === "piper" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium text-text-secondary">
              Speed
            </label>
            <span className="text-[10px] text-text-muted">
              {speed.toFixed(1)}x
            </span>
          </div>
          <Slider
            min={0.5}
            max={2.0}
            step={0.1}
            value={[speed]}
            onValueChange={(value) => setSpeed(value[0])}
          />
          <div className="flex justify-between text-[8px] text-text-muted">
            <span>0.5x</span>
            <span>1.0x</span>
            <span>2.0x</span>
          </div>
        </div>
      )}

      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-[10px] text-red-400">{error}</p>
        </div>
      )}

      <button
        onClick={generateSpeech}
        disabled={isGenerating || !text.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-[11px] font-medium transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Volume2 size={14} />
            Generate Speech
          </>
        )}
      </button>

      {generatedAudio && (
        <div className="p-3 bg-background-tertiary rounded-lg border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Volume2 size={14} className="text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-medium text-text-primary">
                  {selectedVoiceData?.name} Voice
                </p>
                <p className="text-[9px] text-text-muted">
                  {(generatedAudio.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            <button
              onClick={togglePlayback}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white hover:opacity-90 transition-opacity"
            >
              {isPlaying ? (
                <Pause size={14} />
              ) : (
                <Play size={14} className="ml-0.5" />
              )}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={addToTimeline}
              disabled={isGenerating}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-[10px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Plus size={12} />
              Add to Timeline
            </button>
            <button
              onClick={downloadAudio}
              className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-[10px] text-text-secondary hover:text-text-primary transition-colors"
            >
              <Download size={12} />
            </button>
          </div>
        </div>
      )}

      <p className="text-[9px] text-text-muted text-center">
        Powered by {provider === "elevenlabs" ? "ElevenLabs" : "Piper TTS"} • {selectedVoiceData?.language}
      </p>
    </div>
  );
};

export default TextToSpeechPanel;

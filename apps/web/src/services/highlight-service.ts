import {
  analyzeAudioForHighlights,
  type TranscriptWord,
  type AudioSegmentMetrics,
} from "@openreel/core";

export interface HighlightResult {
  start: number;
  end: number;
  score: number;
  title: string;
  reason: string;
}

export interface HighlightPreferences {
  targetClipCount: number;
  minClipDuration: number;
  maxClipDuration: number;
  contentType: string;
}

const DEFAULT_PREFERENCES: HighlightPreferences = {
  targetClipCount: 5,
  minClipDuration: 5,
  maxClipDuration: 60,
  contentType: "video",
};

type ProgressCallback = (phase: string, progress: number, message: string) => void;

const API_BASE = import.meta.env.VITE_CLOUD_API_URL || "https://openreel-cloud.niiyeboah1996.workers.dev";

export async function extractHighlights(
  audioBuffer: AudioBuffer,
  transcript: TranscriptWord[],
  preferences: Partial<HighlightPreferences> = {},
  onProgress?: ProgressCallback,
): Promise<HighlightResult[]> {
  const prefs = { ...DEFAULT_PREFERENCES, ...preferences };

  onProgress?.("analyze", 10, "Analyzing audio energy...");
  const analysis = analyzeAudioForHighlights(audioBuffer, transcript);

  onProgress?.("analyze", 30, "Preparing data for AI...");
  const energyData = analysis.segments
    .filter((seg) => !seg.isSilence)
    .map((seg: AudioSegmentMetrics) => ({
      start: seg.start,
      end: seg.end,
      rmsDb: seg.rmsDb,
      peakDb: seg.peakDb,
    }));

  onProgress?.("ai", 40, "Sending to AI for highlight detection...");

  const response = await fetch(`${API_BASE}/highlights`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript: transcript.map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
      })),
      energy: energyData,
      duration: analysis.duration,
      preferences: prefs,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error || `API error: ${response.status}`);
  }

  onProgress?.("ai", 80, "Processing AI response...");
  const data = (await response.json()) as { highlights: HighlightResult[] };

  onProgress?.("done", 100, "Highlights ready");
  return data.highlights;
}

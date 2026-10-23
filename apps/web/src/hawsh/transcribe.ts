/**
 * Server captions (Hawsh Khalifa build): a clip's speech → timed caption lines, via the site's
 * `editor-transcribe` function (ElevenLabs Scribe, Arabic by default, charged per started minute from
 * the user's Director's Eyes points). Replaces the in-browser Whisper download.
 *
 * Steps: decode the clip's source range → 16 kHz mono 16-bit WAV (~1.9 MB/min) → upload to
 * director-refs/{uid}/{uuid}.wav → editor-transcribe (measures the WAV itself, charges, deletes it) →
 * words with source-relative times → caption lines on the timeline.
 */
import type { Clip, MediaItem, TranscriptionSegment } from "@openreel/core";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../utils/whisper-audio";
import { HAWSH_REF_BUCKET, HAWSH_SUPABASE_URL } from "./config";
import { hawshClient, useHawshStore } from "./session";

export const HAWSH_TRANSCRIBE_URL = `${HAWSH_SUPABASE_URL}/functions/v1/editor-transcribe`;
export const TRANSCRIBE_PRICE_KEY = "editor_transcribe_per_min";
export const TRANSCRIBE_DEFAULT_POINTS_PER_MIN = 1;
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 30 * 60;

export interface Word { text: string; start: number; end: number }

/** 16-bit PCM mono WAV from float samples in -1..1. */
export function encodeWav16(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([view.buffer], { type: "audio/wav" });
}

/** Points for a clip of `seconds` at `pointsPerMin` (every started minute, 0.5 s grace, at least one). */
export function transcribePoints(seconds: number, pointsPerMin: number): number {
  return Math.round(Math.max(1, Math.ceil((seconds - 0.5) / 60)) * pointsPerMin * 100) / 100;
}

const ENDS_SENTENCE = /[.!?؟،,;:…]$/;

/**
 * Words (seconds from the clip's in-point) → one caption line per cue on the timeline: a new line after
 * `maxWords` words, after punctuation, at a pause over 0.7 s, or when a line would pass 4 s.
 */
export function wordsToCaptions(
  words: readonly Word[],
  clip: Pick<Clip, "startTime" | "duration"> & { speed?: number },
  maxWords = 5,
): TranscriptionSegment[] {
  const speed = Math.max(clip.speed ?? 1, 0.01);
  const clipEnd = clip.startTime + clip.duration;
  const at = (t: number) => Math.min(clipEnd, clip.startTime + t / speed);
  const lines: Word[][] = [];
  let line: Word[] = [];
  for (const w of words) {
    const prev = line[line.length - 1];
    const breakHere = prev && (
      line.length >= maxWords || ENDS_SENTENCE.test(prev.text) || w.start - prev.end > 0.7 || w.end - line[0].start > 4
    );
    if (breakHere) { lines.push(line); line = []; }
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines
    .map((l, i) => {
      const next = lines[i + 1];
      const end = Math.min(l[l.length - 1].end + 0.15, next ? next[0].start : Infinity);
      return { text: l.map((w) => w.text).join(" "), startTime: at(l[0].start), endTime: at(Math.max(end, l[0].start + 0.3)), confidence: 1 };
    })
    .filter((s) => s.text && s.endTime > s.startTime);
}

/** The price per minute from director_prices (falls back to 1). */
export async function loadTranscribePrice(): Promise<number> {
  const c = hawshClient();
  if (!c) return TRANSCRIBE_DEFAULT_POINTS_PER_MIN;
  const { data } = await c.from("director_prices").select("value").eq("key", TRANSCRIBE_PRICE_KEY).maybeSingle();
  const v = Number((data as { value?: unknown } | null)?.value);
  return Number.isFinite(v) && v >= 0 ? v : TRANSCRIBE_DEFAULT_POINTS_PER_MIN;
}

/** The clip's source range as a 16 kHz mono WAV, with its length in seconds. */
export async function clipAudioWav(
  clip: Clip,
  media: MediaItem,
  onProgress?: (fraction: number, message: string) => void,
): Promise<{ wav: Blob; seconds: number }> {
  const source = media.blob ?? (media.fileHandle ? await media.fileHandle.getFile() : null);
  if (!source) throw new Error("أعد ربط ملف المقطع أولاً.");
  const ctx = new AudioContext();
  try {
    const buffer = await loadAudioBuffer(ctx, source, {
      audioTrackIndex: clip.audioTrackIndex,
      onProgress: (p) => onProgress?.(p.progress * 0.3, "جارٍ استخراج صوت المقطع…"),
    });
    if (!buffer) throw new Error("تعذّر قراءة صوت المقطع.");
    const start = Math.max(0, clip.inPoint ?? 0);
    const end = Math.min(buffer.duration, clip.outPoint > start ? clip.outPoint : start + clip.duration * Math.max(clip.speed ?? 1, 0.01));
    if (end - start > MAX_SECONDS) throw new Error("أقصى مدّة للتفريغ 30 دقيقة — قصّ المقطع أولاً.");
    const samples = audioBufferToWhisperSamples(buffer, start, end);
    return { wav: encodeWav16(samples), seconds: samples.length / SAMPLE_RATE };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** Uploads the WAV and asks the server to transcribe it. Throws with the server's Arabic message. */
export async function transcribeWav(wav: Blob, language: string): Promise<{ words: Word[]; points: number; minutes: number }> {
  const c = hawshClient();
  const uid = useHawshStore.getState().userId;
  const token = c ? (await c.auth.getSession()).data.session?.access_token : undefined;
  if (!c || !uid || !token) throw new Error("افتح المحرر من عيون المخرج لاستخدام الترجمة التلقائية.");
  const path = `${uid}/${crypto.randomUUID()}.wav`;
  const { error: upErr } = await c.storage.from(HAWSH_REF_BUCKET).upload(path, wav, { contentType: "audio/wav", upsert: false });
  if (upErr) throw new Error("فشل رفع الصوت. تحقق من الاتصال وحاول مرة أخرى.");
  let res: Response;
  try {
    res = await fetch(HAWSH_TRANSCRIBE_URL, {
      method: "POST", redirect: "error", credentials: "omit",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path, language }),
    });
  } catch {
    await c.storage.from(HAWSH_REF_BUCKET).remove([path]).catch(() => undefined);
    throw new Error("تعذّر الاتصال بعيون المخرج. تحقق من الاتصال وحاول مرة أخرى.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; words?: Word[]; points?: number; minutes?: number };
  if (!res.ok) throw new Error(body.error || `تعذّر التفريغ (HTTP ${res.status}).`);
  return { words: Array.isArray(body.words) ? body.words : [], points: Number(body.points ?? 0), minutes: Number(body.minutes ?? 0) };
}

/** Full path for one clip: audio → server → caption lines on the timeline. */
export async function transcribeClip(
  clip: Clip,
  media: MediaItem,
  language: string,
  maxWords: number,
  onProgress?: (fraction: number, message: string) => void,
): Promise<{ segments: TranscriptionSegment[]; points: number; minutes: number }> {
  const { wav } = await clipAudioWav(clip, media, onProgress);
  onProgress?.(0.4, "جارٍ التفريغ في عيون المخرج…");
  const { words, points, minutes } = await transcribeWav(wav, language);
  if (!words.length) throw new Error("لم يُكتشف كلام في هذا المقطع.");
  return { segments: wordsToCaptions(words, clip, maxWords), points, minutes };
}

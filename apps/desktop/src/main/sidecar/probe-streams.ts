import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "./ffmpeg-path";

export interface AudioStreamInfo {
  index: number;
  codec: string;
  channels: number;
  sampleRate: number;
  language?: string;
}

function parseChannelCount(layout: string): number {
  const t = layout.trim().toLowerCase().replace(/\(.*\)\s*$/, "").trim();
  if (t === "mono") return 1;
  if (t === "stereo") return 2;
  if (t === "quad") return 4;
  const nCh = /^(\d+)\s*channels?$/.exec(t);
  if (nCh) return Number(nCh[1]);
  const dotted = /^(\d+)\.(\d+)$/.exec(t);
  if (dotted) return Number(dotted[1]) + Number(dotted[2]);
  const plain = /^(\d+)$/.exec(t);
  if (plain) return Number(plain[1]);
  return 2;
}

export function parseAudioStreams(stderr: string): AudioStreamInfo[] {
  const streams: AudioStreamInfo[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!/Audio:/.test(line)) continue;
    const indexMatch = /Stream #\d+:(\d+)/.exec(line);
    const codecMatch = /Audio:\s+([A-Za-z0-9_]+)/.exec(line);
    const srMatch = /(\d+)\s*Hz/.exec(line);
    if (!indexMatch || !codecMatch || !srMatch) continue;
    const layoutMatch = /\d+\s*Hz,\s*([^,]+)/.exec(line);
    const langMatch = /Stream #\d+:\d+(?:\[[^\]]*\])?\(([a-zA-Z]{2,})\)\s*:/.exec(line);
    const language = langMatch && langMatch[1].toLowerCase() !== "und" ? langMatch[1] : undefined;
    const info: AudioStreamInfo = {
      index: Number(indexMatch[1]),
      codec: codecMatch[1],
      channels: layoutMatch ? parseChannelCount(layoutMatch[1]) : 2,
      sampleRate: Number(srMatch[1]),
    };
    if (language) info.language = language;
    streams.push(info);
  }
  return streams;
}

export function probeAudioStreams(srcPath: string): Promise<AudioStreamInfo[]> {
  return new Promise((resolve) => {
    let stderr = "";
    const proc = spawn(resolveFfmpegPath(), ["-hide_banner", "-i", srcPath]);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // ffmpeg with no output exits non-zero but prints stream info to stderr; parse regardless.
    proc.on("error", () => resolve([]));
    proc.on("close", () => resolve(parseAudioStreams(stderr)));
  });
}

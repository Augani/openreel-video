import type { ExportPreset, AudioExportSettings } from "@openreel/core";

export interface PlatformExportPreset extends ExportPreset {
  platform: string;
  icon?: string;
  maxDuration?: number;
  maxFileSize?: number;
  aspectRatio?: string;
  recommended?: boolean;
}

const SOCIAL_MEDIA_PRESETS: PlatformExportPreset[] = [
  {
    id: "youtube-4k",
    name: "YouTube 4K",
    description: "Best quality for YouTube 4K - 50Mbps",
    platform: "YouTube",
    category: "social",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 50000,
      bitrateMode: "vbr",
      quality: 90,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 384,
        channels: 2,
      },
    },
  },
  {
    id: "youtube-4k-60",
    name: "YouTube 4K 60fps",
    description: "4K 60fps for gaming/motion - 65Mbps",
    platform: "YouTube",
    category: "social",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 3840,
      height: 2160,
      frameRate: 60,
      bitrate: 65000,
      bitrateMode: "vbr",
      quality: 90,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 384,
        channels: 2,
      },
    },
  },
  {
    id: "youtube-1080p",
    name: "YouTube 1080p HD",
    description: "Standard HD quality for YouTube",
    platform: "YouTube",
    category: "social",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 256,
        channels: 2,
      },
    },
  },
  {
    id: "youtube-shorts",
    name: "YouTube Shorts",
    description: "Vertical format for YouTube Shorts (60s max)",
    platform: "YouTube",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 60,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 60,
      bitrate: 12000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 256,
        channels: 2,
      },
    },
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "Optimized for TikTok (3min max)",
    platform: "TikTok",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 180,
    maxFileSize: 287 * 1024 * 1024,
    recommended: true,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 60,
      bitrate: 10000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "instagram-reels",
    name: "Instagram Reels",
    description: "Vertical format for Reels (90s max)",
    platform: "Instagram",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 90,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "instagram-feed",
    name: "Instagram Feed Video",
    description: "Square format for feed posts (60s max)",
    platform: "Instagram",
    category: "social",
    aspectRatio: "1:1",
    maxDuration: 60,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1080,
      frameRate: 30,
      bitrate: 6000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "instagram-story",
    name: "Instagram Story",
    description: "Vertical format for Stories (15s per clip)",
    platform: "Instagram",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 15,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 30,
      bitrate: 6000,
      bitrateMode: "vbr",
      quality: 80,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
  {
    id: "twitter",
    name: "Twitter/X",
    description: "Optimized for Twitter (2min 20s max)",
    platform: "Twitter",
    category: "social",
    aspectRatio: "16:9",
    maxDuration: 140,
    maxFileSize: 512 * 1024 * 1024,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "facebook-feed",
    name: "Facebook Feed",
    description: "Standard format for Facebook feed",
    platform: "Facebook",
    category: "social",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "Professional format for LinkedIn (10min max)",
    platform: "LinkedIn",
    category: "social",
    aspectRatio: "16:9",
    maxDuration: 600,
    maxFileSize: 5 * 1024 * 1024 * 1024,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
];

const BROADCAST_PRESETS: PlatformExportPreset[] = [
  {
    id: "broadcast-4k-master",
    name: "4K Master Quality",
    description: "Maximum quality 4K - 80Mbps H.265",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mov",
      codec: "h265",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 80000,
      bitrateMode: "vbr",
      quality: 95,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k-prores-hq",
    name: "4K ProRes HQ",
    description: "Professional ProRes for editing/mastering",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 880000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k-prores-4444",
    name: "4K ProRes 4444",
    description: "Highest quality ProRes with alpha support",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "4444",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 1320000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k-60",
    name: "4K 60fps High Motion",
    description: "4K at 60fps for sports/gaming - 65Mbps",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h265",
      width: 3840,
      height: 2160,
      frameRate: 60,
      bitrate: 65000,
      bitrateMode: "vbr",
      quality: 90,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k",
    name: "Broadcast 4K UHD",
    description: "4K broadcast quality - 50Mbps",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h264",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 50000,
      bitrateMode: "cbr",
      quality: 90,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-1080p-high",
    name: "1080p High Quality",
    description: "High bitrate 1080p - 20Mbps",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 20000,
      bitrateMode: "vbr",
      quality: 95,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-1080p-prores",
    name: "1080p ProRes HQ",
    description: "ProRes HQ for 1080p editing",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 220000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-hd",
    name: "Broadcast HD 1080p",
    description: "Standard broadcast quality",
    platform: "Broadcast",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 12000,
      bitrateMode: "cbr",
      quality: 85,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
];

const WEB_PRESETS: PlatformExportPreset[] = [
  {
    id: "web-hd",
    name: "Web HD",
    description: "Balanced quality for web embedding",
    platform: "Web",
    category: "web",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 5000,
      bitrateMode: "vbr",
      quality: 80,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
  {
    id: "web-small",
    name: "Web Optimized",
    description: "Smaller file size for faster loading",
    platform: "Web",
    category: "web",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 2500,
      bitrateMode: "vbr",
      quality: 75,
      keyframeInterval: 90,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 96,
        channels: 2,
      },
    },
  },
  {
    id: "webm-vp9",
    name: "WebM VP9",
    description: "Modern web format with VP9 codec (720p recommended)",
    platform: "Web",
    category: "web",
    aspectRatio: "16:9",
    settings: {
      format: "webm",
      codec: "vp9",
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 3000,
      bitrateMode: "vbr",
      quality: 80,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
];

const ARCHIVE_PRESETS: PlatformExportPreset[] = [
  {
    id: "archive-4k-prores",
    name: "Archive 4K ProRes",
    description: "Lossless 4K ProRes for long-term archival",
    platform: "Archive",
    category: "archive",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 880000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 96000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "archive-master",
    name: "Archive Master H.265",
    description: "High quality 4K H.265 - 80Mbps",
    platform: "Archive",
    category: "archive",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h265",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 80000,
      bitrateMode: "vbr",
      quality: 95,
      keyframeInterval: 30,
      audioSettings: {
        format: "wav",
        sampleRate: 96000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "archive-1080p-prores",
    name: "Archive 1080p ProRes",
    description: "ProRes HQ for 1080p archival",
    platform: "Archive",
    category: "archive",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 220000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "archive-proxy",
    name: "Archive Proxy",
    description: "Lower quality proxy for editing",
    platform: "Archive",
    category: "archive",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 3000,
      bitrateMode: "vbr",
      quality: 70,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
];

const AUDIO_PRESETS: PlatformExportPreset[] = [
  {
    id: "audio-mp3-320",
    name: "MP3 High Quality",
    description: "320kbps MP3 for music",
    platform: "Audio",
    category: "custom",
    settings: {
      format: "mp3",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 320,
      channels: 2,
    } as AudioExportSettings,
  },
  {
    id: "audio-wav",
    name: "WAV Lossless",
    description: "Uncompressed WAV audio",
    platform: "Audio",
    category: "archive",
    settings: {
      format: "wav",
      sampleRate: 48000,
      bitDepth: 24,
      bitrate: 0,
      channels: 2,
    } as AudioExportSettings,
  },
  {
    id: "audio-aac",
    name: "AAC High Quality",
    description: "256kbps AAC for compatibility",
    platform: "Audio",
    category: "custom",
    settings: {
      format: "aac",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 256,
      channels: 2,
    } as AudioExportSettings,
  },
];

/** Raw Dolby Digital / Digital Plus audio files (`.ac3` / `.ec3`); the browser encodes them on ffmpeg.wasm, the desktop app on its ffmpeg sidecar. */
const dolbyAudioPreset = (id: string, name: string, description: string, format: "ac3" | "eac3", bitrate: number): PlatformExportPreset => ({
  id,
  name,
  description,
  platform: "Audio",
  category: "broadcast",
  settings: { format, sampleRate: 48000, bitDepth: 24, bitrate, channels: 2 } as AudioExportSettings,
});

AUDIO_PRESETS.push(
  dolbyAudioPreset("audio-ac3", "Dolby Digital (AC-3) audio", "Raw .ac3 stream, 192 kbps stereo (a 5.1 sequence delivers 5.1 at 384 kbps or more)", "ac3", 192),
  dolbyAudioPreset("audio-ac3-448", "Dolby Digital (AC-3) audio, 448 kbps", "Raw .ac3 stream at the DVD / broadcast rate for stereo or 5.1", "ac3", 448),
  dolbyAudioPreset("audio-eac3", "Dolby Digital Plus (E-AC-3) audio", "Raw .ec3 stream, 256 kbps stereo (a 5.1 sequence delivers 5.1 at 384 kbps or more)", "eac3", 256),
  dolbyAudioPreset("audio-eac3-640", "Dolby Digital Plus (E-AC-3) audio, 640 kbps", "Raw .ec3 stream at 640 kbps for stereo or 5.1", "eac3", 640),
);

/**
 * Video files with Dolby Digital / Digital Plus audio (desktop only: the ffmpeg sidecar writes the AC-3 / E-AC-3 track).
 * The picture is H.264 1080p30; the audio is stereo, or 5.1 when the sequence is 5.1 (then at 384 kbps or more).
 */
const dolbyVideoPreset = (
  id: string,
  name: string,
  description: string,
  format: "mp4" | "mov" | "mkv",
  audio: { format: "ac3" | "eac3"; bitrate: number },
): PlatformExportPreset => ({
  id,
  name,
  description,
  platform: "Dolby Digital",
  category: "broadcast",
  aspectRatio: "16:9",
  settings: {
    format,
    codec: "h264",
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 15000,
    bitrateMode: "cbr",
    quality: 90,
    keyframeInterval: 60,
    audioSettings: { format: audio.format, sampleRate: 48000, bitDepth: 24, bitrate: audio.bitrate, channels: 2 },
  } as unknown as PlatformExportPreset["settings"],
});

const DOLBY_PRESETS: PlatformExportPreset[] = [
  dolbyVideoPreset("dolby-ac3-mp4", "H.264 + Dolby Digital (MP4)", "MP4 with an AC-3 track (ac-3 sample entry), 448 kbps; 5.1 for a 5.1 sequence", "mp4", { format: "ac3", bitrate: 448 }),
  dolbyVideoPreset("dolby-ac3-mov", "H.264 + Dolby Digital (MOV)", "QuickTime MOV with an AC-3 track, 448 kbps; 5.1 for a 5.1 sequence", "mov", { format: "ac3", bitrate: 448 }),
  dolbyVideoPreset("dolby-ac3-mkv", "H.264 + Dolby Digital (MKV)", "Matroska with an AC-3 track, 448 kbps; 5.1 for a 5.1 sequence", "mkv", { format: "ac3", bitrate: 448 }),
  dolbyVideoPreset("dolby-eac3-mp4", "H.264 + Dolby Digital Plus (MP4)", "MP4 with an E-AC-3 track (ec-3 sample entry), 640 kbps; 5.1 for a 5.1 sequence", "mp4", { format: "eac3", bitrate: 640 }),
  dolbyVideoPreset("dolby-eac3-mov", "H.264 + Dolby Digital Plus (MOV)", "QuickTime MOV with an E-AC-3 track, 640 kbps; 5.1 for a 5.1 sequence", "mov", { format: "eac3", bitrate: 640 }),
  dolbyVideoPreset("dolby-eac3-mkv", "H.264 + Dolby Digital Plus (MKV)", "Matroska with an E-AC-3 track, 640 kbps; 5.1 for a 5.1 sequence", "mkv", { format: "eac3", bitrate: 640 }),
];

/**
 * Delivery masters (desktop only: the ffmpeg sidecar encodes them): 24-bit PCM audio, 1080p24 defaults.
 * Pick another size or rate in the dialog's controls; the codec and wrapper stay.
 */
const PCM_AUDIO: AudioExportSettings = { format: "wav", sampleRate: 48000, bitDepth: 24, bitrate: 0, channels: 2 };
const deliveryPreset = (
  id: string,
  name: string,
  description: string,
  settings: Record<string, unknown>,
): PlatformExportPreset => ({
  id,
  name,
  description,
  platform: "Delivery",
  category: "broadcast",
  aspectRatio: "16:9",
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 24,
    bitrate: 0,
    bitrateMode: "cbr",
    quality: 100,
    keyframeInterval: 1,
    audioSettings: PCM_AUDIO,
    ...settings,
  } as unknown as PlatformExportPreset["settings"],
});

const DELIVERY_PRESETS: PlatformExportPreset[] = [
  deliveryPreset("delivery-prores-422hq", "ProRes 422 HQ (MOV)", "Apple ProRes 422 HQ, 10-bit 4:2:2, PCM audio", { format: "mov", codec: "prores", proresProfile: "hq" }),
  deliveryPreset("delivery-prores-4444", "ProRes 4444 + alpha (MOV)", "Apple ProRes 4444 with the alpha channel, 10-bit 4:4:4, PCM audio", { format: "mov", codec: "prores", proresProfile: "4444", alpha: true }),
  deliveryPreset("delivery-dnxhr-hq-mxf", "DNxHR HQ (MXF)", "Avid DNxHR HQ in an MXF OP1a wrapper, 8-bit 4:2:2, PCM audio", { format: "mxf", codec: "dnxhr", dnxhrProfile: "hq" }),
  deliveryPreset("delivery-dnxhr-hqx-mxf", "DNxHR HQX (MXF)", "Avid DNxHR HQX in an MXF OP1a wrapper, 10-bit 4:2:2, PCM audio", { format: "mxf", codec: "dnxhr", dnxhrProfile: "hqx" }),
  deliveryPreset("delivery-dnxhr-hq-mov", "DNxHR HQ (MOV)", "Avid DNxHR HQ in a QuickTime MOV, 8-bit 4:2:2, PCM audio", { format: "mov", codec: "dnxhr", dnxhrProfile: "hq" }),
  deliveryPreset("delivery-dnxhr-hqx-mov", "DNxHR HQX (MOV)", "Avid DNxHR HQX in a QuickTime MOV, 10-bit 4:2:2, PCM audio", { format: "mov", codec: "dnxhr", dnxhrProfile: "hqx" }),
  // Broadcast delivery (desktop): fixed-format mezzanine codecs, 8 mono PCM tracks (stereo mix on 1-2, silence after) and a 10:00:00:00 start.
  deliveryPreset("delivery-xdcam-1080i25-mxf", "XDCAM HD422 1080i25 (MXF OP1a)", "MPEG-2 4:2:2 50 Mb/s, top field first, MXF OP1a, 8 mono PCM tracks, start 10:00:00:00", {
    format: "mxf", codec: "xdcamhd422", frameRate: 25,
    broadcast: { scan: "interlaced-tff", audioTracks: 8, startTimecode: "10:00:00:00" },
  }),
  deliveryPreset("delivery-xdcam-1080i2997-mxf", "XDCAM HD422 1080i29.97 (MXF OP1a)", "MPEG-2 4:2:2 50 Mb/s, top field first, drop frame, MXF OP1a, 8 mono PCM tracks, start 10:00:00;00", {
    format: "mxf", codec: "xdcamhd422", frameRate: 29.97,
    broadcast: { scan: "interlaced-tff", audioTracks: 8, startTimecode: "10:00:00;00" },
  }),
  deliveryPreset("delivery-xdcam-1080p25-mxf", "XDCAM HD422 1080p25 (MXF OP1a)", "MPEG-2 4:2:2 50 Mb/s progressive, MXF OP1a, 8 mono PCM tracks, start 10:00:00:00", {
    format: "mxf", codec: "xdcamhd422", frameRate: 25,
    broadcast: { audioTracks: 8, startTimecode: "10:00:00:00" },
  }),
  deliveryPreset("delivery-xdcam-1080i25-opatom", "XDCAM HD422 1080i25 (MXF OP-Atom)", "MPEG-2 4:2:2 50 Mb/s, top field first, one MXF OP-Atom file per track (picture + 8 mono audio), start 10:00:00:00", {
    format: "mxf", codec: "xdcamhd422", frameRate: 25,
    broadcast: { scan: "interlaced-tff", mxfPattern: "opatom", audioTracks: 8, startTimecode: "10:00:00:00" },
  }),
  deliveryPreset("delivery-avcintra100-1080i25-mxf", "AVC-Intra 100 1080i25 (MXF OP1a)", "H.264 High 4:2:2 Intra 10-bit (AVC-Intra class 100), top field first, MXF OP1a, 8 mono PCM tracks, start 10:00:00:00", {
    format: "mxf", codec: "avcintra100", frameRate: 25,
    broadcast: { scan: "interlaced-tff", audioTracks: 8, startTimecode: "10:00:00:00" },
  }),
  deliveryPreset("delivery-avcintra100-1080p25-mxf", "AVC-Intra 100 1080p25 (MXF OP1a)", "H.264 High 4:2:2 Intra 10-bit (AVC-Intra class 100) progressive, MXF OP1a, 8 mono PCM tracks, start 10:00:00:00", {
    format: "mxf", codec: "avcintra100", frameRate: 25,
    broadcast: { audioTracks: 8, startTimecode: "10:00:00:00" },
  }),
  deliveryPreset("delivery-prores-422hq-8ch-mov", "ProRes 422 HQ, 8 mono tracks (MOV)", "Apple ProRes 422 HQ in a QuickTime MOV with 8 mono PCM tracks and a 10:00:00:00 timecode track", {
    format: "mov", codec: "prores", proresProfile: "hq",
    broadcast: { audioTracks: 8, startTimecode: "10:00:00:00" },
  }),
];

const ALL_EXPORT_PRESETS: PlatformExportPreset[] = [
  ...SOCIAL_MEDIA_PRESETS,
  ...BROADCAST_PRESETS,
  ...DELIVERY_PRESETS,
  ...DOLBY_PRESETS,
  ...WEB_PRESETS,
  ...ARCHIVE_PRESETS,
  ...AUDIO_PRESETS,
];

const CUSTOM_PRESETS_KEY = "openreel-custom-export-presets";

let customIdCounter = 0;

export const CUSTOM_PRESET_FILE_VERSION = 1;

export class ExportPresetsManager {
  private customPresets: PlatformExportPreset[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadCustomPresets();
  }

  private loadCustomPresets(): void {
    try {
      const stored = localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const seen = new Set<string>();
          for (const entry of parsed) {
            const valid = parseStoredPreset(entry);
            if (valid && !seen.has(valid.id)) {
              seen.add(valid.id);
              this.customPresets.push(valid);
            }
          }
        }
      }
    } catch (error) {
      console.error("[ExportPresets] Failed to load custom presets:", error);
    }
  }

  private saveCustomPresets(): void {
    try {
      localStorage.setItem(
        CUSTOM_PRESETS_KEY,
        JSON.stringify(this.customPresets),
      );
    } catch (error) {
      console.error("[ExportPresets] Failed to save custom presets:", error);
    }
  }

  getAllPresets(): PlatformExportPreset[] {
    return [...ALL_EXPORT_PRESETS, ...this.customPresets];
  }

  getPresetsByCategory(
    category: ExportPreset["category"],
  ): PlatformExportPreset[] {
    return this.getAllPresets().filter((p) => p.category === category);
  }

  getPresetsByPlatform(platform: string): PlatformExportPreset[] {
    return this.getAllPresets().filter((p) => p.platform === platform);
  }

  getPreset(id: string): PlatformExportPreset | undefined {
    return this.getAllPresets().find((p) => p.id === id);
  }

  getRecommendedPresets(): PlatformExportPreset[] {
    return this.getAllPresets().filter((p) => p.recommended);
  }

  getPlatforms(): string[] {
    const platforms = new Set(this.getAllPresets().map((p) => p.platform));
    return Array.from(platforms);
  }

  addCustomPreset(
    preset: Omit<PlatformExportPreset, "id">,
  ): PlatformExportPreset {
    const newPreset: PlatformExportPreset = {
      ...preset,
      id: this.nextCustomId(),
      category: "custom",
    };
    this.customPresets.push(newPreset);
    this.saveCustomPresets();
    this.notify();
    return newPreset;
  }

  private nextCustomId(): string {
    let id: string;
    do {
      id = `custom-${Date.now()}-${(customIdCounter += 1)}`;
    } while (this.customPresets.some((p) => p.id === id));
    return id;
  }

  updateCustomPreset(
    id: string,
    updates: Partial<PlatformExportPreset>,
  ): boolean {
    const index = this.customPresets.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.customPresets[index] = { ...this.customPresets[index], ...updates };
    this.saveCustomPresets();
    this.notify();
    return true;
  }

  deleteCustomPreset(id: string): boolean {
    const index = this.customPresets.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.customPresets.splice(index, 1);
    this.saveCustomPresets();
    this.notify();
    return true;
  }

  getCustomPresets(): PlatformExportPreset[] {
    return [...this.customPresets];
  }

  isCustomPreset(id: string): boolean {
    return id.startsWith("custom-");
  }

  duplicatePreset(id: string, newName: string): PlatformExportPreset | null {
    const preset = this.getPreset(id);
    if (!preset) return null;

    return this.addCustomPreset({
      ...preset,
      name: newName,
      platform: "Custom",
    });
  }

  renameCustomPreset(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    return this.updateCustomPreset(id, { name: trimmed });
  }

  /** Serializes custom presets (all, or only the given ids) to a JSON string. */
  exportCustomPresets(ids?: string[]): string {
    const presets = this.customPresets.filter(
      (p) => !ids || ids.includes(p.id),
    );
    return JSON.stringify(
      { openreelExportPresets: CUSTOM_PRESET_FILE_VERSION, presets },
      null,
      2,
    );
  }

  /**
   * Imports presets from JSON produced by exportCustomPresets (a bare array is
   * also accepted). Invalid entries are skipped. Imported presets always get
   * fresh ids so they can never overwrite built-ins or existing presets.
   */
  importCustomPresets(json: string): {
    imported: PlatformExportPreset[];
    skipped: number;
    /** Entries not added because a preset with the same name and settings exists. */
    duplicates: number;
  } {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    const list = Array.isArray(data)
      ? data
      : isRecord(data) && Array.isArray(data.presets)
        ? data.presets
        : null;
    if (!list) throw new Error("The file does not contain export presets.");
    const imported: PlatformExportPreset[] = [];
    let skipped = 0;
    let duplicates = 0;
    for (const entry of list) {
      const valid = parseImportedPreset(entry);
      if (!valid) {
        skipped += 1;
        continue;
      }
      const signature = presetSignature(valid);
      if (this.customPresets.some((p) => presetSignature(p) === signature)) {
        duplicates += 1;
        continue;
      }
      imported.push(this.addCustomPreset(valid));
    }
    return { imported, skipped, duplicates };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const VIDEO_FORMATS = ["mp4", "webm", "mov", "mxf", "mkv"] as const;
const BITRATE_MODES = ["cbr", "vbr", "vbr1", "vbr2"] as const;
const RATE_CONTROLS = ["quality", "vbr", "vbr2"] as const;
const VIDEO_CODECS = [
  "h264", "h265", "vp8", "vp9", "av1", "prores", "dnxhr", "xdcamhd422", "avcintra100",
] as const;
const AUDIO_FORMATS = ["mp3", "wav", "aac", "flac", "ogg", "ac3", "eac3"] as const;

const FALLBACK_AUDIO_SETTINGS: AudioExportSettings = {
  format: "aac",
  sampleRate: 48000,
  bitDepth: 16,
  bitrate: 192,
  channels: 2,
};

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function parseAudioSettings(value: unknown): AudioExportSettings | null {
  if (!isRecord(value)) return null;
  if (!oneOf(AUDIO_FORMATS, value.format)) return null;
  if (![44100, 48000, 96000].includes(value.sampleRate as number)) return null;
  if (![16, 24, 32].includes(value.bitDepth as number)) return null;
  // Uncompressed audio (PCM/WAV with ProRes/DNxHR) legitimately has bitrate 0.
  if (
    typeof value.bitrate !== "number" ||
    !Number.isFinite(value.bitrate) ||
    value.bitrate < 0
  ) {
    return null;
  }
  if (![1, 2, 6].includes(value.channels as number)) return null;
  return value as unknown as AudioExportSettings;
}

/**
 * Validates a full video export settings object (as found in imported files or
 * localStorage). A missing audioSettings falls back to AAC 48 kHz stereo; an
 * invalid one rejects the settings.
 */
export function parseVideoExportSettings(
  value: unknown,
): PlatformExportPreset["settings"] | null {
  if (!isRecord(value)) return null;
  if (!oneOf(VIDEO_FORMATS, value.format)) return null;
  if (!oneOf(VIDEO_CODECS, value.codec)) return null;
  if (
    !isPositiveFinite(value.width) ||
    !isPositiveFinite(value.height) ||
    !isPositiveFinite(value.frameRate) ||
    !isPositiveFinite(value.bitrate) ||
    !isPositiveFinite(value.keyframeInterval)
  ) {
    return null;
  }
  if (!oneOf(BITRATE_MODES, value.bitrateMode)) return null;
  if (value.rateControl !== undefined && !oneOf(RATE_CONTROLS, value.rateControl)) return null;
  if (value.maxBitrate !== undefined && !isPositiveFinite(value.maxBitrate)) return null;
  if (
    typeof value.quality !== "number" ||
    !Number.isFinite(value.quality) ||
    value.quality < 0 ||
    value.quality > 100
  ) {
    return null;
  }
  let audioSettings = FALLBACK_AUDIO_SETTINGS;
  if (value.audioSettings !== undefined) {
    const parsed = parseAudioSettings(value.audioSettings);
    if (!parsed) return null;
    audioSettings = parsed;
  }
  return {
    ...value,
    audioSettings,
  } as unknown as PlatformExportPreset["settings"];
}

/** Whether settings are a complete, usable video export configuration. */
export function isValidVideoExportSettings(value: unknown): boolean {
  return parseVideoExportSettings(value) !== null;
}

function presetSignature(preset: {
  name: string;
  settings: PlatformExportPreset["settings"];
}): string {
  return `${preset.name.trim().toLowerCase()}\u0000${JSON.stringify(preset.settings)}`;
}

function parseImportedPreset(
  entry: unknown,
): Omit<PlatformExportPreset, "id"> | null {
  if (!isRecord(entry)) return null;
  const { name } = entry;
  if (typeof name !== "string" || !name.trim()) return null;
  const settings = parseVideoExportSettings(entry.settings);
  if (!settings) return null;
  return {
    name: name.trim(),
    description:
      typeof entry.description === "string" ? entry.description : "",
    platform: "Custom",
    category: "custom",
    settings,
  };
}

function parseStoredPreset(entry: unknown): PlatformExportPreset | null {
  if (!isRecord(entry)) return null;
  if (typeof entry.id !== "string" || !entry.id.startsWith("custom-")) return null;
  const parsed = parseImportedPreset(entry);
  if (!parsed) return null;
  return { ...parsed, id: entry.id };
}

export const exportPresetsManager = new ExportPresetsManager();

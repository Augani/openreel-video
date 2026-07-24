export interface SampleClip {
  id: string;
  label: string;
  aspect: "9:16" | "16:9" | "1:1";
  durationSec: number;
  url: string;
  tests: string[];
}

const MAX_SIZE_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_SEC = 60;

export class VideoSource {
  private constructor(
    public readonly id: string,
    public readonly label: string,
    public readonly url: string,
    public readonly userUploaded: boolean,
    private readonly disposeFn?: () => void,
  ) {}

  static fromSampleClip(clip: SampleClip): VideoSource {
    return new VideoSource(clip.id, clip.label, clip.url, false);
  }

  static fromFile(file: File): VideoSource {
    if (!file.type.startsWith("video/")) {
      throw new Error(`Selected file must be a video; got MIME type ${file.type}`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error(`Selected file exceeds 200MB limit (${file.size} bytes).`);
    }
    const blobUrl = URL.createObjectURL(file);
    return new VideoSource(
      `upload-${file.name}-${file.size}`,
      file.name,
      blobUrl,
      true,
      () => URL.revokeObjectURL(blobUrl),
    );
  }

  static maxDurationSec(): number {
    return MAX_DURATION_SEC;
  }

  dispose(): void {
    this.disposeFn?.();
  }
}

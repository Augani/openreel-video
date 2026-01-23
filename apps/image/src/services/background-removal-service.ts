import { removeBackground, Config } from '@imgly/background-removal';

export type BackgroundMode = 'transparent' | 'color' | 'blur';

export interface BackgroundRemovalOptions {
  mode: BackgroundMode;
  backgroundColor?: string;
  blurAmount?: number;
}

export const DEFAULT_OPTIONS: BackgroundRemovalOptions = {
  mode: 'transparent',
  backgroundColor: '#ffffff',
  blurAmount: 15,
};

export class BackgroundRemovalService {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  async removeBackground(
    imageSource: HTMLImageElement | ImageBitmap | string,
    options: Partial<BackgroundRemovalOptions> = {},
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    onProgress?.(5);

    let imageBlob: Blob;
    if (typeof imageSource === 'string') {
      if (imageSource.startsWith('data:')) {
        const response = await fetch(imageSource);
        imageBlob = await response.blob();
      } else {
        const response = await fetch(imageSource);
        imageBlob = await response.blob();
      }
    } else {
      this.canvas.width = imageSource.width;
      this.canvas.height = imageSource.height;
      this.ctx.drawImage(imageSource, 0, 0);
      imageBlob = await new Promise<Blob>((resolve) => {
        this.canvas.toBlob((blob) => resolve(blob!), 'image/png');
      });
    }

    onProgress?.(10);

    const config: Config = {
      progress: (_key, current, total) => {
        const baseProgress = 10;
        const progressRange = 80;
        const segmentProgress = (current / total) * progressRange;
        onProgress?.(Math.round(baseProgress + segmentProgress));
      },
      output: {
        format: 'image/png',
        quality: 1,
      },
    };

    const resultBlob = await removeBackground(imageBlob, config);

    onProgress?.(90);

    if (opts.mode === 'transparent') {
      const dataUrl = await this.blobToDataUrl(resultBlob);
      onProgress?.(100);
      return dataUrl;
    }

    const maskedImg = await this.loadImageFromBlob(resultBlob);
    const originalImg = await this.loadImageFromBlob(imageBlob);

    this.canvas.width = originalImg.width;
    this.canvas.height = originalImg.height;

    if (opts.mode === 'color' && opts.backgroundColor) {
      this.ctx.fillStyle = opts.backgroundColor;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(maskedImg, 0, 0);
    } else if (opts.mode === 'blur' && opts.blurAmount) {
      this.ctx.filter = `blur(${opts.blurAmount}px)`;
      this.ctx.drawImage(originalImg, 0, 0);
      this.ctx.filter = 'none';
      this.ctx.drawImage(maskedImg, 0, 0);
    }

    onProgress?.(100);

    return this.canvas.toDataURL('image/png');
  }

  private async loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        resolve(img);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }

  private async blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

let serviceInstance: BackgroundRemovalService | null = null;

export function getBackgroundRemovalService(): BackgroundRemovalService {
  if (!serviceInstance) {
    serviceInstance = new BackgroundRemovalService();
  }
  return serviceInstance;
}

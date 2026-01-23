export type MaskType = 'pixel' | 'vector';

export interface LayerMask {
  id: string;
  type: MaskType;
  enabled: boolean;
  linked: boolean;
  density: number;
  feather: number;
  invert: boolean;
  data: string | null;
  vectorPath: { x: number; y: number }[] | null;
}

export const DEFAULT_LAYER_MASK: LayerMask = {
  id: '',
  type: 'pixel',
  enabled: true,
  linked: true,
  density: 100,
  feather: 0,
  invert: false,
  data: null,
  vectorPath: null,
};

export function createMaskFromSelection(
  selectionPath: { x: number; y: number }[],
  width: number,
  height: number,
  feather: number = 0
): string {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'white';
  ctx.beginPath();

  if (selectionPath.length > 0) {
    ctx.moveTo(selectionPath[0].x, selectionPath[0].y);
    for (let i = 1; i < selectionPath.length; i++) {
      ctx.lineTo(selectionPath[i].x, selectionPath[i].y);
    }
    ctx.closePath();
    ctx.fill();
  }

  if (feather > 0) {
    const tempCanvas = new OffscreenCanvas(width, height);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.filter = `blur(${feather}px)`;
    tempCtx.drawImage(canvas, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(tempCanvas, 0, 0);
  }

  return canvas.convertToBlob().then(() => {
    const reader = new FileReader();
    return new Promise<string>((resolve) => {
      canvas.convertToBlob().then((blob) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    });
  }) as unknown as string;
}

export function createMaskFromImageData(imageData: ImageData): string {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);

  return canvas.convertToBlob().then(() => {
    return new Promise<string>((resolve) => {
      canvas.convertToBlob().then((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    });
  }) as unknown as string;
}

export function applyMaskToImageData(
  imageData: ImageData,
  mask: LayerMask,
  maskImage: HTMLImageElement | null
): ImageData {
  if (!mask.enabled || !maskImage) {
    return imageData;
  }

  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(maskImage, 0, 0, imageData.width, imageData.height);
  const maskData = ctx.getImageData(0, 0, imageData.width, imageData.height);

  const result = new ImageData(imageData.width, imageData.height);
  const density = mask.density / 100;

  for (let i = 0; i < imageData.data.length; i += 4) {
    result.data[i] = imageData.data[i];
    result.data[i + 1] = imageData.data[i + 1];
    result.data[i + 2] = imageData.data[i + 2];

    let maskAlpha = maskData.data[i];
    if (mask.invert) {
      maskAlpha = 255 - maskAlpha;
    }
    maskAlpha = Math.round(maskAlpha * density);

    result.data[i + 3] = Math.round((imageData.data[i + 3] * maskAlpha) / 255);
  }

  return result;
}

export function invertMask(maskDataUrl: string, width: number, height: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255 - imageData.data[i];
        imageData.data[i + 1] = 255 - imageData.data[i + 1];
        imageData.data[i + 2] = 255 - imageData.data[i + 2];
      }
      ctx.putImageData(imageData, 0, 0);

      canvas.convertToBlob().then((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    };
    img.src = maskDataUrl;
  });
}

export function featherMask(
  maskDataUrl: string,
  width: number,
  height: number,
  featherAmount: number
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      ctx.filter = `blur(${featherAmount}px)`;
      ctx.drawImage(img, 0, 0);

      canvas.convertToBlob().then((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    };
    img.src = maskDataUrl;
  });
}

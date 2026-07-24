import type { CreationAssetRecipe, CreationScene } from "../creation";

export interface NativeAuroraPreviewArgs {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly timeSeconds?: number;
  readonly quality?: "preview" | "final";
}

export interface NativeAuroraPreviewResult {
  readonly backend: "native" | "cpu";
  readonly pngBase64: string;
  readonly dataUri: string;
  readonly width: number;
  readonly height: number;
  readonly coveredPixels: number;
  readonly shadowedPixels: number;
  readonly renderMs: number;
}

export interface NativeAuroraBridge {
  readonly platform?: string;
  readonly aurora?: {
    renderPreview(args: NativeAuroraPreviewArgs): Promise<NativeAuroraPreviewResult>;
  };
}

function getBridge(): NativeAuroraBridge | undefined {
  const scope = globalThis as { openreel?: Partial<NativeAuroraBridge> };
  const openreel = scope.openreel;
  if (openreel?.platform === "desktop" && openreel.aurora) {
    return openreel as NativeAuroraBridge;
  }
  return undefined;
}

export function nativeAuroraAvailable(): boolean {
  return getBridge() !== undefined && typeof createImageBitmap === "function";
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  throw new Error("Base64 decoding is unavailable in this environment");
}

async function dataUriToBlob(dataUri: string, fallbackBase64: string): Promise<Blob> {
  if (typeof fetch === "function") {
    try {
      const response = await fetch(dataUri);
      if (response.ok) return response.blob();
    } catch {
      // Fall through to the manual decoder below.
    }
  }
  return new Blob([base64ToUint8Array(fallbackBase64)], { type: "image/png" });
}

export async function renderAuroraPreviewToImageBitmap(
  args: NativeAuroraPreviewArgs,
): Promise<ImageBitmap | null> {
  const bridge = getBridge();
  if (!bridge?.aurora || typeof createImageBitmap !== "function") return null;
  const result = await bridge.aurora.renderPreview(args);
  const blob = await dataUriToBlob(result.dataUri, result.pngBase64);
  return createImageBitmap(blob);
}

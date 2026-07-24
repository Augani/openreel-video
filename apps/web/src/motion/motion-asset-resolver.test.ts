import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MediaItem,
  MotionAsset,
  MotionComposition,
  MotionRenderQuality,
  MotionScene3DLayer,
} from "@openreel/core";
import type { CreationProjectState } from "@openreel/core/creation/index";
import {
  clearWebMotionAssetBitmapCache,
  createWebMotionAssetResolver,
} from "./motion-asset-resolver";

const defaultMotionTransform = {
  position: { x: 960, y: 540, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  rotation3d: { x: 0, y: 0 },
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  perspective: 1000,
  transformStyle: "flat" as const,
};

describe("web motion asset resolver", () => {
  beforeEach(() => {
    clearWebMotionAssetBitmapCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: undefined,
    });
    clearWebMotionAssetBitmapCache();
  });

  it("resolves image media blobs through a shared bitmap cache", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const bitmap = {
      width: 8,
      height: 8,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);

    const resolver = createWebMotionAssetResolver([
      {
        id: "media-1",
        type: "image",
        blob,
      } as unknown as MediaItem,
    ]);
    const asset: MotionAsset = {
      id: "asset-1",
      type: "image",
      name: "Logo",
      mediaId: "media-1",
    };

    await expect(resolver.resolveImageAsset(asset)).resolves.toBe(bitmap);
    await expect(resolver.resolveImageAsset(asset)).resolves.toBe(bitmap);
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(createImageBitmapMock).toHaveBeenCalledWith(blob);
  });

  it("ignores non-image motion assets", async () => {
    const createImageBitmapMock = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    const resolver = createWebMotionAssetResolver([]);

    await expect(
      resolver.resolveImageAsset({
        id: "asset-1",
        type: "svg",
        name: "Vector",
      }),
    ).resolves.toBeNull();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it("downloads remote model URLs through the desktop bridge and caches them", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn((_blob: Blob) => "blob:motion-model-1");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const fetchUrl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      contentType: "application/octet-stream",
      body: new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: { media: { fetchUrl } },
    });

    const resolver = createWebMotionAssetResolver([]);
    const url = "https://svs.gsfc.nasa.gov/model/moon.glb";

    await expect(resolver.resolveModelUrl?.(url)).resolves.toBe(
      "blob:motion-model-1",
    );
    await expect(resolver.resolveModelUrl?.(url)).resolves.toBe(
      "blob:motion-model-1",
    );

    expect(fetchUrl).toHaveBeenCalledTimes(1);
    expect(fetchUrl).toHaveBeenCalledWith({
      url,
      maxBytes: 256 * 1024 * 1024,
    });
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("model/gltf-binary");

    clearWebMotionAssetBitmapCache();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:motion-model-1");

    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
    } else {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    } else {
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it("keeps remote model URLs unchanged when no desktop bridge is available", async () => {
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: undefined,
    });
    const resolver = createWebMotionAssetResolver([]);
    const url = "https://modelviewer.dev/shared-assets/models/NeilArmstrong.glb";

    await expect(resolver.resolveModelUrl?.(url)).resolves.toBe(url);
  });

  it("renders bound creation scene3d layers through the desktop Aurora bridge", async () => {
    const image = {
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const pngBlob = new Blob(["png"], { type: "image/png" });
    const createImageBitmapMock = vi.fn().mockResolvedValue(image);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => pngBlob,
    });
    const renderPreview = vi.fn().mockResolvedValue({
      backend: "native",
      pngBase64: "cG5n",
      dataUri: "data:image/png;base64,cG5n",
      width: 640,
      height: 360,
      coveredPixels: 12,
      shadowedPixels: 4,
      renderMs: 8,
    });
    const creation: CreationProjectState = {
      version: "1.0.0",
      activeSceneId: "scene-hero",
      assets: [
        {
          id: "asset-phone",
          name: "Phone",
          kind: "product",
          seed: "phone-seed",
          parameters: {},
          nodes: [],
          materials: [],
          dependencies: [],
          caches: [],
          createdAt: 1,
          modifiedAt: 1,
        },
      ],
      scenes: [
        {
          id: "scene-hero",
          name: "Hero Scene",
          duration: 4,
          frameRate: 30,
          objects: [],
          cameras: [],
          lights: [],
          animations: [],
          environment: { kind: "studio" },
          renderBindings: [
            {
              id: "binding-hero",
              kind: "motion-scene3d",
              compositionId: "composition-hero",
              layerId: "layer-hero",
              objectBindings: [],
              createdAt: 2,
              modifiedAt: 2,
            },
          ],
          createdAt: 2,
          modifiedAt: 2,
        },
      ],
      operationHistory: [],
    };
    const composition: MotionComposition = {
      id: "composition-hero",
      name: "Hero",
      width: 1280,
      height: 720,
      frameRate: 30,
      duration: 4,
      backgroundColor: "#223344",
      layers: [],
      assets: [],
      variables: [],
      markers: [],
      createdAt: 1,
      modifiedAt: 1,
    };
    const layer: MotionScene3DLayer = {
      id: "layer-hero",
      type: "scene3d",
      name: "3D Hero",
      startTime: 0,
      duration: 4,
      visible: true,
      locked: false,
      transform: defaultMotionTransform,
      keyframes: [],
      object: {
        kind: "phone",
      },
      width: 640,
      height: 360,
    };
    const quality: MotionRenderQuality = {
      shadows: true,
      shadowMapSize: 1024,
      environment: true,
    };

    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        aurora: { renderPreview },
      },
    });

    const resolver = createWebMotionAssetResolver([], { creation });
    const result = await resolver.renderScene3D?.({
      composition,
      layer,
      localTime: 1.5,
      width: 640,
      height: 360,
      backgroundColor: "#223344",
      quality,
    });

    expect(renderPreview).toHaveBeenCalledWith({
      scene: creation.scenes[0],
      assets: creation.assets,
      width: 640,
      height: 360,
      background: "#223344",
      timeSeconds: 1.5,
      quality: "preview",
    });
    expect(fetchMock).toHaveBeenCalledWith("data:image/png;base64,cG5n");
    expect(createImageBitmapMock).toHaveBeenCalledWith(pngBlob);
    expect(result?.image).toBe(image);

    result?.release?.();
    expect(image.close).toHaveBeenCalledTimes(1);
  });
});

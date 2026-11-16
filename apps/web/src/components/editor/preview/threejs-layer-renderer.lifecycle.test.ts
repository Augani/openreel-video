import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FontLoader, type Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TitleEngine } from "@openreel/core";
import { ThreeJSLayerRenderer } from "./threejs-layer-renderer";
import { get3DFont } from "@openreel/core/video/overlay-three-renderer";

function rendererWithScene(scene: THREE.Scene) {
  const clear = vi.fn();
  const dispose = vi.fn();
  const renderer = Object.assign(Object.create(ThreeJSLayerRenderer.prototype), {
    scene, renderer: { clear, dispose },
  }) as ThreeJSLayerRenderer;
  return { renderer, clear, dispose };
}

describe("preview 3D frame lifecycle", () => {
  it("awaits a font load before an export frame is ready", async () => {
    let complete!: (font: Font) => void;
    const load = vi.spyOn(FontLoader.prototype, "load").mockImplementation((_url, onLoad) => { complete = onLoad!; });
    const subject = Object.create(ThreeJSLayerRenderer.prototype) as ThreeJSLayerRenderer;
    const clip = new TitleEngine().createTextClip({ trackId: "titles", text: "Font barrier", startTime: 0, style: { fontWeight: 400 } });
    let ready = false;
    try {
      const pending = subject.prepareTextClip({ ...clip, text3d: {
        enabled: true, depth: 12, bevelThickness: 1.5, bevelSize: 0.8, bevelSegments: 3, material: "physical",
      } }).then(() => { ready = true; });
      await Promise.resolve();
      expect(ready).toBe(false);
      expect(load).toHaveBeenCalledOnce();
      complete({} as Font);
      await pending;
      expect(ready).toBe(true);
    } finally {
      load.mockRestore();
    }
  });

  it("keeps project coordinates while changing output resolution without reallocating unchanged sizes", () => {
    const camera = new THREE.OrthographicCamera(-640, 640, 360, -360, 0.1, 2000);
    const canvas = { width: 1280, height: 720 };
    const setSize = vi.fn((width: number, height: number) => Object.assign(canvas, { width, height }));
    const subject = Object.assign(Object.create(ThreeJSLayerRenderer.prototype), {
      camera, _canvas: canvas, renderer: { setSize },
    }) as ThreeJSLayerRenderer;
    subject.resize(1280, 720, 1920, 1080);
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([-960, 960, 540, -540]);
    expect(setSize).not.toHaveBeenCalled();
    subject.resize(640, 360, 1920, 1080);
    subject.resize(640, 360, 1920, 1080);
    expect(setSize).toHaveBeenCalledOnce();
    expect(setSize).toHaveBeenCalledWith(640, 360, false);
    expect([camera.right, camera.top]).toEqual([960, 540]);
  });

  it("notifies both hosts waiting for one font and deduplicates repeated frame subscriptions", () => {
    let complete!: (font: Font) => void;
    const load = vi.spyOn(FontLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      complete = onLoad!;
    });
    const first = vi.fn();
    const reopened = vi.fn();
    const font = {} as Font;
    const url = "/fonts/lifecycle-shared-font.json";
    try {
      expect(get3DFont(url, first)).toBeUndefined();
      expect(get3DFont(url, first)).toBeUndefined();
      expect(get3DFont(url, reopened)).toBeUndefined();
      expect(load).toHaveBeenCalledOnce();
      complete(font);
      expect(first).toHaveBeenCalledOnce();
      expect(reopened).toHaveBeenCalledOnce();
      expect(get3DFont(url, first)).toBe(font);
      expect(first).toHaveBeenCalledOnce();
    } finally {
      load.mockRestore();
    }
  });

  it("preserves the scene lights while releasing nested meshes and shared resources once", () => {
    const scene = new THREE.Scene();
    const ambient = new THREE.AmbientLight();
    const directional = new THREE.DirectionalLight();
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshPhysicalMaterial({ map: texture });
    const side = new THREE.MeshStandardMaterial({ map: texture });
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const sideDispose = vi.spyOn(side, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, [material, side]));
    group.add(new THREE.Mesh(geometry, material));
    scene.add(ambient, directional, group);
    const s = rendererWithScene(scene);

    s.renderer.clear();
    expect(scene.children).toEqual([ambient, directional]);
    for (const dispose of [geometryDispose, materialDispose, sideDispose, textureDispose]) {
      expect(dispose).toHaveBeenCalledOnce();
    }
    s.renderer.clear();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(s.clear).toHaveBeenCalledTimes(2);
  });

});

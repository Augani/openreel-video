import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { TemplateEngine, BUILTIN_TEMPLATES } from "./template-engine";
import { TitleEngine } from "../text/title-engine";
import { GraphicsEngine } from "../graphics/graphics-engine";
import {
  getMotionShaderTextDefs,
  getMotionShaderFillDefs,
  getMotionShaderEffectDefs,
  defaultMotionShaderParams,
} from "../motion/shaders";
import { createEffectFromPreset } from "../effects/particle-presets";
import type { Project } from "../types/project";
import type { Template } from "../types/template";
import type { ScriptableTemplate } from "../types/scriptable-template";
import type { MotionShaderDef } from "../motion/shaders/types";
import type { SVGClip, StickerClip } from "../graphics/types";

const materials = [
  ...getMotionShaderTextDefs(),
  ...getMotionShaderFillDefs(),
  ...getMotionShaderEffectDefs(),
];
const options = {
  name: "Retained project",
  description: "Complete editable content",
  category: "custom" as const,
  placeholders: [],
  tags: ["saved", "material"],
};
function project(def = materials[0]): Project {
  const titles = new TitleEngine(),
    graphics = new GraphicsEngine();
  const title = titles.createTextClip({
    id: "title",
    trackId: "titles",
    startTime: 0,
    duration: 2,
    text: "Measured motion",
    style: {
      shader: {
        shaderId: def.id,
        params: defaultMotionShaderParams(def),
        progress: 0.37,
      },
      color: "rgba(100,140,200,0.4)",
      shadowColor: "#4422aa",
      shadowBlur: 4,
      strokeWidth: 0,
      fontFamily: "Inter",
    },
    animation: {
      preset: "fade",
      params: { easing: "ease-out" },
      inDuration: 0.2,
      outDuration: 0.3,
    },
    metadata: { captionSource: "template-preservation" },
  });
  for (let index = 0; index < 33; index++)
    title.keyframes.push({
      id: `tracking-${index}`,
      time: index / 24,
      property: "position.x",
      value: index / 64,
      easing: "linear",
    });
  const shape = graphics.createShape(
    {
      id: "shape",
      shapeType: "rectangle",
      width: 80,
      height: 50,
      style: {
        fill: { type: "solid", color: "#11aa55", opacity: 0 },
        stroke: { color: "#000000", width: 0, opacity: 0 },
      },
    },
    "graphics",
    0,
    2,
  );
  const svg: SVGClip = {
    id: "svg",
    trackId: "graphics",
    startTime: 0,
    duration: 2,
    type: "svg",
    transform: shape.transform,
    keyframes: [],
    svgContent: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 10, height: 10 },
    preserveAspectRatio: "xMidYMid",
    colorStyle: { colorMode: "tint", tintColor: "#00ff00", tintOpacity: 0 },
    entryAnimation: { type: "rotate", duration: 0.25, easing: "linear" },
  };
  const sticker: StickerClip = {
    id: "sticker",
    trackId: "graphics",
    startTime: 0,
    duration: 2,
    type: "sticker",
    transform: shape.transform,
    keyframes: [],
    imageUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xQAAAABJRU5ErkJggg==",
    name: "Retained sticker",
  };
  const track = {
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    transitions: [],
  };
  return {
    id: "source-project",
    name: "Original",
    createdAt: 1,
    modifiedAt: 2,
    settings: {
      width: 640,
      height: 360,
      frameRate: 24,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          ...track,
          id: "video",
          type: "video",
          name: "Main",
          clips: [
            {
              id: "video",
              mediaId: "source-media",
              trackId: "video",
              startTime: 0,
              duration: 2,
              inPoint: 0,
              outPoint: 2,
              transform: shape.transform,
              effects: [],
              audioEffects: [],
              keyframes: [],
              volume: 0,
            },
          ],
        },
        { ...track, id: "titles", type: "text", name: "Titles", clips: [] },
        {
          ...track,
          id: "graphics",
          type: "graphics",
          name: "Graphics",
          clips: [],
        },
      ],
      subtitles: [],
      duration: 2,
      markers: [{ id: "mark", time: 1, label: "Middle", color: "#22aa66" }],
      backgroundFillMode: "color",
      layoutBackgroundColor: "#101010",
    },
    mediaLibrary: {
      items: [
        {
          id: "source-media",
          name: "source.mp4",
          type: "video",
          blob: new Blob(["original bytes"], { type: "video/mp4" }),
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 2,
            width: 320,
            height: 180,
            frameRate: 30,
            sampleRate: 48000,
            channels: 2,
            fileSize: 14,
            codec: "h264",
          },
        },
      ],
    },
    textClips: [title],
    shapeClips: [shape],
    svgClips: [svg],
    stickerClips: [sticker],
    masks: [
      {
        id: "mask",
        clipId: "video",
        type: "drawn",
        path: {
          closed: true,
          points: [
            { x: 0.1, y: 0.2, handleOut: { x: 0.2, y: 0.3 } },
            { x: 0.8, y: 0.2 },
            { x: 0.5, y: 0.9 },
          ],
        },
        feathering: 12,
        expansion: -3,
        opacity: 0.42,
        inverted: true,
        keyframes: [
          {
            id: "mask-key",
            time: 1,
            easing: "ease-in-out",
            path: {
              closed: true,
              points: [
                { x: 0.2, y: 0.2 },
                { x: 0.9, y: 0.2 },
                { x: 0.5, y: 0.8 },
              ],
            },
          },
        ],
      },
    ],
    particleEffects: [
      {
        ...createEffectFromPreset(
          "confetti-celebration",
          "particles",
          "title",
          0,
          1.5,
        )!,
        clipStartTime: 0,
      },
    ],
    adjustmentLayers: [],
    multicamGroups: [],
    compoundClips: [],
    nestedInstances: [],
    motionCompositions: [],
    motionInstances: [],
    generatedShaders: [],
    capabilities: ["saved-overlays"],
    minimumReaderVersion: "1.0.0",
  };
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("complete saved template content", () => {
  it("retains an explicitly cleared optional text placeholder instead of restoring its default", () => {
    const engine = new TemplateEngine(),
      base = BUILTIN_TEMPLATES[0];
    const placeholder = base.placeholders.find((item) => item.type === "text")!;
    const template = {
      ...base,
      placeholders: base.placeholders.map((item) =>
        item.id === placeholder.id ? { ...item, required: false } : item,
      ),
    };
    const result = engine.applyTemplate(template, {
      [placeholder.id]: { type: "text", value: "" },
    });
    const record = result.textClips.find(
      (item) => item.placeholderId === placeholder.id,
    )!;
    expect(record.text).toBe("");
    expect(
      result.project.textClips!.find((item) => item.id === record.id)!.text,
    ).toBe("");
  });

  it("lists summaries without cloning every full media-bearing template at once", async () => {
    const engine = new TemplateEngine(),
      template = engine.createFromProject(project(), options);
    await engine.saveTemplate(template);
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const result = await engine.listTemplates();
    expect(getAll).not.toHaveBeenCalled();
    expect(result.find((item) => item.id === template.id)).toEqual({
      id: template.id,
      name: template.name,
      category: "custom",
      thumbnailUrl: null,
      placeholderCount: 0,
      duration: 2,
    });
    expect(result.length).toBe(BUILTIN_TEMPLATES.length + 1);
  });

  it("does not expose editable cache objects through search or catalog accessors", async () => {
    const engine = new TemplateEngine(),
      template = engine.createFromProject(project(), options);
    await engine.saveTemplate(template);
    const source = structuredClone(template.settings);
    for (const collection of [
      engine.searchTemplates("Retained project"),
      engine.getTemplatesByCategory("custom"),
      engine.getAllTemplates(),
    ]) {
      const found = collection.find((item) => item.id === template.id)!;
      Object.assign(found.settings, { width: 99 });
    }
    expect((await engine.loadTemplate(template.id))!.settings).toEqual(source);
    const builtins = engine.getBuiltinTemplates();
    Object.assign(builtins[0].settings, { width: 99 });
    expect(engine.getBuiltinTemplates()[0].settings.width).toBe(
      BUILTIN_TEMPLATES[0].settings.width,
    );
  });

  it("retains a committed template and cached data when deletion aborts after a successful request", async () => {
    const engine = new TemplateEngine(),
      template = engine.createFromProject(project(), options);
    await engine.saveTemplate(template);
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore,
      key,
    ) {
      const request = remove.call(this, key);
      request.addEventListener("success", () => this.transaction.abort(), {
        once: true,
      });
      return request;
    });
    await expect(engine.deleteTemplate(template.id)).rejects.toThrow(
      "cancelled",
    );
    expect(await engine.loadTemplate(template.id)).not.toBeNull();
    expect(await new TemplateEngine().loadTemplate(template.id)).not.toBeNull();
  });

  it("treats an explicitly blank required override as missing instead of silently restoring its default", () => {
    const engine = new TemplateEngine(),
      base = engine.createFromProject(project(), options);
    const template: Template = {
      ...base,
      placeholders: [
        {
          id: "words",
          label: "Words",
          type: "text",
          required: true,
          defaultValue: "Default words",
        },
      ],
    };
    expect(engine.applyTemplate(template, {}).missingPlaceholders).toEqual([]);
    expect(
      engine.applyTemplate(template, { words: { type: "text", value: "  " } })
        .missingPlaceholders,
    ).toEqual(["Words"]);
  });

  it.each(["subtitle", "text"] as const)(
    "applies %s subtitle replacements and retains caption timing and style",
    (type) => {
      const engine = new TemplateEngine(),
        base = engine.createFromProject(project(), options);
      const caption = {
        id: "caption",
        startTime: 0.2,
        endTime: 1.2,
        text: "Original",
        isPlaceholder: true,
        placeholderId: "caption",
        style: {
          fontFamily: "Inter",
          fontSize: 28,
          color: "#ee44aa",
          backgroundColor: "#000000",
          position: "bottom" as const,
        },
      };
      const template: Template = {
        ...base,
        timeline: { ...base.timeline, subtitles: [caption] },
        placeholders: [
          { id: "caption", type: "subtitle", label: "Caption", required: true },
        ],
      };
      expect(
        engine.applyTemplate(template, {
          caption: { type, value: "Replacement" },
        }).project.timeline.subtitles[0],
      ).toEqual({
        id: "caption",
        startTime: 0.2,
        endTime: 1.2,
        text: "Replacement",
        style: caption.style,
      });
    },
  );

  it("retains real library media metadata and original bytes rather than defaulting footage to an image", () => {
    const engine = new TemplateEngine(),
      source = project(),
      item = source.mediaLibrary.items[0];
    const base = engine.createFromProject(source, options),
      template = {
        ...base,
        placeholders: [
          {
            id: "replacement",
            type: "media" as const,
            label: "Footage",
            required: true,
          },
        ],
      };
    const result = engine.applyTemplate(template, {
      replacement: {
        type: "media",
        value: item.id,
        mediaBlob: item.blob!,
        media: { name: item.name, type: item.type, metadata: item.metadata },
      },
    });
    const media = result.project.mediaLibrary.items.find(
      (candidate) => candidate.id === "replacement",
    )!;
    expect(media).toMatchObject({
      name: item.name,
      type: "video",
      metadata: item.metadata,
      isPlaceholder: false,
    });
    expect(media.blob).toBe(item.blob);
    expect(media.metadata).not.toBe(item.metadata);
  });

  it("keeps unresolved media defaults visible as relinkable references", () => {
    const engine = new TemplateEngine(),
      base = engine.createFromProject(project(), options);
    const template = {
      ...base,
      placeholders: [
        {
          id: "replacement",
          type: "media" as const,
          label: "Footage",
          required: true,
          defaultValue: "library-original",
        },
      ],
    };
    expect(
      engine
        .applyTemplate(template, {})
        .project.mediaLibrary.items.find((item) => item.id === "replacement"),
    ).toMatchObject({
      blob: null,
      name: "library-original",
      isPlaceholder: true,
    });
  });

  it("retains scriptable audio replacement types and metadata", () => {
    const engine = new TemplateEngine(),
      source = project(),
      base = engine.createFromProject(source, options);
    const template: ScriptableTemplate = {
      ...base,
      placeholders: [
        {
          id: "music",
          type: "audio",
          label: "Music",
          required: true,
          defaultValue: "",
          targets: [],
        },
      ],
    };
    const blob = new Blob(["audio"], { type: "audio/wav" });
    const result = engine.applyScriptableTemplate(template, {
      music: {
        type: "audio",
        value: "music",
        mediaBlob: blob,
        media: {
          name: "Music.wav",
          type: "audio",
          metadata: {
            ...source.mediaLibrary.items[0].metadata,
            duration: 8,
            width: 0,
            height: 0,
            fileSize: blob.size,
          },
        },
      },
    });
    expect(result.result.success).toBe(true);
    expect(
      result.project.mediaLibrary.items.find((item) => item.id === "music"),
    ).toMatchObject({
      name: "Music.wav",
      type: "audio",
      blob,
      metadata: { duration: 8, width: 0, height: 0, fileSize: 5 },
    });
  });

  it("opens one database for simultaneous initialization requests", async () => {
    const open = vi.spyOn(indexedDB, "open"),
      engine = new TemplateEngine();
    await Promise.all([
      engine.initialize(),
      engine.initialize(),
      engine.initialize(),
    ]);
    expect(open).toHaveBeenCalledOnce();
    expect(await engine.loadTemplate(BUILTIN_TEMPLATES[0].id)).not.toBeNull();
  });

  it("keeps input and loaded data independent from the committed cache", async () => {
    const engine = new TemplateEngine(),
      template = engine.createFromProject(project(), options);
    const before = structuredClone(template);
    await engine.saveTemplate(template);
    Object.assign(template.settings, { width: 99 });
    const first = await engine.loadTemplate(template.id);
    expect(first?.settings).toEqual(before.settings);
    first!.projectContent!.particleEffects![0].config.colors.push("#010203");
    expect(
      (await engine.loadTemplate(template.id))?.projectContent?.particleEffects,
    ).toEqual(before.projectContent?.particleEffects);
  });

  it("retains cloud JSON media references as relinkable originals instead of treating empty Blob objects as footage", () => {
    const engine = new TemplateEngine(),
      source = project();
    const template = JSON.parse(
      JSON.stringify(engine.createFromProject(source, options)),
    ) as Template;
    const result = engine.applyTemplate(template, {}).project;
    expect(result.textClips).toEqual(source.textClips);
    expect(result.mediaLibrary.items[0]).toMatchObject({
      id: "source-media",
      name: "source.mp4",
      blob: null,
      fileHandle: null,
      isPlaceholder: true,
      metadata: source.mediaLibrary.items[0].metadata,
    });
  });

  it("does not serialize native file-handle functions or share editable media metadata", async () => {
    const source = project(),
      engine = new TemplateEngine();
    Object.assign(source.mediaLibrary.items[0], {
      fileHandle: { getFile: async () => source.mediaLibrary.items[0].blob },
    });
    const template = engine.createFromProject(source, options);
    await expect(engine.saveTemplate(template)).resolves.toBeUndefined();
    expect(
      template.projectContent!.mediaLibrary.items[0].fileHandle,
    ).toBeNull();
    Object.assign(source.mediaLibrary.items[0].metadata, { duration: 99 });
    expect(
      template.projectContent!.mediaLibrary.items[0].metadata.duration,
    ).toBe(2);
  });

  it("rejects a cancelled write even when its cancellation reason is false", async () => {
    const engine = new TemplateEngine(),
      template = engine.createFromProject(project(), options),
      controller = new AbortController();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      request.addEventListener("success", () => controller.abort(false), {
        once: true,
      });
      return request;
    });
    await expect(
      engine.saveTemplate(template, { signal: controller.signal }),
    ).rejects.toBe(false);
    expect(await engine.loadTemplate(template.id)).toBeNull();
  });

  it("rejects prototype paths and sparse array writes while keeping valid array append", () => {
    const engine = new TemplateEngine(),
      target = { params: { colors: ["#000000"] } };
    expect(
      engine.setPropertyByPath(target, "__proto__.templatePollution", true),
    ).toBe(false);
    expect(
      engine.setPropertyByPath(
        target,
        "params.constructor.prototype.templatePollution",
        true,
      ),
    ).toBe(false);
    expect(
      engine.setPropertyByPath(target, "params.colors[999999999]", "#ffffff"),
    ).toBe(false);
    expect(
      engine.setPropertyByPath(target, "params.colors[1]", "#ffffff"),
    ).toBe(true);
    expect(target.params.colors).toEqual(["#000000", "#ffffff"]);
    expect(Object.prototype).not.toHaveProperty("templatePollution");
  });

  it.each(materials.slice(0, 3))(
    "saves and reapplies $id with its complete canonical project content",
    async (def: MotionShaderDef) => {
      const source = project(def),
        engine = new TemplateEngine();
      const template = engine.createFromProject(source, options);
      await engine.saveTemplate(template);
      const reader = new TemplateEngine();
      const loaded = await reader.loadTemplate(template.id);
      expect(loaded).not.toBeNull();
      const applied = reader.applyTemplate(loaded!, {}).project;
      expect({
        ...applied,
        id: source.id,
        name: source.name,
        createdAt: source.createdAt,
        modifiedAt: source.modifiedAt,
      }).toEqual(source);
      expect(await applied.mediaLibrary.items[0].blob!.text()).toBe(
        "original bytes",
      );
    },
  );

  it("owns independent source, stored, loaded and separately applied data", async () => {
    const source = project(),
      engine = new TemplateEngine(),
      before = structuredClone(source);
    const template = engine.createFromProject(source, options);
    Object.assign(source.settings, { width: 99 });
    source.textClips![0].style.shader!.params.changed = 1;
    await engine.saveTemplate(template);
    const first = await engine.loadTemplate(template.id);
    const applied = engine.applyTemplate(first!, {}).project;
    Object.assign(applied.settings, { height: 99 });
    applied.textClips![0].style.shader!.params.changed = 2;
    applied.masks![0].path.points[0].x = 0.99;
    const second = engine.applyTemplate(
      (await engine.loadTemplate(template.id))!,
      {},
    ).project;
    expect(second.settings).toEqual(before.settings);
    expect(second.textClips).toEqual(before.textClips);
    expect(second.masks).toEqual(before.masks);
  });

  it("does not report success or poison the cache when a successful put is followed by transaction abort", async () => {
    const engine = new TemplateEngine(),
      template = engine.createFromProject(project(), options);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      request.addEventListener("success", () => this.transaction.abort(), {
        once: true,
      });
      return request;
    });
    await expect(engine.saveTemplate(template)).rejects.toBeDefined();
    expect(await engine.loadTemplate(template.id)).toBeNull();
  });

  it("recovers the old graphics sidecar without sharing template objects", () => {
    const source = project(),
      engine = new TemplateEngine();
    const { projectContent: _content, ...base } = engine.createFromProject(
      source,
      options,
    );
    const legacy: Template = {
      ...base,
      timeline: {
        ...base.timeline,
        graphics: {
          shapes: source.shapeClips!,
          svgs: source.svgClips!,
          stickers: source.stickerClips!,
        },
      },
    };
    const result = engine.applyTemplate(legacy, {}).project;
    expect(result.shapeClips).toEqual(source.shapeClips);
    expect(result.svgClips).toEqual(source.svgClips);
    expect(result.stickerClips).toEqual(source.stickerClips);
    expect(result.shapeClips).not.toBe(source.shapeClips);
  });

  it("materializes legacy built-in text defaults in canonical saved clips while retaining the returned placeholder records", () => {
    const engine = new TemplateEngine(),
      template = BUILTIN_TEMPLATES[0];
    const result = engine.applyTemplate(template, {});
    expect(result.missingPlaceholders).toEqual([]);
    expect(result.textClips.length).toBeGreaterThan(0);
    expect(result.project.textClips!.map((clip) => clip.text)).toEqual(
      result.textClips.map((clip) => clip.text),
    );
    expect(result.project.textClips![0].style.fontFamily).toBe("Inter");
  });

  it("applies scriptable style targets to canonical overlays and retains masks, particles and source media", () => {
    const source = project(),
      engine = new TemplateEngine();
    const base = engine.createFromProject(source, options);
    const scriptable: ScriptableTemplate = {
      ...base,
      placeholders: [
        {
          id: "ink",
          type: "color",
          label: "Ink",
          required: true,
          defaultValue: "#00ff00",
          targets: [{ clipId: "title", property: "style.color" }],
        },
      ],
    };
    const result = engine.applyScriptableTemplate(scriptable, {});
    expect(result.result.success).toBe(true);
    expect(result.result.warnings).toEqual([]);
    expect(result.project.textClips![0].style).toEqual({
      ...source.textClips![0].style,
      color: "#00ff00",
    });
    expect(result.project.masks).toEqual(source.masks);
    expect(result.project.particleEffects).toEqual(source.particleEffects);
    expect(result.project.mediaLibrary.items).toHaveLength(1);
  });
});

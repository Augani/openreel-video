import { describe, expect, it } from "vitest";
import { TemplateEngine, BUILTIN_TEMPLATES } from "./template-engine";
import type {
  ExtendedPlaceholder,
  ScriptableTemplate,
} from "../types/scriptable-template";
const field = (
  type: ExtendedPlaceholder["type"],
  constraints?: ExtendedPlaceholder["constraints"],
): ExtendedPlaceholder => ({
  id: "field",
  type,
  label: "Field",
  required: true,
  defaultValue: undefined,
  targets: [],
  constraints,
});
describe("complete scriptable template validation", () => {
  it("resolves later global effect targets after an earlier field replaces an effect stack", () => {
    const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project,
      title = source.textClips![0];
    const base = engine.createFromProject(source, {
      name: "Dynamic effects",
      description: "Retain ordered targets",
      category: "custom",
      placeholders: [],
      tags: [],
    });
    const effect = {
      id: "new-effect",
      type: "blur",
      enabled: true,
      params: { radius: 12 },
    };
    const result = engine.applyScriptableTemplate(
      {
        ...base,
        placeholders: [
          {
            ...field("effect"),
            id: "stack",
            targets: [{ clipId: title.id, property: "effects" }],
          },
          {
            ...field("number"),
            id: "amount",
            targets: [{ effectId: effect.id, property: "params.radius" }],
          },
        ],
      },
      {
        stack: { type: "effect", value: [effect] },
        amount: { type: "number", value: 0 },
      },
    );
    expect(result.result.warnings).toEqual([]);
    expect(result.project.textClips![0].effects![0].params.radius).toBe(0);
    expect(
      result.project.timeline.tracks[1].clips[0].effects[0].params.radius,
    ).toBe(0);
  });
  it("resolves later keyframe targets after replacing an animated clip's keyframes", () => {
    const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project,
      title = source.textClips![0];
    const base = engine.createFromProject(source, {
      name: "Dynamic keys",
      description: "Retain ordered targets",
      category: "custom",
      placeholders: [],
      tags: [],
    });
    const key = {
      id: "new-key",
      time: 0.5,
      property: "style.fontSize",
      value: 0,
      easing: "linear" as const,
    };
    const result = engine.applyScriptableTemplate(
      {
        ...base,
        placeholders: [
          {
            ...field("keyframe"),
            id: "keys",
            targets: [{ clipId: title.id, property: "keyframes" }],
          },
          {
            ...field("number"),
            id: "value",
            targets: [{ keyframeId: key.id, property: "value" }],
          },
        ],
      },
      {
        keys: { type: "keyframe", value: [key] },
        value: { type: "number", value: 0.37 },
      },
    );
    expect(result.result.warnings).toEqual([]);
    expect(result.project.textClips![0].keyframes[0].value).toBe(0.37);
  });
  it.each([true, false])(
    "updates a %s-scoped keyframe target while preserving its timing",
    (scoped) => {
      const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project,
        original = source.textClips![0];
      const key = {
        id: "key",
        time: 0.5,
        property: "style.fontSize",
        value: 0,
        easing: "linear" as const,
      };
      const base = engine.createFromProject(
        { ...source, textClips: [{ ...original, keyframes: [key] }] },
        {
          name: "Keyframe",
          description: "Typed target",
          category: "custom",
          placeholders: [],
          tags: [],
        },
      );
      const result = engine.applyScriptableTemplate(
        {
          ...base,
          placeholders: [
            {
              ...field("number"),
              targets: [
                {
                  ...(scoped ? { clipId: original.id } : {}),
                  keyframeId: "key",
                  property: "value",
                },
              ],
            },
          ],
        },
        { field: { type: "number", value: 0.37 } },
      );
      expect(result.result.warnings).toEqual([]);
      expect(result.project.textClips![0].keyframes[0]).toEqual({
        ...key,
        value: 0.37,
      });
    },
  );
  it.each([true, false])(
    "updates a %s-scoped effect target with an independent zero value",
    (scoped) => {
      const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project,
        original = source.textClips![0];
      const effect = {
        id: "effect",
        type: "blur",
        params: { radius: 12 },
        enabled: true,
      };
      const base = engine.createFromProject(
        { ...source, textClips: [{ ...original, effects: [effect] }] },
        {
          name: "Effect",
          description: "Typed target",
          category: "custom",
          placeholders: [],
          tags: [],
        },
      );
      const result = engine.applyScriptableTemplate(
        {
          ...base,
          placeholders: [
            {
              ...field("number"),
              targets: [
                {
                  ...(scoped ? { clipId: original.id } : {}),
                  effectId: "effect",
                  property: "params.radius",
                },
              ],
            },
          ],
        },
        { field: { type: "number", value: 0 } },
      );
      expect(result.result.warnings).toEqual([]);
      expect(result.project.textClips![0].effects![0].params.radius).toBe(0);
      expect(effect.params.radius).toBe(12);
    },
  );
  it("retains track targets and warns when a scoped keyframe is unavailable", () => {
    const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project,
      base = engine.createFromProject(source, {
        name: "Track",
        description: "Typed target",
        category: "custom",
        placeholders: [],
        tags: [],
      });
    const result = engine.applyScriptableTemplate(
      {
        ...base,
        placeholders: [
          {
            ...field("boolean"),
            targets: [
              { trackId: source.timeline.tracks[0].id, property: "muted" },
            ],
          },
        ],
      },
      { field: { type: "boolean", value: true } },
    );
    expect(result.project.timeline.tracks[0].muted).toBe(true);
    const missing = engine.applyScriptableTemplate(
      {
        ...base,
        placeholders: [
          {
            ...field("number"),
            targets: [
              {
                clipId: source.textClips![0].id,
                keyframeId: "missing",
                property: "value",
              },
            ],
          },
        ],
      },
      { field: { type: "number", value: 0 } },
    );
    expect(missing.result.warnings).toEqual([
      "Target not found for placeholder field",
    ]);
  });
  it.each(["media", "audio"] as const)(
    "binds a selected %s original to the created media row",
    (type) => {
      const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project;
      const original = source.timeline.tracks[1].clips[0];
      const video = {
        ...source.timeline.tracks[0],
        id: "video",
        clips: [
          {
            ...original,
            id: "footage",
            trackId: "video",
            mediaId: "old-media",
          },
        ],
      };
      const base = engine.createFromProject(
        {
          ...source,
          timeline: {
            ...source.timeline,
            tracks: [video, ...source.timeline.tracks.slice(1)],
          },
        },
        {
          name: "Selected footage",
          description: "Bind real bytes",
          category: "custom",
          placeholders: [],
          tags: [],
        },
      );
      const placeholder = {
        ...field(type),
        targets: [{ clipId: "footage", property: "mediaId" }],
      };
      const blob = new Blob(["real original"], {
        type: type === "audio" ? "audio/wav" : "video/mp4",
      });
      const result = engine.applyScriptableTemplate(
        { ...base, placeholders: [placeholder] },
        { field: { type, value: "library-id", mediaBlob: blob } },
      );
      expect(result.project.timeline.tracks[0].clips[0].mediaId).toBe(
        result.project.mediaLibrary.items.find((item) => item.blob === blob)!
          .id,
      );
      expect(result.result.warnings).toEqual([]);
    },
  );
  it.each(["text", "content"])(
    "applies a subtitle target's %s property to its saved caption text",
    (property) => {
      const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project;
      const caption = {
        id: "caption",
        text: "Before",
        startTime: 0.2,
        endTime: 1.2,
        style: {
          fontFamily: "Inter",
          fontSize: 28,
          color: "#ee44aa",
          backgroundColor: "#000000",
          position: "bottom" as const,
        },
      };
      const base = engine.createFromProject(
        { ...source, timeline: { ...source.timeline, subtitles: [caption] } },
        {
          name: "Caption",
          description: "Editable caption",
          category: "custom",
          placeholders: [],
          tags: [],
        },
      );
      const result = engine.applyScriptableTemplate(
        {
          ...base,
          placeholders: [
            {
              ...field("subtitle"),
              targets: [{ clipId: "caption", property }],
            },
          ],
        },
        { field: { type: "subtitle", value: "After" } },
      );
      expect(result.project.timeline.subtitles[0]).toEqual({
        ...caption,
        text: "After",
      });
      expect(result.result.warnings).toEqual([]);
    },
  );
  it("updates generic and canonical text targets from the same field", () => {
    const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project;
    const original = source.textClips![0];
    const base = engine.createFromProject(
      {
        ...source,
        textClips: [
          ...source.textClips!,
          { ...original, id: "canonical-only" },
        ],
      },
      {
        name: "Repeated words",
        description: "All matching targets",
        category: "custom",
        placeholders: [],
        tags: [],
      },
    );
    const result = engine.applyScriptableTemplate(
      {
        ...base,
        placeholders: [
          {
            ...field("text"),
            targets: [
              { clipId: original.id, property: "content" },
              { clipId: "canonical-only", property: "content" },
            ],
          },
        ],
      },
      { field: { type: "text", value: "Both updated" } },
    );
    expect(result.project.textClips!.map((clip) => clip.text)).toEqual([
      "Both updated",
      "Both updated",
    ]);
  });
  const engine = new TemplateEngine();
  it.each([NaN, Infinity, -Infinity])(
    "rejects a non-finite number %s before project application",
    (value) => {
      expect(
        engine.validatePlaceholderValue(field("number"), value)?.type,
      ).toBe("invalid");
    },
  );
  it("honors an explicit zero character limit", () => {
    expect(
      engine.validatePlaceholderValue(
        { ...field("text", { maxLength: 0 }), required: false },
        "a",
      )?.type,
    ).toBe("constraint");
    expect(
      engine.validatePlaceholderValue(
        { ...field("text", { maxLength: 0 }), required: false },
        "",
      ),
    ).toBeNull();
  });
  it("reports invalid author regex constraints without throwing", () => {
    expect(
      engine.validatePlaceholderValue(field("text", { pattern: "[" }), "Words")
        ?.type,
    ).toBe("constraint");
  });
  it.each(["text", "subtitle", "media", "font"] as const)(
    "rejects blank required %s values",
    (type) => {
      expect(engine.validatePlaceholderValue(field(type), "  ")?.type).toBe(
        "missing",
      );
    },
  );
  it("retains zero and false as valid required values", () => {
    expect(
      engine.validatePlaceholderValue(field("number", { min: 0, max: 0 }), 0),
    ).toBeNull();
    expect(engine.validatePlaceholderValue(field("boolean"), false)).toBeNull();
  });
  it("honors the font and animation constraints represented by their pickers", () => {
    expect(
      engine.validatePlaceholderValue(
        field("font", { allowedFonts: ["Inter"] }),
        "Other",
      )?.type,
    ).toBe("constraint");
    expect(
      engine.validatePlaceholderValue(
        field("font", { allowedFonts: ["Inter"] }),
        "Inter",
      ),
    ).toBeNull();
    expect(
      engine.validatePlaceholderValue(
        field("animation", { allowedAnimations: ["fade"] }),
        "other",
      )?.type,
    ).toBe("constraint");
    expect(
      engine.validatePlaceholderValue(
        field("animation", { allowedAnimations: ["fade"] }),
        "fade",
      ),
    ).toBeNull();
  });
  it("owns structured replacement values independently from the editor's draft", () => {
    const source = engine.applyTemplate(BUILTIN_TEMPLATES[0], {}).project;
    const title = source.textClips![0];
    const base = engine.createFromProject(source, {
      name: "Structured style",
      description: "Editable style",
      category: "custom",
      placeholders: [],
      tags: [],
    });
    const placeholder = {
      ...field("style"),
      targets: [{ clipId: title.id, property: "style" }],
    };
    const template: ScriptableTemplate = {
      ...base,
      placeholders: [placeholder],
    };
    const style = {
      ...title.style,
      shader: {
        shaderId: "paper-mesh-gradient",
        params: { color1: "#ee44aa" },
        progress: 0.37,
      },
    };
    const result = engine.applyScriptableTemplate(template, {
      field: { type: "style", value: style },
    });
    expect(result.result.success).toBe(true);
    expect(result.project.textClips![0].style).toEqual(style);
    expect(result.project.textClips![0].style).not.toBe(style);
    style.shader.params.color1 = "#000000";
    expect(result.project.textClips![0].style.shader!.params.color1).toBe(
      "#ee44aa",
    );
  });
});

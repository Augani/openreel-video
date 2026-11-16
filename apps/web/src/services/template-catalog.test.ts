import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES, TemplateEngine } from "@openreel/core";
import {
  catalogFromSummary,
  catalogFromTemplate,
  mergeTemplateCatalog,
  toScriptableTemplate,
} from "./template-catalog";
describe("complete lightweight template catalog", () => {
  it("retains already-scriptable target lists, field hints and social category", () => {
    const base = BUILTIN_TEMPLATES[0],
      target = { clipId: "other", property: "text" };
    const saved = {
      ...base,
      socialCategory: "instagram-stories" as const,
      placeholders: [
        {
          ...base.placeholders[0],
          targets: [target],
          uiHints: { inputType: "textarea" as const, advanced: true, order: 2 },
        },
      ],
    };
    const converted = toScriptableTemplate(saved);
    expect(converted.socialCategory).toBe("instagram-stories");
    expect(converted.placeholders[0]).toEqual(saved.placeholders[0]);
  });
  it("converts every repeated legacy text target instead of only its last clip", () => {
    const base = BUILTIN_TEMPLATES[0],
      track = base.timeline.tracks[1],
      clip = track.clips[0];
    const converted = toScriptableTemplate({
      ...base,
      timeline: {
        ...base.timeline,
        tracks: [
          base.timeline.tracks[0],
          { ...track, clips: [clip, { ...clip, id: "repeat" }] },
        ],
      },
    });
    expect(
      converted.placeholders[0].targets.map((target) => target.clipId),
    ).toEqual([clip.id, "repeat"]);
    const result = new TemplateEngine().applyScriptableTemplate(converted, {
      [converted.placeholders[0].id]: { type: "text", value: "Both words" },
    });
    expect(result.project.textClips!.map((item) => item.text)).toEqual([
      "Both words",
      "Both words",
    ]);
  });
  it("retains saved subtitle targets and their editable field type", () => {
    const base = BUILTIN_TEMPLATES[0];
    const converted = toScriptableTemplate({
      ...base,
      placeholders: [
        {
          id: "caption",
          type: "subtitle",
          label: "Caption",
          required: true,
          defaultValue: "Original",
        },
      ],
      timeline: {
        ...base.timeline,
        subtitles: [
          {
            id: "caption-1",
            text: "Original",
            startTime: 0,
            endTime: 1,
            isPlaceholder: true,
            placeholderId: "caption",
          },
        ],
      },
    });
    expect(converted.placeholders[0]).toMatchObject({
      type: "subtitle",
      targets: [{ clipId: "caption-1", property: "text" }],
    });
    expect(
      new TemplateEngine().applyScriptableTemplate(converted, {
        caption: { type: "subtitle", value: "Updated" },
      }).project.timeline.subtitles[0].text,
    ).toBe("Updated");
  });
  it("keeps local display summaries separate from full media-bearing template documents", () => {
    const entry = catalogFromSummary({
      id: "local",
      name: "Local originals",
      category: "custom",
      thumbnailUrl: null,
      placeholderCount: 4,
      duration: 8,
    });
    expect(entry).toMatchObject({
      source: "local",
      placeholderCount: 4,
      duration: 8,
    });
    expect(entry).not.toHaveProperty("template");
  });
  it("retains original-media ownership when a cloud record shares a local ID", () => {
    const builtin = catalogFromTemplate(
      toScriptableTemplate(BUILTIN_TEMPLATES[0]),
      "builtin",
    );
    const local = {
        ...builtin,
        source: "local" as const,
        name: "Original bytes",
      },
      cloud = { ...builtin, source: "cloud" as const, name: "Relink cloud" };
    expect(mergeTemplateCatalog([builtin], [cloud, local, cloud])).toEqual([
      local,
    ]);
  });
});

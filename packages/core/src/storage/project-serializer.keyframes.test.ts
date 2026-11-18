import { describe, expect, it } from "vitest";
import { normalizeProjectStoredFields } from "./project-serializer";
import type { Project } from "../types/project";

describe("normalizeProjectStoredFields effect keyframes", () => {
  const legacy = { id: "k1", time: 0, property: "effect.brightness", value: 0.5, easing: "linear" as const };
  const build = (): Project =>
    ({
      timeline: {
        tracks: [
          {
            id: "t",
            clips: [
              {
                id: "c",
                effects: [{ id: "e1", type: "brightness", enabled: true, params: { value: 0 } }],
                keyframes: [legacy],
              },
            ],
          },
        ],
      },
    }) as unknown as Project;

  it("rewrites type-keyed effect keyframes onto the effect instance on load", () => {
    const out = normalizeProjectStoredFields(build());
    expect(out.timeline.tracks[0].clips[0].keyframes.map((k) => k.property)).toEqual(["fx:e1:value"]);
    expect(out.timeline.tracks[0].clips[0].keyframes[0]).toMatchObject({ id: "k1", time: 0, value: 0.5 });
  });

  it("is idempotent across repeated loads", () => {
    const once = normalizeProjectStoredFields(build());
    const twice = normalizeProjectStoredFields(once);
    expect(twice.timeline.tracks[0].clips[0].keyframes).toEqual(once.timeline.tracks[0].clips[0].keyframes);
  });

  it("migrates the clips of every stored sequence too", () => {
    const project = build();
    const withSequence = {
      ...project,
      sequences: [
        { id: "s2", name: "Other", settings: {}, timeline: project.timeline, createdAt: 0, modifiedAt: 0 },
      ],
    } as unknown as Project;
    const out = normalizeProjectStoredFields(withSequence);
    const stored = out.sequences?.find((sequence) => sequence.id === "s2");
    expect(stored?.timeline.tracks[0].clips[0].keyframes.map((k) => k.property)).toEqual(["fx:e1:value"]);
  });
});

import { describe, expect, it } from "vitest";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toOpenAITools } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

function makeProjectWithAdjacentClips() {
  const project = makeProjectWithClip();
  const track = project.timeline.tracks[0];
  const first = track.clips[0];
  (track.clips as unknown as Array<typeof first>).push({
    ...structuredClone(first),
    id: "c2",
    startTime: 5,
  });
  (project.timeline as { duration: number }).duration = 10;
  return project;
}

describe("main-timeline agent tools", () => {
  it("publishes actionable schemas for transform, keyframes, and audio effects", () => {
    const schemas = toOpenAITools([
      "set_clip_transform",
      "add_keyframe",
      "set_clip_keyframes",
      "add_audio_effect",
    ]);

    expect(schemas).toHaveLength(4);
    expect(JSON.stringify(schemas)).toContain("position.x");
    expect(JSON.stringify(schemas)).toContain("scale.x");
    expect(JSON.stringify(schemas)).toContain("noiseReduction");
    expect(
      ((getTool("add_keyframe")?.inputSchema.required ?? []) as string[]),
    ).toContain("value");
  });

  it("edits transform, speed, effects, audio, and keyframe animation on an existing clip", async () => {
    const host = new HeadlessHost(makeProjectWithClip());

    const results = await Promise.all([
      executeTool("set_clip_transform", {
        clipId: "c1",
        transform: { position: { x: 24 }, scale: { x: 1.2, y: 1.2 } },
      }, host),
      executeTool("set_clip_speed", { clipId: "c1", speed: 1.25 }, host),
      executeTool("add_video_effect", {
        clipId: "c1",
        effectType: "contrast",
        params: { value: 12 },
      }, host),
      executeTool("set_clip_volume", { clipId: "c1", volume: 0.75 }, host),
      executeTool("set_clip_fade", {
        clipId: "c1",
        fadeIn: 0.2,
        fadeOut: 0.3,
      }, host),
      executeTool("add_audio_effect", {
        clipId: "c1",
        effectType: "compressor",
        params: { threshold: -18 },
      }, host),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);

    const keyframes = await executeTool("set_clip_keyframes", {
      clipId: "c1",
      keyframes: [
        { time: 0, property: "scale.x", value: 1, easing: "ease-in-out" },
        { time: 2, property: "scale.x", value: 1.35, easing: "ease-in-out" },
        { time: 0, property: "scale.y", value: 1, easing: "ease-in-out" },
        { time: 2, property: "scale.y", value: 1.35, easing: "ease-in-out" },
      ],
    }, host);
    expect(keyframes.ok).toBe(true);

    const clip = host.getProject().timeline.tracks[0].clips[0];
    expect(clip.transform.position).toEqual({ x: 24, y: 0 });
    expect(clip.transform.scale).toEqual({ x: 1.2, y: 1.2 });
    expect(clip.speed).toBe(1.25);
    expect(clip.effects.some((effect) => effect.type === "contrast")).toBe(true);
    expect(clip.volume).toBe(0.75);
    expect(clip.fade).toEqual({ fadeIn: 0.2, fadeOut: 0.3 });
    expect(clip.audioEffects?.some((effect) => effect.type === "compressor")).toBe(true);
    expect(clip.keyframes).toHaveLength(4);
    expect(clip.keyframes.every((keyframe) => Boolean(keyframe.id))).toBe(true);
  });

  it("adds a transition and can trim and split existing timeline clips", async () => {
    const transitionHost = new HeadlessHost(makeProjectWithAdjacentClips());
    const transition = await executeTool("add_transition", {
      clipAId: "c1",
      clipBId: "c2",
      transitionType: "whipPan",
      duration: 0.4,
    }, transitionHost);
    expect(transition.ok).toBe(true);
    expect(transitionHost.getProject().timeline.tracks[0].transitions).toHaveLength(1);

    const trimHost = new HeadlessHost(makeProjectWithClip());
    const trim = await executeTool("trim_clip", {
      clipId: "c1",
      inPoint: 0.5,
      outPoint: 4.5,
    }, trimHost);
    expect(trim.ok).toBe(true);
    expect(trimHost.getProject().timeline.tracks[0].clips[0].duration).toBe(4);

    const split = await executeTool("split_clip", {
      clipId: "c1",
      time: 2,
    }, trimHost);
    expect(split.ok).toBe(true);
    expect(trimHost.getProject().timeline.tracks[0].clips).toHaveLength(2);
  });
});

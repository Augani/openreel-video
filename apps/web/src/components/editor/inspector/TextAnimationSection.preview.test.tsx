import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TEXT_ANIMATION_PRESETS, type TextClip } from "@openreel/core";
import { selectOption } from "../../../test/select-option";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { TextAnimationSection } from "./TextAnimationSection";

const CLIP_ID = "animated-title";

function textClip(): TextClip {
  return {
    id: CLIP_ID,
    trackId: "title-track",
    startTime: 0,
    duration: 5,
    text: "OpenReel",
    style: {
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.5 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
  };
}

describe("TextAnimationSection previews", () => {
  beforeEach(() => {
    const clip = textClip();
    useEngineStore.getState().getTitleEngine()?.loadTextClips([clip]);
    useProjectStore.getState().loadProject({
        ...createEmptyProject("Text animation previews"),
        timeline: { tracks: [{ id: "title-track", name: "Titles", type: "text", clips: [], transitions: [], hidden: false, locked: false, muted: false, solo: false }],
          duration: 5, subtitles: [], markers: [] },
        textClips: [clip],
    });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("keeps entry and exit parameter forms separate and preserves real Undo", async () => {
    render(<TextAnimationSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview and apply Rise" }));
    const entry = structuredClone(useProjectStore.getState().getTextClip(CLIP_ID)!.animation!);
    fireEvent.click(screen.getByRole("radio", { name: "Exit" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview and apply Fade In" }));
    const current = () => useProjectStore.getState().getTextClip(CLIP_ID)!.animation!;
    expect(current()).toMatchObject({ preset: "rise", params: entry.params, out: { preset: "fade" } });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Start Opacity" }), { key: "ArrowRight" });
    expect(current().out?.params.fadeOpacity?.start).toBeCloseTo(0.1);
    expect(current().params).toEqual(entry.params);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current().out?.preset).toBe("fade");
    expect(current().out?.params.fadeOpacity?.start).toBe(0);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(entry);
    fireEvent.click(screen.getByRole("radio", { name: "Entry" }));
    expect(screen.getByRole("button", { name: "Preview and apply Rise" })).toHaveAttribute("aria-pressed", "true");
  });

  // One test per preset (not one loop over all of them): every choice opens the full Radix
  // listbox and runs a real Undo, so a single looped test took seconds of wall clock and timed
  // out whenever the machine was busy. Each case is independent and bounded on its own.
  const PRESETS = TEXT_ANIMATION_PRESETS.filter(item => item.id !== "none");
  it.each(PRESETS.map(preset => [preset.name, preset.id] as const))(
    "retains the material and complete clip data when choosing the %s preset from the menu and undoing",
    async (name, id) => {
      useProjectStore.getState().updateTextStyle(CLIP_ID, {
        shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee44aa" }, progress: .37 },
      });
      const before = structuredClone(useProjectStore.getState().getTextClip(CLIP_ID)!);
      render(<TextAnimationSection clipId={CLIP_ID} />);
      await selectOption(screen.getByRole("combobox", { name: "Animation Preset" }), name);
      const current = useProjectStore.getState().getTextClip(CLIP_ID)!;
      expect(current.animation?.preset).toBe(id);
      expect({ ...current, animation: before.animation }).toEqual({ ...before, animation: before.animation });
      await act(async () => { await useProjectStore.getState().undo(); });
      expect(useProjectStore.getState().getTextClip(CLIP_ID)).toEqual(before);
    },
  );
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TitleEngine } from "@openreel/core";
import { PrimaryTextProperties } from "./PrimaryTextProperties";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { selectOption } from "../../../test/select-option";

afterEach(cleanup);
describe("primary text properties", () => {
  it("preserves text color alpha and the shader while editing its RGB value", async () => {
    useEngineStore.setState({ titleEngine: new TitleEngine() });
    useProjectStore.getState().createNewProject("Text alpha preservation");
    const track = useProjectStore.getState().project.timeline.tracks.find((row) => row.type === "text")!;
    const shader = { shaderId: "paper-mesh-gradient", params: { color1: "#ee55aa" } };
    const clip = useProjectStore.getState().createTextClip(track.id, 0, "Translucent title", 4, {
      color: "rgba(102, 136, 255, 0.4)", shader,
    })!;
    useProjectStore.getState().actionHistory.clear();
    render(<PrimaryTextProperties clipId={clip.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Text color" }));
    expect(screen.getByRole("slider", { name: "Text color opacity" })).toHaveAttribute("aria-valuenow", "0.4");
    fireEvent.change(screen.getByLabelText("Text color color"), { target: { value: "#4477aa" } });
    expect(useProjectStore.getState().getTextClip(clip.id)?.style).toMatchObject({
      color: "rgba(68, 119, 170, 0.4)", shader,
    });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getTextClip(clip.id)).toEqual(clip);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
  it("edits exit preset and duration independently through the primary popover with separate Undos", async () => {
    useEngineStore.setState({ titleEngine: new TitleEngine() });
    useProjectStore.getState().createNewProject("Independent text animations");
    const track = useProjectStore.getState().project.timeline.tracks.find(candidate => candidate.type === "text")!;
    const clip = useProjectStore.getState().createTextClip(track.id, 0, "Golden Hour", 4)!;
    const legacy = { preset: "rise" as const, inDuration: 0.6, outDuration: 0.4,
      params: { slideDistance: 42, easing: "linear" as const } };
    useProjectStore.getState().updateTextAnimation(clip.id, legacy);
    useProjectStore.getState().actionHistory.clear();
    render(<PrimaryTextProperties clipId={clip.id} />);
    fireEvent.click(screen.getByRole("button", { name: /^Out · Rise/ }));
    await selectOption(screen.getByRole("combobox", { name: "Exit animation preset" }), "Fade");
    expect(useProjectStore.getState().getTextClip(clip.id)?.animation).toMatchObject({
      ...legacy, out: { preset: "fade" },
    });
    const duration = screen.getByRole("spinbutton", { name: "Exit animation duration" });
    fireEvent.focus(duration);
    fireEvent.change(duration, { target: { value: "0.7" } });
    fireEvent.blur(duration);
    expect(useProjectStore.getState().getTextClip(clip.id)?.animation).toMatchObject({
      preset: "rise", inDuration: 0.6, outDuration: 0.7, params: legacy.params, out: { preset: "fade" },
    });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getTextClip(clip.id)?.animation?.outDuration).toBe(0.4);
    expect(useProjectStore.getState().getTextClip(clip.id)?.animation?.out?.preset).toBe("fade");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getTextClip(clip.id)?.animation).toEqual(legacy);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
  it("preserves precise values and project history when tabbing through rounded fields", () => {
    useEngineStore.setState({ titleEngine: new TitleEngine() });
    useProjectStore.getState().createNewProject("Precision QA");
    const track = useProjectStore.getState().project.timeline.tracks.find((candidate) => candidate.type === "text")!;
    const clip = useProjectStore.getState().createTextClip(track.id, 0, "Precise tracking", 4, { fontSize: 96, letterSpacing: -1 })!;
    render(<PrimaryTextProperties clipId={clip.id}/>);
    const before = useProjectStore.getState().project;
    const tracking = screen.getByRole("spinbutton", { name: "Letter spacing value" });
    expect(tracking).toHaveValue(-1);
    for (const name of ["Font size", "Letter spacing value", "Line height value"]) {
      const input = screen.getByRole("spinbutton", { name });
      fireEvent.focus(input);
      if (name === "Letter spacing value") expect(Number((input as HTMLInputElement).value)).toBeCloseTo(-100 / 96, 12);
      fireEvent.blur(input);
    }
    fireEvent.focus(tracking);
    fireEvent.change(tracking, { target: { value: "-20" } });
    fireEvent.keyDown(tracking, { key: "Escape" });
    fireEvent.blur(tracking);
    expect(tracking).toHaveValue(-1);
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectStore.getState().getTextClip(clip.id)?.style.letterSpacing).toBe(-1);
  });
});

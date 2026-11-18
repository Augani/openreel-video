import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  apply: vi.fn(async () => [] as unknown[]),
  clear: vi.fn(async () => [] as string[]),
}));

vi.mock("../../../services/essential-sound", async () => {
  const actual = await vi.importActual<typeof import("../../../services/essential-sound")>("../../../services/essential-sound");
  return { ...actual, applyEssentialSound: hoisted.apply, clearEssentialSound: hoisted.clear };
});

import { ProjectSerializer } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { EssentialSoundSection } from "./EssentialSoundSection";

const fixture = readFileSync(join(__dirname, "..", "..", "..", "test", "fixtures", "compat", "w8-audio-repair.openreel.json"), "utf8");
const serializer = new ProjectSerializer({} as never);

describe("EssentialSoundSection", () => {
  beforeEach(() => {
    hoisted.apply.mockClear();
    hoisted.clear.mockClear();
    useProjectStore.getState().loadProject(serializer.importFromJson(fixture));
  });
  afterEach(cleanup);

  it("shows four type buttons and tags the clip when one is clicked", async () => {
    render(<EssentialSoundSection clipIds={["clip-3"]} />);
    for (const label of ["Dialogue", "Music", "SFX", "Ambience"]) {
      expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    }
    expect(screen.queryByTestId("essential-group-loudness")).toBeNull();
    fireEvent.click(screen.getByTestId("essential-type-music"));
    await waitFor(() => expect(hoisted.apply).toHaveBeenCalledWith(["clip-3"], "music", {}, expect.anything()));
  });

  it("infers the type from the track role and offers Auto-Match, repair, clarity and ducking groups", async () => {
    render(<EssentialSoundSection clipIds={["clip-tone"]} />);
    expect(screen.getByTestId("essential-type-music").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("essential-hint").textContent).toMatch(/Inferred from the track role/);
    expect(screen.getByTestId("essential-group-ducking")).toBeTruthy();
    expect(screen.getByText("Target −23.0 LUFS")).toBeTruthy();
    fireEvent.click(screen.getByTestId("essential-auto-match"));
    await waitFor(() => expect(hoisted.apply).toHaveBeenCalledWith(["clip-tone"], "music", { loudness: true }, expect.objectContaining({ rematch: true })));
  });

  it("applies to every selected clip at once", async () => {
    render(<EssentialSoundSection clipIds={["clip-tone", "clip-3"]} />);
    expect(screen.getByTestId("essential-sound-multi").textContent).toMatch(/all 2 selected clips/);
    fireEvent.click(screen.getByTestId("essential-type-sfx"));
    await waitFor(() => expect(hoisted.apply).toHaveBeenCalledWith(["clip-tone", "clip-3"], "sfx", {}, expect.anything()));
  });

  it("shows the measured before and after loudness and a Clear button once a clip is processed", () => {
    render(<EssentialSoundSection clipIds={["clip-tone"]} />);
    expect(screen.queryByTestId("essential-clear")).toBeNull();
    act(() => {
      const tone = useProjectStore.getState().getClip("clip-tone")!;
      const track = useProjectStore.getState().project.timeline.tracks.find((t) => t.id === tone.trackId)!;
      (track.clips as unknown as Array<Record<string, unknown>>)[0] = {
        ...tone,
        audioType: "music",
        metadata: {
          essentialSound: {
            options: { loudness: true, repair: false, clarity: true, ducking: false, reduceNoise: true, reduceRumble: true, clarityAmount: 0.5, duckAmountDb: 12, duckFadeMs: 300, dialogueTargetLufs: -16 },
            loudness: { targetLufs: -23, beforeLufs: -31.2, afterLufs: -23, clamped: false, previousVolume: 0.8, appliedVolume: 2 },
          },
        },
      };
      useProjectStore.setState({ project: { ...useProjectStore.getState().project } });
    });
    expect(screen.getByTestId("essential-loudness-readout").textContent).toBe("−31.2 → −23.0 LUFS");
    fireEvent.click(screen.getByTestId("essential-clear"));
    return waitFor(() => expect(hoisted.clear).toHaveBeenCalledWith(["clip-tone"]));
  });

  it("hides ducking for dialogue and hides the repair group for non-dialogue clips", () => {
    render(<EssentialSoundSection clipIds={["clip-tone"]} />);
    expect(screen.queryByTestId("essential-group-repair")).toBeNull();
    cleanup();
    act(() => {
      const tone = useProjectStore.getState().getClip("clip-tone")!;
      const track = useProjectStore.getState().project.timeline.tracks.find((t) => t.id === tone.trackId)!;
      (track.clips as unknown as Array<Record<string, unknown>>)[0] = { ...tone, audioType: "dialogue" };
      useProjectStore.setState({ project: { ...useProjectStore.getState().project } });
    });
    render(<EssentialSoundSection clipIds={["clip-tone"]} />);
    expect(screen.queryByTestId("essential-group-ducking")).toBeNull();
    expect(screen.getByLabelText("Reduce noise")).toBeTruthy();
  });

  it("reports a locked track and disables the buttons", () => {
    act(() => {
      const tone = useProjectStore.getState().getClip("clip-tone")!;
      const track = useProjectStore.getState().project.timeline.tracks.find((t) => t.id === tone.trackId)! as { locked: boolean };
      track.locked = true;
      useProjectStore.setState({ project: { ...useProjectStore.getState().project } });
    });
    render(<EssentialSoundSection clipIds={["clip-tone"]} />);
    expect(screen.getByTestId("essential-locked").textContent).toMatch(/is locked/);
    expect((screen.getByTestId("essential-type-music") as HTMLButtonElement).disabled).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const openEditorProject = vi.hoisted(() => vi.fn<[], Promise<boolean>>());
const openTimelineImport = vi.hoisted(() => vi.fn());

vi.mock("../../../services/project-replacement", () => ({ openEditorProject }));
vi.mock("../../../services/timeline-interchange", async () => {
  const { create } = await import("zustand");
  const useTimelineImportStore = create<{ preview: unknown; setPreview: (p: unknown) => void }>((set) => ({
    preview: null,
    setPreview: (preview) => set({ preview }),
  }));
  return { openTimelineImport, useTimelineImportStore };
});

import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";
import { resetWorkspaceApplyForTests } from "../../../services/workspace-apply";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { useWorkspaceLayoutStore } from "../../../stores/workspace-layout-store";
import { useTimelineImportStore } from "../../../services/timeline-interchange";
import { ProRow } from "./ProRow";

beforeEach(() => {
  localStorage.clear();
  keyboardShortcuts.resetAllShortcuts();
  resetWorkspaceApplyForTests();
  useOnboardingStore.getState().reset();
  openEditorProject.mockReset();
  openTimelineImport.mockReset();
  (useTimelineImportStore as unknown as { setState: (s: object) => void }).setState({ preview: null });
});
afterEach(() => cleanup());

const caption = () => screen.getByTestId("pro-keymap-caption").textContent ?? "";

describe("ProRow keys", () => {
  it("clicking a preset chip calls applyPreset and records the keymap", () => {
    const apply = vi.spyOn(keyboardShortcuts, "applyPreset");
    render(<ProRow onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Premiere keys" }));
    expect(apply).toHaveBeenCalledWith("premiere");
    expect(keyboardShortcuts.getActivePreset()).toBe("premiere");
    expect(localStorage.getItem("openreel_shortcut_preset")).toBe("premiere");
    expect(useOnboardingStore.getState().keymap).toBe("premiere");
    expect(useOnboardingStore.getState().persona).toBe("pro");
    apply.mockRestore();
  });

  it("the caption is the live diff count and never names a preset without a count", () => {
    render(<ProRow onOpenEditor={vi.fn()} />);
    expect(caption()).toBe("OpenReel defaults. No keys are remapped.");
    fireEvent.click(screen.getByRole("radio", { name: "Premiere keys" }));
    const expected = keyboardShortcuts.presetDiff("premiere")!.count;
    expect(expected).toBeGreaterThan(0);
    expect(caption()).toContain(`Premiere-style: ${expected} keys changed.`);
    expect(caption()).toMatch(/Search moves to .*P\./);
    for (const id of ["davinci", "finalcut", "capcut"]) {
      const label = { davinci: "Resolve", finalcut: "Final Cut", capcut: "CapCut" }[id]!;
      fireEvent.click(screen.getByRole("radio", { name: `${label} keys` }));
      const text = caption();
      expect(text).toMatch(/\d+ keys? changed/);
      expect(text).not.toMatch(/Search moves/);
    }
    expect(document.body.textContent).not.toMatch(/Premiere keys(?! changed)/);
  });

  it("'See all' lists each change", () => {
    render(<ProRow onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Premiere keys" }));
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(screen.getByText("Blade Tool")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBe(keyboardShortcuts.presetDiff("premiere")!.count);
  });

  it("starts on the preset that is already active", () => {
    keyboardShortcuts.applyPreset("finalcut");
    render(<ProRow onOpenEditor={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Final Cut keys" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("ProRow workspace", () => {
  it("stores the workspace choice for the first editor mount without applying it yet", () => {
    const applySpy = vi.spyOn(useWorkspaceLayoutStore.getState(), "applyWorkspace");
    render(<ProRow onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Color workspace" }));
    expect(useOnboardingStore.getState().workspace).toBe("color");
    expect(applySpy).not.toHaveBeenCalled();
  });
});

describe("ProRow actions", () => {
  it("opens a project through the native picker, then the editor", async () => {
    openEditorProject.mockResolvedValue(true);
    const onOpenEditor = vi.fn();
    render(<ProRow onOpenEditor={onOpenEditor} />);
    fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
    await waitFor(() => expect(onOpenEditor).toHaveBeenCalledTimes(1));
    expect(openEditorProject).toHaveBeenCalledTimes(1);
    expect(useOnboardingStore.getState().status).toBe("done");
  });

  it("stays on the welcome screen when the picker is canceled", async () => {
    openEditorProject.mockResolvedValue(false);
    const onOpenEditor = vi.fn();
    render(<ProRow onOpenEditor={onOpenEditor} />);
    fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
    await waitFor(() => expect(openEditorProject).toHaveBeenCalled());
    await act(async () => undefined);
    expect(onOpenEditor).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().status).not.toBe("done");
  });

  it("shows an error and keeps going when open fails", async () => {
    openEditorProject.mockRejectedValue(new Error("Bad file"));
    render(<ProRow onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Bad file");
  });

  it("import timeline opens the picker and goes to the editor once a preview exists", () => {
    const onOpenEditor = vi.fn();
    render(<ProRow onOpenEditor={onOpenEditor} />);
    const importButton = screen.getByRole("button", { name: /Import timeline/ });
    expect(importButton.textContent).toContain("XML, AAF, FCPXML, OTIO");
    expect(document.body.textContent).not.toMatch(/prproj/i);
    fireEvent.click(importButton);
    expect(openTimelineImport).toHaveBeenCalledWith("xml");
    expect(onOpenEditor).not.toHaveBeenCalled();
    act(() => {
      (useTimelineImportStore as unknown as { setState: (s: object) => void }).setState({ preview: { filename: "a.xml" } });
    });
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });

  it("Custom sequence opens the sheet through the onboarding store", () => {
    render(<ProRow onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Custom sequence/ }));
    expect(useOnboardingStore.getState().openSheet).toBe("custom-sequence");
  });
});

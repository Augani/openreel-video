import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";

const { runStillExport, downloadBlob } = vi.hoisted(() => ({
  runStillExport: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock("../../services/still-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/still-export")>();
  return { ...actual, runStillExport, cancelStillExport: vi.fn() };
});
vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return { ...actual, downloadBlob };
});

import { ExportStillPanel } from "./ExportStillPanel";

beforeEach(() => {
  const project = createEmptyProject("Stills");
  useProjectStore.setState({
    project: { ...project, settings: { ...project.settings, width: 1920, height: 1080, frameRate: 24 }, timeline: { ...project.timeline, duration: 2 } },
  });
  runStillExport.mockReset();
  downloadBlob.mockReset();
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
});

describe("ExportStillPanel", () => {
  it("exports an image sequence with the chosen format, pattern, start number and range", async () => {
    runStillExport.mockResolvedValue({ ok: true, output: { blob: new Blob(["z"]), ext: "zip", contentType: "application/zip", frames: 12 } });
    const onDone = vi.fn();
    render(<ExportStillPanel range={{ startTime: 0.5, endTime: 1 }} onDone={onDone} />);
    fireEvent.change(screen.getByTestId("still-format"), { target: { value: "jpg" } });
    fireEvent.change(screen.getByTestId("still-quality"), { target: { value: "80" } });
    fireEvent.change(screen.getByTestId("still-pattern"), { target: { value: "shot_{000}" } });
    fireEvent.change(screen.getByTestId("still-start-number"), { target: { value: "100" } });
    expect(screen.getByTestId("still-summary").textContent).toContain("12 frames, e.g. shot_112.jpg");
    fireEvent.click(screen.getByTestId("still-export"));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(runStillExport.mock.calls[0][1]).toEqual({
      kind: "sequence",
      format: "jpg",
      quality: 80,
      pattern: "shot_{000}",
      startNumber: 100,
      range: { startTime: 0.5, endTime: 1 },
    });
    expect(downloadBlob.mock.calls[0][1]).toBe("Stills-jpg-sequence.zip");
    expect(onDone).toHaveBeenCalled();
  });

  it("exports a GIF with fps, palette and loop options", async () => {
    runStillExport.mockResolvedValue({ ok: true, output: { blob: new Blob(["g"]), ext: "gif", contentType: "image/gif", frames: 30 } });
    render(<ExportStillPanel />);
    fireEvent.click(screen.getByTestId("still-mode-gif"));
    fireEvent.change(screen.getByTestId("still-fps"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("still-colors"), { target: { value: "64" } });
    fireEvent.change(screen.getByTestId("still-loop"), { target: { value: "once" } });
    fireEvent.click(screen.getByTestId("still-export"));
    await waitFor(() => expect(runStillExport).toHaveBeenCalled());
    expect(runStillExport.mock.calls[0][1]).toMatchObject({ kind: "gif", fps: 10, maxColors: 64, loop: "none", width: 640, height: 360 });
    await waitFor(() => expect(downloadBlob.mock.calls[0][1]).toBe("Stills.gif"));
  });

  it("blocks invalid settings and shows engine failures", async () => {
    runStillExport.mockResolvedValue({ ok: false, message: "That GIF is too large to build in memory." });
    render(<ExportStillPanel />);
    fireEvent.change(screen.getByTestId("still-pattern"), { target: { value: " " } });
    expect(screen.getByTestId("still-error").textContent).toMatch(/pattern/);
    expect((screen.getByTestId("still-export") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("still-pattern"), { target: { value: "f_{00}" } });
    fireEvent.click(screen.getByTestId("still-export"));
    await waitFor(() => expect(screen.getByTestId("still-message").textContent).toMatch(/too large/));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("refuses a GIF over the frame limit before rendering", () => {
    render(<ExportStillPanel />);
    fireEvent.click(screen.getByTestId("still-mode-gif"));
    fireEvent.change(screen.getByTestId("still-fps"), { target: { value: "60" } });
    expect(screen.getByTestId("still-error").textContent).toMatch(/frame rate/i);
    expect(runStillExport).not.toHaveBeenCalled();
  });
});

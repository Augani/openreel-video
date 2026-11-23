import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProxyPresetsDialog } from "./ProxyPresetsDialog";
import { useIngestPresetsStore, readStoredPresets } from "../../services/ingest-presets-store";

beforeEach(() => {
  localStorage.clear();
  useIngestPresetsStore.setState({ presets: [] });
});
afterEach(cleanup);

const open = () => render(<ProxyPresetsDialog open onOpenChange={() => undefined} />);

describe("ProxyPresetsDialog", () => {
  it("lists the built-ins read-only: no rename, no save, no delete", () => {
    open();
    expect(screen.getByTestId("preset-row-prores-proxy")).toBeTruthy();
    expect(screen.getByTestId("preset-row-dnxhr-sq")).toBeTruthy();
    expect((screen.getByLabelText("Preset name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("preset-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/cannot be changed/i)).toBeTruthy();
  });
  it("duplicates a built-in into an editable preset, edits and saves it to app settings, then deletes it", () => {
    open();
    fireEvent.click(screen.getByTestId("preset-row-prores-proxy"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    const rows = screen.getAllByRole("button").filter((b) => /^ProRes Proxy copy/.test(b.textContent ?? ""));
    expect(rows).toHaveLength(1);
    const name = screen.getByLabelText("Preset name") as HTMLInputElement;
    expect(name.disabled).toBe(false);
    fireEvent.change(name, { target: { value: "Dailies" } });
    fireEvent.click(screen.getByLabelText("Burn in timecode"));
    fireEvent.click(screen.getByLabelText("Burn in clip name"));
    expect(within(screen.getByTestId("preset-editor")).getByTestId("preset-summary").textContent).toMatch(/burn-in/);
    fireEvent.click(screen.getByTestId("preset-save"));
    expect(screen.getByTestId("preset-message").textContent).toBe("Saved.");
    expect(readStoredPresets()).toMatchObject([{ name: "Dailies", profile: { codec: "prores-proxy", size: "half", burnIn: { clipName: true, timecode: true } } }]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(readStoredPresets()).toEqual([]);
  });
  it("creates a new preset and refuses a name that is already taken, with the reason", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    expect(readStoredPresets().map((p) => p.name)).toEqual(["My preset 1"]);
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "h.264 1/2 resolution" } });
    fireEvent.click(screen.getByTestId("preset-save"));
    expect(screen.getByTestId("preset-message").textContent).toMatch(/already exists/);
    expect(readStoredPresets().map((p) => p.name)).toEqual(["My preset 1"]);
  });
});

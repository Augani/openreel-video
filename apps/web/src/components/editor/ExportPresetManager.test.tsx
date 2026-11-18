import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExportPresetsManager,
  exportPresetsManager,
  type PlatformExportPreset,
} from "../../services/export-presets";
import { ExportPresetManager } from "./ExportPresetManager";

const SETTINGS = {
  format: "mp4",
  codec: "h264",
  width: 1280,
  height: 720,
  frameRate: 24,
  bitrate: 8000,
  bitrateMode: "vbr",
  quality: 80,
  keyframeInterval: 48,
} as PlatformExportPreset["settings"];

const base = {
  description: "",
  platform: "Custom",
  category: "custom",
  settings: SETTINGS,
} as const;

function clearCustom() {
  for (const p of exportPresetsManager.getCustomPresets()) {
    exportPresetsManager.deleteCustomPreset(p.id);
  }
}

describe("ExportPresetsManager JSON", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips custom presets with fresh ids and skips invalid entries", () => {
    const a = new ExportPresetsManager();
    a.addCustomPreset({ ...base, name: "Mine" });
    const json = a.exportCustomPresets();
    const b = new ExportPresetsManager();
    b.getCustomPresets().forEach((p) => b.deleteCustomPreset(p.id));
    const withBad = JSON.stringify({
      presets: [...JSON.parse(json).presets, { name: "", settings: {} }, 5],
    });
    const result = b.importCustomPresets(withBad);
    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toBe(2);
    expect(result.imported[0].name).toBe("Mine");
    expect(result.imported[0].id.startsWith("custom-")).toBe(true);
  });

  it("rejects non-JSON and files without presets", () => {
    const m = new ExportPresetsManager();
    expect(() => m.importCustomPresets("nope")).toThrow(/valid JSON/);
    expect(() => m.importCustomPresets('{"a":1}')).toThrow(/does not contain/);
  });

  it("renames and persists", () => {
    const m = new ExportPresetsManager();
    const p = m.addCustomPreset({ ...base, name: "A" });
    expect(m.renameCustomPreset(p.id, "  B ")).toBe(true);
    expect(m.renameCustomPreset(p.id, "   ")).toBe(false);
    expect(new ExportPresetsManager().getPreset(p.id)?.name).toBe("B");
  });
});

describe("export preset validation", () => {
  beforeEach(() => localStorage.clear());

  const importOne = (settings: unknown) =>
    new ExportPresetsManager().importCustomPresets(
      JSON.stringify({ presets: [{ name: "P", settings }] }),
    );

  it.each([
    ["missing bitrate", { ...SETTINGS, bitrate: undefined }],
    ["missing frameRate", { ...SETTINGS, frameRate: undefined }],
    ["zero width", { ...SETTINGS, width: 0 }],
    ["negative height", { ...SETTINGS, height: -5 }],
    ["unknown codec", { ...SETTINGS, codec: "nope" }],
    ["unknown format", { ...SETTINGS, format: "avi" }],
    ["NaN-ish bitrate", { ...SETTINGS, bitrate: "8000" }],
    ["bad bitrateMode", { ...SETTINGS, bitrateMode: "abr" }],
    ["bad audioSettings", { ...SETTINGS, audioSettings: { format: "x" } }],
  ])("skips %s", (_label, settings) => {
    const result = importOne(settings);
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  const PRORES = {
    ...SETTINGS,
    format: "mov",
    codec: "prores",
    proresProfile: "hq",
    bitrate: 880000,
    bitrateMode: "cbr",
    audioSettings: {
      format: "wav",
      sampleRate: 48000,
      bitDepth: 24,
      bitrate: 0,
      channels: 2,
    },
  } as unknown as PlatformExportPreset["settings"];

  it("saves, exports, imports and reloads a ProRes + WAV (bitrate 0) preset", () => {
    const m = new ExportPresetsManager();
    m.addCustomPreset({ ...base, name: "Pro", settings: PRORES });
    expect(new ExportPresetsManager().getCustomPresets()).toHaveLength(1);
    const json = m.exportCustomPresets();
    localStorage.clear();
    const imported = new ExportPresetsManager().importCustomPresets(json);
    expect(imported.imported).toHaveLength(1);
    expect(imported.skipped).toBe(0);
    const reloaded = new ExportPresetsManager().getCustomPresets();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].settings).toMatchObject({
      audioSettings: { bitrate: 0, format: "wav" },
    });
  });

  it("still rejects negative audio bitrate", () => {
    const result = importOne({
      ...PRORES,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: -1,
        channels: 2,
      },
    });
    expect(result.skipped).toBe(1);
  });

  it("accepts full settings and fills a default audioSettings", () => {
    const result = importOne(SETTINGS);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].settings).toMatchObject({
      audioSettings: { sampleRate: 48000 },
    });
  });

  it("does not duplicate on repeated import of the same file", () => {
    const m = new ExportPresetsManager();
    const json = JSON.stringify({ presets: [{ name: "P", settings: SETTINGS }] });
    m.importCustomPresets(json);
    const again = m.importCustomPresets(json);
    expect(again.imported).toHaveLength(0);
    expect(again.duplicates).toBe(1);
    expect(m.getCustomPresets()).toHaveLength(1);
  });

  it("drops invalid stored presets on load and keeps valid ones", () => {
    localStorage.setItem(
      "openreel-custom-export-presets",
      JSON.stringify([
        { id: "custom-1-1", name: "Good", settings: SETTINGS },
        { id: "custom-2-2", name: "Bad", settings: { ...SETTINGS, width: 0 } },
        { id: "other", name: "NoPrefix", settings: SETTINGS },
        7,
      ]),
    );
    expect(new ExportPresetsManager().getCustomPresets().map((p) => p.name)).toEqual(["Good"]);
  });

  it("gives unique ids to presets added in the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const m = new ExportPresetsManager();
    const a = m.addCustomPreset({ ...base, name: "A" });
    const b = m.addCustomPreset({ ...base, name: "B" });
    vi.restoreAllMocks();
    expect(a.id).not.toBe(b.id);
  });

  it("survives a reload", () => {
    new ExportPresetsManager().addCustomPreset({ ...base, name: "Keep" });
    expect(new ExportPresetsManager().getCustomPresets()[0].name).toBe("Keep");
  });
});

describe("ExportPresetManager component", () => {
  beforeEach(() => {
    localStorage.clear();
    clearCustom();
  });
  afterEach(() => {
    cleanup();
    clearCustom();
  });

  it("saves the current settings under a name and selects the new preset", () => {
    const onSelect = vi.fn();
    render(
      <ExportPresetManager
        currentSettings={SETTINGS}
        selectedPreset={null}
        onSelect={onSelect}
      />,
    );
    const save = screen.getByRole("button", { name: "Save current settings" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("New preset name"), {
      target: { value: "Client review" },
    });
    fireEvent.click(save);
    const saved = exportPresetsManager.getCustomPresets();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Client review");
    expect(saved[0].settings).toEqual(SETTINGS);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: saved[0].id }),
    );
    expect(
      exportPresetsManager.getAllPresets().some((p) => p.name === "Client review"),
    ).toBe(true);
  });

  it("renames and deletes the selected custom preset", () => {
    const preset = exportPresetsManager.addCustomPreset({ ...base, name: "Old" });
    const onDeleted = vi.fn();
    render(
      <ExportPresetManager
        currentSettings={SETTINGS}
        selectedPreset={preset}
        onSelect={() => undefined}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Rename preset"), {
      target: { value: "New" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply name" }));
    expect(exportPresetsManager.getPreset(preset.id)?.name).toBe("New");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(exportPresetsManager.getPreset(preset.id)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Keep preset" }));
    expect(exportPresetsManager.getPreset(preset.id)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(exportPresetsManager.getPreset(preset.id)).toBeUndefined();
    expect(onDeleted).toHaveBeenCalledWith(preset.id);
  });

  it("hides rename and delete for built-in presets", () => {
    const builtIn = exportPresetsManager.getAllPresets()[0];
    render(
      <ExportPresetManager
        currentSettings={SETTINGS}
        selectedPreset={builtIn}
        onSelect={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("disables save when the current settings are incomplete", () => {
    render(
      <ExportPresetManager
        currentSettings={{ ...SETTINGS, bitrate: NaN } as PlatformExportPreset["settings"]}
        selectedPreset={null}
        onSelect={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("New preset name"), {
      target: { value: "X" },
    });
    expect(
      (screen.getByRole("button", { name: "Save current settings" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("enables save for a built-in ProRes preset's settings", () => {
    const prores = exportPresetsManager
      .getAllPresets()
      .find((p) => "codec" in p.settings && p.settings.codec === "prores");
    expect(prores).toBeDefined();
    render(
      <ExportPresetManager
        currentSettings={prores!.settings}
        selectedPreset={prores!}
        onSelect={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("New preset name"), {
      target: { value: "My ProRes" },
    });
    expect(
      (screen.getByRole("button", { name: "Save current settings" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("save variant shows only the save row", () => {
    render(
      <ExportPresetManager
        variant="save"
        currentSettings={SETTINGS}
        selectedPreset={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByLabelText("New preset name")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Import presets" })).toBeNull();
  });

  it("rejects oversized import files", async () => {
    render(
      <ExportPresetManager
        currentSettings={SETTINGS}
        selectedPreset={null}
        onSelect={() => undefined}
      />,
    );
    const big = new File(["x"], "big.json");
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Import presets file"), {
        target: { files: [big] },
      });
    });
    expect(screen.getByRole("status").textContent).toMatch(/too large/);
  });

  it("exports presets as a JSON download", () => {
    exportPresetsManager.addCustomPreset({ ...base, name: "X" });
    const create = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(
      <ExportPresetManager
        currentSettings={SETTINGS}
        selectedPreset={null}
        onSelect={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export presets" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/Exported 1 preset\./);
    click.mockRestore();
  });

  it("imports presets from a file and reports bad files", async () => {
    const onSelect = vi.fn();
    render(
      <ExportPresetManager
        currentSettings={SETTINGS}
        selectedPreset={null}
        onSelect={onSelect}
      />,
    );
    const input = screen.getByLabelText("Import presets file");
    const withText = (f: File, body: string): File => Object.assign(f, { text: async () => body });
    const goodBody = JSON.stringify({ presets: [{ name: "Imp", settings: SETTINGS }, { name: "bad" }] });
    const good = new File(
      [JSON.stringify({ presets: [{ name: "Imp", settings: SETTINGS }, { name: "bad" }] })],
      "p.json",
      { type: "application/json" },
    );
    await act(async () => {
      fireEvent.change(input, { target: { files: [withText(good, goodBody)] } });
    });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(
        /Imported 1 preset, skipped 1 invalid/,
      ),
    );
    expect(exportPresetsManager.getCustomPresets().map((p) => p.name)).toEqual(["Imp"]);
    expect(onSelect).toHaveBeenCalled();
    const bad = new File(["nope"], "b.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [withText(bad, "nope")] } });
    });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/valid JSON/),
    );
  });
});

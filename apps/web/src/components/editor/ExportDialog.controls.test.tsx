import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkBrowserExportCapability,
  getDeviceProfile,
  runBenchmark,
  type DeviceProfile,
  type BenchmarkProgress,
  type BenchmarkResult,
} from "@openreel/core";
import { selectOption } from "../../test/select-option";
import { ExportDialog } from "./ExportDialog";
import { useProjectStore } from "../../stores/project-store";
import { getQuickExportPresets } from "../../services/quick-export-presets";
import { resetExportSdrChoices } from "./export-hdr-choice";

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    checkBrowserExportCapability: vi.fn(async () => ({
      supported: true,
      reason: null,
      audioCodec: "opus",
    })),
    getDeviceProfile: vi.fn(() => new Promise<never>(() => undefined)),
    getCodecRecommendations: vi.fn(() => []),
    estimateExportTime: vi.fn(() => ({
      formatted: "5 seconds",
      seconds: 5,
      confidence: "rough",
    })),
    probeHdrExportSupport: vi.fn(async () => ({ supported: true })),
    runBenchmark: vi.fn(),
    shouldRecommendBenchmark: vi.fn(() => true),
    formatDeviceSummary: vi.fn(
      (profile: DeviceProfile) => profile.gpu.renderer,
    ),
  };
});

const PROFILE: DeviceProfile = {
  cpu: { cores: 8, tier: "high" },
  memory: { gb: 16, tier: "high" },
  gpu: {
    vendor: "QA",
    renderer: "QA GPU",
    tier: "high",
    hasHardwareEncoding: true,
  },
  encoding: {
    h264: { supported: true, hardware: true },
    h265: { supported: true, hardware: true },
    vp9: { supported: true, hardware: true },
    av1: { supported: true, hardware: true },
  },
  platform: { os: "QA", browser: "QA", isMobile: false },
  overallTier: "high",
};
function chooseTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), {
    button: 0,
    ctrlKey: false,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function mount(props: Partial<React.ComponentProps<typeof ExportDialog>> = {}) {
  const onExport = vi.fn(),
    onClose = vi.fn();
  return {
    onExport,
    onClose,
    ...render(
      <ExportDialog
        isOpen
        duration={6}
        onExport={onExport}
        onClose={onClose}
        {...props}
      />,
    ),
  };
}
beforeEach(() => {
  vi.stubGlobal("openreel", { platform: "desktop" });
  vi.mocked(getDeviceProfile).mockImplementation(
    () => new Promise<never>(() => undefined),
  );
  vi.mocked(checkBrowserExportCapability).mockResolvedValue({
    supported: true,
    reason: null,
    audioCodec: "opus",
  });
  vi.mocked(runBenchmark).mockReset();
});
afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("full export controls", () => {
  it("offers Smart render when possible, on by default, and sends smartRender:false only when it is switched off", async () => {
    window.localStorage.removeItem("openreel.export.smartRender");
    const first = mount();
    chooseTab("Custom Settings");
    const toggle = screen.getByRole("switch", { name: "Smart render when possible" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(first.onExport.mock.calls[0][0]).not.toHaveProperty("smartRender", false);
    cleanup();

    const second = mount();
    chooseTab("Custom Settings");
    fireEvent.click(screen.getByRole("switch", { name: "Smart render when possible" }));
    expect(screen.getByRole("switch", { name: "Smart render when possible" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(second.onExport).toHaveBeenCalledWith(expect.objectContaining({ smartRender: false }), expect.anything());
    window.localStorage.removeItem("openreel.export.smartRender");
  });

  it("exports the complete custom video, audio and upscaling choices", async () => {
    const { onExport } = mount();
    chooseTab("Custom Settings");
    await selectOption(screen.getByRole("combobox", { name: "Format" }), "MOV");
    await selectOption(
      screen.getByRole("combobox", { name: "Codec" }),
      "ProRes",
    );
    await selectOption(
      screen.getByRole("combobox", { name: "Resolution" }),
      "720p (1280x720)",
    );
    await selectOption(
      screen.getByRole("combobox", { name: "Frame rate" }),
      "29.97 fps",
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Bitrate (kbps)" }),
      { target: { value: "27500" } },
    );
    const quality = screen.getByRole("slider", { name: "Quality" });
    quality.focus();
    fireEvent.keyDown(quality, { key: "End" });
    fireEvent.click(
      within(
        screen.getByRole("radiogroup", { name: "Encoding mode" }),
      ).getByRole("radio", { name: "Smallest" }),
    );
    await selectOption(
      screen.getByRole("combobox", { name: "Audio format" }),
      "WAV",
    );
    await selectOption(
      screen.getByRole("combobox", { name: "Sample rate" }),
      "96 kHz",
    );
    await selectOption(
      screen.getByRole("combobox", { name: "Audio bitrate" }),
      "320 kbps",
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Enhance quality with upscaling" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("radiogroup", { name: "Upscaling quality" }),
      ).getByRole("radio", { name: "quality" }),
    );
    const sharpening = screen.getByRole("slider", { name: "Sharpening" });
    sharpening.focus();
    fireEvent.keyDown(sharpening, { key: "Home" });
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "mov",
        codec: "prores",
        width: 1280,
        height: 720,
        frameRate: 29.97,
        bitrate: 27500,
        quality: 100,
        encodeMode: "smallest",
        audioSettings: expect.objectContaining({
          format: "wav",
          sampleRate: 96000,
          bitrate: 320,
        }),
        upscaling: { enabled: true, quality: "quality", sharpening: 0 },
      }),
      "file",
    );
  });

  it("keeps an empty bitrate draft visible and blocks export until corrected", () => {
    const { onExport } = mount();
    chooseTab("Custom Settings");
    const input = screen.getByRole("spinbutton", { name: "Bitrate (kbps)" });
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveDisplayValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("valid video bitrate");
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ bitrate: 12000 }),
      "file",
    );
  });

  it("filters codec choices by container and restores a compatible codec on format changes", async () => {
    mount();
    chooseTab("Custom Settings");
    await selectOption(
      screen.getByRole("combobox", { name: "Format" }),
      "WebM",
    );
    expect(screen.getByRole("combobox", { name: "Codec" })).toHaveTextContent(
      "VP9",
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Codec" }), {
      key: "ArrowDown",
    });
    expect(
      screen.queryByRole("option", { name: "H.264" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "AV1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "VP9" }));
    await selectOption(screen.getByRole("combobox", { name: "Format" }), "MP4");
    expect(screen.getByRole("combobox", { name: "Codec" })).toHaveTextContent(
      "H.264",
    );
  });

  it("keeps compression quality/size exclusive and exports the chosen marked range", () => {
    const { onExport } = mount({ markedRange: { startTime: 1, endTime: 3 } });
    fireEvent.click(screen.getByRole("radio", { name: "Marked In/Out" }));
    chooseTab("Smaller File");
    for (const name of ["Light", "Balanced", "Strong"]) {
      fireEvent.click(
        within(
          screen.getByRole("radiogroup", { name: "Compression quality" }),
        ).getByRole("radio", { name }),
      );
      expect(
        within(
          screen.getByRole("radiogroup", { name: "Compression quality" }),
        ).getByRole("radio", { name }),
      ).toBeChecked();
    }
    fireEvent.click(screen.getByRole("radio", { name: "Target size" }));
    const sizes = within(
      screen.getByRole("radiogroup", { name: "Target file size" }),
    ).getAllByRole("radio");
    for (const size of sizes) {
      fireEvent.click(size);
      expect(size).toBeChecked();
    }
    fireEvent.click(screen.getByRole("button", { name: "Compress & Export" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "mp4",
        codec: "h264",
        range: { startTime: 1, endTime: 3 },
        width: expect.any(Number),
        bitrate: expect.any(Number),
      }),
      "file",
    );
  });

  it("offers two-pass VBR on the desktop and exports it with the target and max", async () => {
    const { onExport } = mount();
    chooseTab("Custom Settings");
    const twoPass = screen.getByTestId("export-rate-control-vbr2") as HTMLOptionElement;
    expect(twoPass.disabled).toBe(false);
    fireEvent.change(screen.getByTestId("export-rate-control-mode"), { target: { value: "vbr2" } });
    fireEvent.change(screen.getByTestId("export-max-bitrate"), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ rateControl: "vbr2", maxBitrate: 90000 }),
      expect.anything(),
    );
  });

  it("disables two-pass VBR on the desktop for an SDR export from a Rec.2020 project, and downgrades a stored vbr2", async () => {
    const before = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...before, settings: { ...before.settings, workingColorSpace: "rec2020" } } });
    try {
      mount();
      chooseTab("Custom Settings");
      const twoPass = screen.getByTestId("export-rate-control-vbr2") as HTMLOptionElement;
      expect(twoPass.disabled).toBe(true);
      expect(twoPass.textContent).toMatch(/Rec\.2020/);
    } finally {
      useProjectStore.setState({ project: before });
    }
  });

  it("keeps an explicit SDR choice for an HDR sequence when the dialog is reopened", async () => {
    resetExportSdrChoices();
    const before = useProjectStore.getState().project;
    useProjectStore.setState({
      project: { ...before, settings: { ...before.settings, workingColorSpace: "rec2020", sequenceColorSpace: "rec2100pq" } },
    });
    try {
      const first = mount();
      chooseTab("Custom Settings");
      // The HDR default applies on open.
      await waitFor(() => expect(screen.getByRole("combobox", { name: "Color and HDR" })).toHaveTextContent(/HDR10/));
      await selectOption(screen.getByRole("combobox", { name: "Color and HDR" }), /^SDR/);
      expect(screen.getByRole("combobox", { name: "Color and HDR" })).toHaveTextContent(/SDR/);
      // Close and reopen the dialog.
      first.rerender(<ExportDialog isOpen={false} duration={6} onExport={first.onExport} onClose={first.onClose} />);
      await act(async () => {});
      first.rerender(<ExportDialog isOpen duration={6} onExport={first.onExport} onClose={first.onClose} />);
      await act(async () => {});
      chooseTab("Custom Settings");
      expect(screen.getByRole("combobox", { name: "Color and HDR" })).toHaveTextContent(/SDR/);
      expect(screen.getByRole("combobox", { name: "Color and HDR" })).not.toHaveTextContent(/HDR10/);
      // Choosing HDR again forgets the SDR choice.
      await selectOption(screen.getByRole("combobox", { name: "Color and HDR" }), /HDR10/);
      expect(screen.getByRole("combobox", { name: "Color and HDR" })).toHaveTextContent(/HDR10/);
    } finally {
      useProjectStore.setState({ project: before });
      resetExportSdrChoices();
    }
  });

  it("offers Broadcast WAV description and originator, which the quick export preset carries", async () => {
    window.localStorage.removeItem("openreel.export.bwf");
    const onExportAudio = vi.fn();
    mount({ onExportAudio });
    chooseTab("Custom Settings");
    fireEvent.change(screen.getByTestId("export-bwf-description"), { target: { value: "Reel 4 mix" } });
    fireEvent.change(screen.getByTestId("export-bwf-originator"), { target: { value: "Studio B" } });
    const preset = getQuickExportPresets({ width: 1920, height: 1080, frameRate: 30 }).find((p) => p.id === "bwf");
    expect(preset?.kind).toBe("audio");
    expect(preset?.settings).toMatchObject({ format: "wav", bwf: { enabled: true, description: "Reel 4 mix", originator: "Studio B" } });
    fireEvent.click(screen.getByTestId("export-bwf-run"));
    expect(onExportAudio).toHaveBeenCalledWith("bwf");
    window.localStorage.removeItem("openreel.export.bwf");
  });

  it("shows two-pass VBR disabled with the reason in the browser", async () => {
    vi.stubGlobal("openreel", undefined);
    mount();
    chooseTab("Custom Settings");
    const twoPass = screen.getByTestId("export-rate-control-vbr2") as HTMLOptionElement;
    expect(twoPass.disabled).toBe(true);
    expect(twoPass.textContent).toMatch(/desktop app/);
  });

  it("preserves browser delivery choice and explicit ProRes fallback acknowledgment", async () => {
    vi.stubGlobal("openreel", undefined);
    const { onExport } = mount();
    chooseTab("Custom Settings");
    await selectOption(
      screen.getByRole("combobox", { name: "Save video" }),
      "Choose a file location",
    );
    await selectOption(
      screen.getByRole("combobox", { name: "Codec" }),
      "ProRes",
    );
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Export as H.264 anyway" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export Video" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "mp4",
        codec: "h264",
        colorDepth: 8,
        pixelFormat: "yuv420",
      }),
      "file",
    );
  });

  it("ignores an older device probe after changing projects", async () => {
    const old = deferred<DeviceProfile>();
    vi.mocked(getDeviceProfile)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(PROFILE);
    const { rerender } = mount();
    rerender(
      <ExportDialog
        isOpen
        duration={6}
        onClose={vi.fn()}
        onExport={vi.fn()}
        projectWidth={640}
        projectHeight={360}
      />,
    );
    await screen.findByText("QA GPU", { exact: true });
    await act(async () =>
      old.resolve({ ...PROFILE, gpu: { ...PROFILE.gpu, renderer: "Old GPU" } }),
    );
    expect(
      screen.queryByText("Old GPU", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("keeps export available when optional device estimation fails", async () => {
    vi.mocked(getDeviceProfile).mockRejectedValue(
      new Error("Device probe failed"),
    );
    const { onExport } = mount();
    await act(async () => {});
    expect(
      screen.queryByRole("button", {
        name: "Show device export estimate details",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("handles a failed browser capability probe without an unhandled rejection", async () => {
    vi.stubGlobal("openreel", undefined);
    vi.mocked(checkBrowserExportCapability).mockRejectedValue(
      new Error("Probe failed"),
    );
    const { onExport } = mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check encoder support",
    );
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    expect(onExport).not.toHaveBeenCalled();
  });

  it("ignores an older browser capability response after changing settings", async () => {
    vi.stubGlobal("openreel", undefined);
    const old =
      deferred<Awaited<ReturnType<typeof checkBrowserExportCapability>>>();
    vi.mocked(checkBrowserExportCapability).mockReturnValueOnce(old.promise);
    mount();
    chooseTab("Custom Settings");
    await selectOption(
      screen.getByRole("combobox", { name: "Format" }),
      "WebM",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export Video" }),
      ).toBeEnabled(),
    );
    await act(async () =>
      old.resolve({ supported: false, reason: "Stale failure" }),
    );
    expect(screen.queryByText("Stale failure")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Video" })).toBeEnabled();
  });

  it("ignores a previous benchmark's progress and result after closing and reopening", async () => {
    vi.mocked(getDeviceProfile).mockResolvedValue(PROFILE);
    const pending = deferred<BenchmarkResult>();
    let report: ((value: BenchmarkProgress) => void) | undefined;
    vi.mocked(runBenchmark).mockImplementation((progress) => {
      report = progress;
      return pending.promise;
    });
    const props = { duration: 6, onClose: vi.fn(), onExport: vi.fn() };
    const { rerender } = render(<ExportDialog isOpen {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Get accurate estimate" }),
    );
    rerender(<ExportDialog isOpen={false} {...props} />);
    rerender(<ExportDialog isOpen {...props} />);
    await act(async () => {
      report?.({
        phase: "encoding",
        progress: 0.75,
        framesProcessed: 45,
        totalFrames: 60,
      });
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await act(async () =>
      pending.resolve({
        framesPerSecond: 30,
        codec: "h264",
        resolution: { width: 1920, height: 1080 },
        testedAt: 0,
      }),
    );
    expect(
      vi.mocked(getDeviceProfile).mock.calls.some(([force]) => force === true),
    ).toBe(false);
  });
});

import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBrowserExportCapability } from "@openreel/core";
import { ExportDialog } from "./ExportDialog";
import { useProjectStore } from "../../stores/project-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { mobileExportResolution } from "./mobile/MobileExportSheet";

vi.mock("@openreel/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@openreel/core")>(),
  checkBrowserExportCapability: vi.fn(async () => ({ supported: true, reason: null })),
  estimateExportTime: vi.fn(() => null), getCodecRecommendations: vi.fn(() => []),
  getDeviceProfile: vi.fn(() => new Promise<never>(() => undefined)),
}));

beforeEach(() => {
  vi.spyOn(window,"matchMedia").mockImplementation(query => ({ matches: query === "(max-width: 600px) and (hover: none) and (pointer: coarse)", media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true }));
  vi.mocked(checkBrowserExportCapability).mockResolvedValue({ supported: true, reason: null });
  useProjectStore.getState().loadProject(createEmptyProject("Actual phone project"));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function ready() {
  await screen.findByRole("dialog",{name:"Export"});
  await waitFor(() => expect(screen.getByRole("button",{name:"Save to device"})).toBeEnabled());
}

describe("phone export", () => {
  it("preserves portrait framing and exports the real selected resolution and frame rate", async () => {
    const onExport=vi.fn(), onClose=vi.fn();
    render(<ExportDialog isOpen onClose={onClose} onExport={onExport} duration={41} projectWidth={1080} projectHeight={1920}/>);
    await ready();
    expect(screen.getByText("Actual phone project")).toBeInTheDocument();
    expect(screen.getByText(/0:41 · 9:16/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio",{name:"720p"}));
    fireEvent.click(screen.getByRole("radio",{name:"60 fps"}));
    await ready();
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Save to device"}));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({width:720,height:1280,frameRate:60,keyframeInterval:120}),"download");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("blocks export while encoder checks are pending and when the selected encoder fails", async () => {
    let resolve!: (value: {supported:boolean;reason:string|null}) => void;
    vi.mocked(checkBrowserExportCapability).mockImplementation(() => new Promise(done => { resolve=done; }));
    const onExport=vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5}/>);
    expect(await screen.findByRole("button",{name:"Checking encoder…"})).toBeDisabled();
    await act(async () => { resolve({supported:false,reason:"Encoder not supported"}); });
    expect(screen.getByRole("alert")).toHaveTextContent("Encoder not supported");
    expect(screen.getByRole("button",{name:"Save to device"})).toBeDisabled();
    expect(onExport).not.toHaveBeenCalled();
  });
  it("rounds odd output dimensions to even pixels while retaining square and wide aspect ratios", () => {
    expect(mobileExportResolution(1920,1080,2160)).toEqual({width:3840,height:2160});
    expect(mobileExportResolution(1080,1920,720)).toEqual({width:720,height:1280});
    expect(mobileExportResolution(1024,1024,1080)).toEqual({width:1080,height:1080});
    const odd=mobileExportResolution(1001,777,720);
    expect(odd.width % 2).toBe(0); expect(odd.height % 2).toBe(0);
    expect(odd.width/odd.height).toBeCloseTo(1001/777,2);
  });
  it("offers Add to queue on the phone sheet only when the host supports a queue, with the selected settings", async () => {
    const onAddToQueue=vi.fn(), onClose=vi.fn();
    const { rerender } = render(<ExportDialog isOpen onClose={onClose} onExport={vi.fn()} duration={5}/>);
    await ready();
    expect(screen.queryByRole("button",{name:"Add to queue"})).toBeNull();
    rerender(<ExportDialog isOpen onClose={onClose} onExport={vi.fn()} onAddToQueue={onAddToQueue} duration={5}/>);
    await ready();
    fireEvent.click(screen.getByRole("radio",{name:"720p"}));
    fireEvent.click(screen.getByRole("radio",{name:"60 fps"}));
    await ready();
    fireEvent.click(screen.getByRole("button",{name:"Add to queue"}));
    expect(onAddToQueue).toHaveBeenCalledWith(expect.objectContaining({height:720,frameRate:60}),expect.objectContaining({usePreviews:expect.any(Boolean)}));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

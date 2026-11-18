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
  downloadBlob,
  type CompressionSource,
} from "@openreel/core";
import {
  probeCompressionSource,
  runCompression,
} from "../../services/video-compressor";
import { CompressDialog } from "./CompressDialog";
vi.mock("@openreel/core", async (original) => ({
  ...(await original<typeof import("@openreel/core")>()),
  downloadBlob: vi.fn(),
}));
vi.mock("../../services/video-compressor", async (original) => ({
  ...(await original<typeof import("../../services/video-compressor")>()),
  probeCompressionSource: vi.fn(),
  runCompression: vi.fn(),
}));
const SOURCE: CompressionSource = {
  durationSec: 60,
  width: 1920,
  height: 1080,
  frameRate: 30,
  hasAudio: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const file = (name = "source.mp4") =>
  new File(["video"], name, { type: "video/mp4" });
function pick(container: HTMLElement, value: File) {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [value] },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runCompression).mockReset();
  vi.mocked(probeCompressionSource).mockReset();
  vi.mocked(probeCompressionSource).mockResolvedValue(SOURCE);
});
afterEach(cleanup);
describe("standalone compression ownership", () => {
  it("does not publish a probe after its dialog has been closed and reopened", async () => {
    const probe = deferred<CompressionSource | null>();
    vi.mocked(probeCompressionSource).mockReturnValueOnce(probe.promise);
    const close = vi.fn();
    const view = render(<CompressDialog isOpen onClose={close} />);
    pick(document.body, file());
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    view.rerender(<CompressDialog isOpen={false} onClose={close} />);
    view.rerender(<CompressDialog isOpen onClose={close} />);
    await act(async () => probe.resolve(SOURCE));
    expect(screen.queryByText("Estimated output")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compress" })).toBeDisabled();
  });
  it("never downloads a cancelled encode that resolves late", async () => {
    const job = deferred<Blob>();
    vi.mocked(runCompression).mockReturnValueOnce(job.promise);
    const close = vi.fn();
    render(<CompressDialog isOpen onClose={close} />);
    pick(document.body, file());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Compress" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    await waitFor(() => expect(runCompression).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(runCompression).mock.calls[0][3]?.aborted).toBe(true);
    await act(async () =>
      job.resolve(new Blob(["encoded"], { type: "video/mp4" })),
    );
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

async function ready() {
  pick(document.body, file());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Compress" })).toBeEnabled(),
  );
}

describe("compression controls and output", () => {
  it("keeps errors retryable and accepts the same picked file again", async () => {
    vi.mocked(probeCompressionSource).mockRejectedValueOnce(
      new Error("decode"),
    );
    render(<CompressDialog isOpen onClose={vi.fn()} />);
    pick(document.body, file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read");
    expect(screen.getByRole("button", { name: "Compress" })).toBeDisabled();
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.mocked(runCompression).mockRejectedValueOnce(new Error("encode"));
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Compression failed",
    );
    expect(screen.getByRole("button", { name: "Compress" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove video" }));
    expect(screen.queryByText("source.mp4")).not.toBeInTheDocument();
  });
});

describe("probe and encoder ownership", () => {
  it("accepts a replacement drop and ignores an earlier probe and its errors", async () => {
    const first = deferred<CompressionSource | null>();
    vi.mocked(probeCompressionSource).mockReturnValueOnce(first.promise);
    render(<CompressDialog isOpen onClose={vi.fn()} />);
    pick(document.body, file("old.mp4"));
    const oldSignal = vi.mocked(probeCompressionSource).mock.calls[0][1];
    fireEvent.drop(screen.getByRole("button", { name: "Video file" }), {
      dataTransfer: { files: [file("new.mp4")] },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Compress" })).toBeEnabled(),
    );
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => first.reject(new Error("late")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("new.mp4")).toBeInTheDocument();
  });
  it("clamps live progress, blocks duplicate starts and waits for cancellation acknowledgement", async () => {
    const pending = deferred<Blob>();
    vi.mocked(runCompression).mockReturnValueOnce(pending.promise);
    const close = vi.fn();
    render(<CompressDialog isOpen onClose={close} />);
    await ready();
    const start = screen.getByRole("button", { name: "Compress" });
    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    expect(runCompression).toHaveBeenCalledOnce();
    const progress = vi.mocked(runCompression).mock.calls[0][2]!;
    act(() => progress(2));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    act(() => progress(NaN));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    act(() => progress(-2));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    fireEvent.keyDown(document.activeElement!, {
      key: "Escape",
      code: "Escape",
    });
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    act(() => progress(0.8));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    await act(async () =>
      pending.reject(new DOMException("Cancelled", "AbortError")),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compress" })).toBeEnabled();
  });
  it("holds the encoder lease across externally closed and reopened sessions", async () => {
    const pending = deferred<Blob>();
    vi.mocked(runCompression).mockReturnValueOnce(pending.promise);
    const close = vi.fn();
    const view = render(<CompressDialog isOpen onClose={close} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    const old = vi.mocked(runCompression).mock.calls[0];
    view.rerender(<CompressDialog isOpen={false} onClose={close} />);
    expect(old[3]?.aborted).toBe(true);
    view.rerender(<CompressDialog isOpen onClose={close} />);
    pick(document.body, file("replacement.mp4"));
    await screen.findByText("Estimated output");
    expect(screen.getByRole("button", { name: "Compress" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finishing previous cancellation",
    );
    act(() => old[2]?.(0.75));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await act(async () => pending.resolve(new Blob()));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Compress" })).toBeEnabled();
    vi.mocked(runCompression).mockResolvedValueOnce(new Blob());
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(runCompression).toHaveBeenCalledTimes(2);
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "replacement-compressed.mp4",
    );
  });
  it("aborts an unmounted encode without downloading or closing", async () => {
    const pending = deferred<Blob>();
    vi.mocked(runCompression).mockReturnValueOnce(pending.promise);
    const close = vi.fn();
    const view = render(<CompressDialog isOpen onClose={close} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    view.unmount();
    expect(vi.mocked(runCompression).mock.calls[0][3]?.aborted).toBe(true);
    await act(async () => pending.resolve(new Blob()));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

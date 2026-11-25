import React, { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyWithRetry, retryableLazy } from "./lazy-retry";

const Panel: React.FC<{ name: string }> = ({ name }) => <div>Panel {name}</div>;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("lazy inspector chunk retry", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("fetches the chunk again the next time the panel opens after a failed import", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const importer = vi.fn<[], Promise<{ default: typeof Panel }>>()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ default: Panel });
    const Lazy = lazyWithRetry<typeof Panel>(importer, "Audio panel");

    const first = render(<Suspense fallback={null}><Lazy name="a" /></Suspense>);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Audio panel could not load.");
    expect(importer).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<Suspense fallback={null}><Lazy name="b" /></Suspense>);
    await flush();
    expect(importer).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Panel b")).toBeTruthy();
  });

  it("retries in place from the Retry button without remounting the inspector", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const importer = vi.fn<[], Promise<{ default: typeof Panel }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: Panel });
    const Lazy = lazyWithRetry<typeof Panel>(importer);
    render(<Suspense fallback={null}><Lazy name="c" /></Suspense>);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush();
    expect(screen.getByText("Panel c")).toBeTruthy();
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("shares one request between callers, caches success, and clears the cache on failure", async () => {
    const importer = vi.fn<[], Promise<{ default: typeof Panel }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: Panel });
    const panel = retryableLazy(importer);
    await expect(panel.load()).rejects.toThrow("offline");
    expect(panel.loaded()).toBeNull();
    const [a, b] = await Promise.all([panel.load(), panel.load()]);
    expect(a).toBe(Panel);
    expect(b).toBe(Panel);
    await panel.load();
    expect(importer).toHaveBeenCalledTimes(2);
    expect(panel.loaded()).toBe(Panel);
  });

  it("does not refetch in a loop while a chunk keeps failing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const importer = vi.fn<[], Promise<{ default: typeof Panel }>>()
      .mockRejectedValue(new Error("offline"));
    const Lazy = lazyWithRetry<typeof Panel>(importer);
    render(<Suspense fallback={null}><Lazy name="d" /></Suspense>);
    await flush();
    await flush();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

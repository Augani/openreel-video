import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@openreel/ui";
import { releaseStaleBodyPointerLock } from "@openreel/ui/lib/pointer-lock";

afterEach(() => {
  document.body.removeAttribute("style");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("releaseStaleBodyPointerLock", () => {
  it("clears a leftover lock when no modal layer is open", () => {
    document.body.style.pointerEvents = "none";
    expect(releaseStaleBodyPointerLock()).toBe(true);
    expect(document.body.style.pointerEvents).toBe("");
    expect(document.body.hasAttribute("style")).toBe(false);
  });

  it("keeps the lock while a dialog or menu is open", () => {
    document.body.style.pointerEvents = "none";
    for (const role of ["dialog", "menu"]) {
      const layer = document.createElement("div");
      layer.setAttribute("role", role);
      layer.setAttribute("data-state", "open");
      document.body.appendChild(layer);
      expect(releaseStaleBodyPointerLock()).toBe(false);
      expect(document.body.style.pointerEvents).toBe("none");
      layer.remove();
    }
  });

  it("does nothing when the body is not locked", () => {
    document.body.style.overflow = "hidden";
    expect(releaseStaleBodyPointerLock()).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
  });
});

describe("DialogContent", () => {
  function Harness({ open }: { open: boolean }) {
    return (
      <Dialog open={open}>
        <DialogContent>
          <DialogTitle>Match</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }

  it("releases a body pointer lock left behind after it closes", async () => {
    vi.useFakeTimers();
    const view = render(<Harness open />);
    view.rerender(<Harness open={false} />);
    // Simulate the race: the lock is still on the body after both layers closed.
    document.body.style.pointerEvents = "none";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(document.body.style.pointerEvents).toBe("");
  });
});

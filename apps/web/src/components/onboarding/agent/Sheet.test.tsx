import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Sheet from "./Sheet";

function installBridge() {
  Object.defineProperty(window, "openreel", {
    configurable: true,
    value: {
      platform: "desktop",
      mcp: {
        getStatus: vi.fn().mockResolvedValue({
          running: true,
          url: "http://127.0.0.1:4400/mcp",
          port: 4400,
          token: "tok",
          shimPath: "/x/index.js",
          endpointFile: "/tmp/e.json",
        }),
        testConnection: vi.fn().mockResolvedValue({ ok: true, toolCount: 1 }),
        rotateToken: vi.fn(),
        onRequest: vi.fn(),
        getClientStatus: vi.fn().mockResolvedValue({ connected: false, clients: [], initializeCount: 0, startError: null }),
      },
    },
  });
}

describe("agent Sheet accessibility", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "openreel");
  });

  it("closes on Escape from inside the dialog", () => {
    installBridge();
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last focusable element back to the first", () => {
    installBridge();
    render(<Sheet onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog");
    const items = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, [tabindex]"));
    const last = items[items.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(items[0]);
    items[0].focus();
    fireEvent.keyDown(items[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("returns focus to the opener on close", () => {
    installBridge();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Sheet onClose={() => undefined} />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

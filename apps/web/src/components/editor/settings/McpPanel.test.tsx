import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { McpPanel } from "./McpPanel";

describe("McpPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "openreel");
  });

  it("shows the live MCP catalog size and organized workflow groups", async () => {
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        mcp: {
          getStatus: vi.fn().mockResolvedValue({
            running: true,
            url: "http://127.0.0.1:4400/mcp",
            port: 4400,
            token: "token",
            shimPath: "/Applications/OpenReel/openreel-mcp.js",
            endpointFile: "/tmp/openreel-mcp.json",
          }),
          testConnection: vi.fn().mockResolvedValue({ ok: true, toolCount: 214 }),
          rotateToken: vi.fn(),
          onRequest: vi.fn(),
        },
      },
    });

    render(<McpPanel />);

    await waitFor(() => expect(screen.getByText("214 available")).toBeTruthy());
    expect(screen.getByText("Video Editor")).toBeTruthy();
    expect(screen.getByText("Motion Creator")).toBeTruthy();
    expect(screen.getByText("Creation & 3D")).toBeTruthy();
    expect(screen.getByText("Project Operations")).toBeTruthy();
  });

  const baseStatus = {
    running: true,
    url: "http://127.0.0.1:4400/mcp",
    port: 4400,
    token: "token",
    shimPath: "/Applications/OpenReel/openreel-mcp.js",
    endpointFile: "/tmp/openreel-mcp.json",
  };

  it("shows the Claude Code tab with the real shim path", async () => {
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        mcp: {
          getStatus: vi.fn().mockResolvedValue(baseStatus),
          testConnection: vi.fn().mockResolvedValue({ ok: true, toolCount: 5 }),
          rotateToken: vi.fn(),
          onRequest: vi.fn(),
        },
      },
    });
    render(<McpPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("Command").textContent).toBe(
        "claude mcp add openreel -- node /Applications/OpenReel/openreel-mcp.js",
      ),
    );
  });

  it("shows the connected client and a start failure", async () => {
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        mcp: {
          getStatus: vi.fn().mockResolvedValue({ ...baseStatus, running: false }),
          testConnection: vi.fn(),
          rotateToken: vi.fn(),
          onRequest: vi.fn(),
          getClientStatus: vi.fn().mockResolvedValue({
            connected: true,
            clients: [{ name: "cursor", version: "0.9", connectedAt: 1, lastSeenAt: 2 }],
            initializeCount: 1,
            startError: "EADDRINUSE: 127.0.0.1:4400",
          }),
        },
      },
    });
    render(<McpPanel />);
    await waitFor(() => expect(screen.getByTestId("mcp-connection-indicator").textContent).toBe("Connected: cursor 0.9"));
    expect(screen.getByRole("alert").textContent).toContain("EADDRINUSE");
  });

  it("edits the allowed folders through the main-process policy", async () => {
    const getPolicy = vi.fn().mockResolvedValue({ allowedRoots: ["/Users/me/Movies"], defaultRoots: ["/Users/me/Movies"] });
    const setPolicy = vi.fn().mockImplementation(async (p: { allowedRoots: string[] }) => ({
      allowedRoots: p.allowedRoots,
      defaultRoots: ["/Users/me/Movies"],
    }));
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        mcp: {
          getStatus: vi.fn().mockResolvedValue(baseStatus),
          testConnection: vi.fn().mockResolvedValue({ ok: true, toolCount: 1 }),
          rotateToken: vi.fn(),
          onRequest: vi.fn(),
          getPolicy,
          setPolicy,
        },
      },
    });
    render(<McpPanel />);
    await waitFor(() => expect(screen.getByText("/Users/me/Movies")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Folder path to allow"), { target: { value: "relative/path" } });
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    expect((await screen.findByText(/absolute folder path/)).textContent).toBeTruthy();
    expect(setPolicy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Folder path to allow"), { target: { value: "/Volumes/Footage" } });
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() =>
      expect(setPolicy).toHaveBeenCalledWith({ allowedRoots: ["/Users/me/Movies", "/Volumes/Footage"] }),
    );
    await waitFor(() => expect(screen.getByText("/Volumes/Footage")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Remove /Volumes/Footage" }));
    await waitFor(() => expect(setPolicy).toHaveBeenLastCalledWith({ allowedRoots: ["/Users/me/Movies"] }));
  });

  it("Reset clears the custom list (empty means defaults) instead of freezing the default list", async () => {
    const getPolicy = vi.fn().mockResolvedValue({ allowedRoots: ["/Volumes/Footage"], defaultRoots: ["/Users/me/Movies"] });
    const setPolicy = vi.fn().mockImplementation(async (p: { allowedRoots: string[] }) => ({
      allowedRoots: p.allowedRoots,
      defaultRoots: ["/Users/me/Movies"],
    }));
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        mcp: {
          getStatus: vi.fn().mockResolvedValue(baseStatus),
          testConnection: vi.fn().mockResolvedValue({ ok: true, toolCount: 1 }),
          rotateToken: vi.fn(),
          onRequest: vi.fn(),
          getPolicy,
          setPolicy,
        },
      },
    });
    render(<McpPanel />);
    await waitFor(() => expect(screen.getByText("/Volumes/Footage")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(setPolicy).toHaveBeenCalledWith({ allowedRoots: [] }));
    await waitFor(() => expect(screen.getByText("/Users/me/Movies")).toBeTruthy());
    expect(screen.getByText(/Using the default folders/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset to defaults" })).toBeNull();
  });
});

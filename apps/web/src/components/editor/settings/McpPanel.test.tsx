import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});

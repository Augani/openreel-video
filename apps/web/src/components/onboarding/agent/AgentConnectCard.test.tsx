import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentConnectCard } from "./AgentConnectCard";
import { claudeCodeCommand, clientConfigJson, connectionLabel } from "./mcp-connect";
import { useSettingsStore } from "../../../stores/settings-store";

const SHIM = "/Applications/OpenReel.app/Contents/Resources/app.asar.unpacked/dist/mcp-shim/index.js";

function installBridge(overrides: Record<string, unknown> = {}) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(window, "openreel", {
    configurable: true,
    value: {
      platform: "desktop",
      mcp: {
        getStatus: vi.fn().mockResolvedValue({
          running: true,
          url: "http://127.0.0.1:4400/mcp",
          port: 4400,
          token: "tok-123",
          shimPath: SHIM,
          endpointFile: "/tmp/e.json",
        }),
        testConnection: vi.fn().mockResolvedValue({ ok: true, toolCount: 412 }),
        rotateToken: vi.fn(),
        onRequest: vi.fn(),
        getClientStatus: vi.fn().mockResolvedValue({ connected: false, clients: [], initializeCount: 0, startError: null }),
        ...overrides,
      },
    },
  });
  return { writeText };
}

describe("AgentConnectCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "openreel");
  });

  it("shows the live tool count from tools/list in the status chip", async () => {
    installBridge();
    render(<AgentConnectCard />);
    await waitFor(() => expect(screen.getByTestId("mcp-status-chip").textContent).toContain("Server running · 412 tools"));
  });

  it("builds the Claude Code snippet from the real shim path", async () => {
    installBridge();
    render(<AgentConnectCard />);
    await waitFor(() => expect(screen.getByLabelText("Command").textContent).toContain(SHIM));
    expect(screen.getByLabelText("Command").textContent).toBe(`claude mcp add openreel -- node ${SHIM}`);
  });

  it("quotes shim paths that contain spaces", () => {
    expect(claudeCodeCommand("/Users/me/My Apps/shim.js")).toBe("claude mcp add openreel -- node '/Users/me/My Apps/shim.js'");
    expect(claudeCodeCommand("/it's/shim.js")).toContain(`'/it'\\''s/shim.js'`);
  });

  it("uses the real shim path in the JSON config tab", async () => {
    installBridge();
    render(<AgentConnectCard />);
    await waitFor(() => expect(screen.getByLabelText("Command").textContent).toContain(SHIM));
    fireEvent.click(screen.getByRole("tab", { name: /Claude Desktop/ }));
    const config = JSON.parse(screen.getByLabelText("Config").textContent ?? "{}");
    expect(config.mcpServers.openreel).toEqual({ command: "node", args: [SHIM] });
    expect(JSON.parse(clientConfigJson(SHIM))).toEqual(config);
  });

  it("shows URL and bearer header on the Direct HTTP tab, masking the token but copying the real one", async () => {
    const { writeText } = installBridge();
    render(<AgentConnectCard />);
    await waitFor(() => expect(screen.getByLabelText("Command").textContent).toContain(SHIM));
    fireEvent.click(screen.getByRole("tab", { name: "Direct HTTP" }));
    const shown = screen.getByLabelText("Connection details").textContent ?? "";
    expect(shown).toContain("http://127.0.0.1:4400/mcp");
    expect(shown).toContain("Authorization: Bearer");
    expect(shown).not.toContain("tok-123");
    fireEvent.click(screen.getByRole("button", { name: "Copy connection details" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("Bearer tok-123");
  });

  it("copies the command", async () => {
    const { writeText } = installBridge();
    render(<AgentConnectCard />);
    await waitFor(() => expect(screen.getByLabelText("Command").textContent).toContain(SHIM));
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`claude mcp add openreel -- node ${SHIM}`));
  });

  it("moves between tabs with the arrow keys", async () => {
    installBridge();
    render(<AgentConnectCard />);
    const first = screen.getByRole("tab", { name: "Claude Code" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Claude Desktop/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("flips from waiting to connected when a client initializes", async () => {
    installBridge({
      getClientStatus: vi.fn().mockResolvedValue({
        connected: true,
        clients: [{ name: "claude-code", version: "2.1.0", connectedAt: 1, lastSeenAt: 2 }],
        initializeCount: 1,
        startError: null,
      }),
    });
    render(<AgentConnectCard />);
    expect(screen.getByTestId("mcp-connection-indicator").textContent).toContain("Waiting for a client");
    await waitFor(() =>
      expect(screen.getByTestId("mcp-connection-indicator").textContent).toBe("Connected: claude-code 2.1.0"),
    );
  });

  it("surfaces a start failure", async () => {
    installBridge({
      getStatus: vi.fn().mockResolvedValue({ running: false, url: "", port: 0, token: "", shimPath: SHIM, endpointFile: "" }),
      getClientStatus: vi.fn().mockResolvedValue({ connected: false, clients: [], initializeCount: 0, startError: "EADDRINUSE" }),
    });
    render(<AgentConnectCard />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("EADDRINUSE"));
    expect(screen.getByTestId("mcp-status-chip").textContent).toContain("not running");
  });

  it("binds the safety toggle to the trusted-local setting", async () => {
    installBridge();
    useSettingsStore.setState({ mcpAutoAllowTrustedLocal: true });
    render(<AgentConnectCard />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().mcpAutoAllowTrustedLocal).toBe(false);
    useSettingsStore.setState({ mcpAutoAllowTrustedLocal: true });
  });

  it("states that the window does not need to be open", () => {
    installBridge();
    render(<AgentConnectCard />);
    expect(screen.getByText(/don't need this window open or in front/)).toBeTruthy();
  });
});

describe("connectionLabel", () => {
  it("summarizes several clients", () => {
    const label = connectionLabel({
      connected: true,
      clients: [
        { name: "cursor", connectedAt: 1, lastSeenAt: 3 },
        { name: "cline", connectedAt: 1, lastSeenAt: 2 },
      ],
      initializeCount: 2,
      startError: null,
    });
    expect(label).toEqual({ connected: true, text: "Connected: cursor +1" });
  });

  it("shows Try again when the shim path is empty and re-reads status, then shows the real command", async () => {
    const status = (shimPath: string) => ({
      running: true,
      url: "http://127.0.0.1:4400/mcp",
      port: 4400,
      token: "tok-123",
      shimPath,
      endpointFile: "/tmp/e.json",
    });
    const getStatus = vi.fn().mockResolvedValueOnce(status("")).mockResolvedValue(status(SHIM));
    installBridge({ getStatus });
    render(<AgentConnectCard />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByLabelText("Command")).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByLabelText("Command").textContent).toBe(`claude mcp add openreel -- node ${SHIM}`));
    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PluginRegistry, setPluginRegistryForTests } from "@openreel/core";
import { ManagePluginsDialog } from "./ManagePluginsDialog";
import { usePluginManagerStore } from "../../../stores/plugin-manager-store";

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    apiVersion: 1,
    id: "ui-demo",
    name: "UI Demo",
    version: "1.2.3",
    category: "Color",
    description: "Dialog test plugin",
    parameters: [{ key: "amount", type: "float", min: 0, max: 1, default: 0.5 }],
    cpu: { file: "cpu.js" },
    ...over,
  });

const file = (name: string, text: string, relative?: string): File => {
  const f = new File([text], name, { type: "text/plain" });
  // jsdom's File has no text(); browsers do.
  Object.defineProperty(f, "text", { value: async () => text });
  if (relative) Object.defineProperty(f, "webkitRelativePath", { value: relative });
  return f;
};

let registry: PluginRegistry;
beforeEach(() => {
  // jsdom's IndexedDB stub never answers; these tests exercise the dialog with an in-memory registry.
  Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true, writable: true });
  registry = new PluginRegistry();
  setPluginRegistryForTests(registry);
  usePluginManagerStore.setState({ open: true });
});
afterEach(() => {
  cleanup();
  usePluginManagerStore.setState({ open: false });
  setPluginRegistryForTests(null);
});

describe("Manage Plugins dialog", () => {
  it("starts empty, installs a plugin folder, lists it and uninstalls it", async () => {
    render(<ManagePluginsDialog />);
    expect(screen.getByTestId("plugin-empty")).toBeTruthy();

    const input = screen.getByTestId("plugin-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [
            file("plugin.json", manifest(), "ui-demo/plugin.json"),
            file("cpu.js", "function process(frame) {}", "ui-demo/cpu.js"),
          ],
        },
      });
    });
    await waitFor(() => expect(screen.getByTestId("plugin-install-report").textContent).toContain("Installed UI Demo v1.2.3"));
    expect(screen.getByTestId("plugin-row-ui-demo").textContent).toContain("Dialog test plugin");
    expect(registry.get("ui-demo")?.manifest.version).toBe("1.2.3");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Uninstall UI Demo" }));
    });
    await waitFor(() => expect(screen.getByTestId("plugin-empty")).toBeTruthy());
    expect(registry.get("ui-demo")).toBeUndefined();
  });

  it("explains why a package was refused and installs nothing", async () => {
    render(<ManagePluginsDialog />);
    const input = screen.getByTestId("plugin-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [file("plugin.json", manifest({ id: "Not Valid" })), file("cpu.js", "function process(frame) {}")] },
      });
    });
    const report = await screen.findByTestId("plugin-install-report");
    expect(report.getAttribute("role")).toBe("alert");
    expect(report.textContent).toContain("could not be installed");
    expect(report.textContent).toContain("id must match");
    expect(registry.list()).toHaveLength(0);

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [file("plugin.json", manifest()), file("cpu.js", "function process(frame) { fetch('https://x'); }")] },
      });
    });
    await waitFor(() => expect(screen.getByTestId("plugin-install-report").textContent).toContain('may not use "fetch"'));
    expect(registry.list()).toHaveLength(0);
  });

  it("shows a bypassed plugin's error and lets the user retry it", async () => {
    render(<ManagePluginsDialog />);
    const input = screen.getByTestId("plugin-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file("plugin.json", manifest()), file("cpu.js", "function process(frame) {}")] } });
    });
    await screen.findByTestId("plugin-row-ui-demo");
    act(() => {
      for (let i = 0; i < 3; i++) registry.reportFailure("ui-demo", "frame exceeded the budget");
    });
    expect(screen.getByTestId("plugin-health-ui-demo").textContent).toContain("Bypassed after repeated failures: frame exceeded the budget");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(registry.isBypassed("ui-demo")).toBe(false);
    expect(screen.queryByTestId("plugin-health-ui-demo")).toBeNull();
  });
});

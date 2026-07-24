import { describe, it, expect } from "vitest";
import { buildMenuTemplate } from "../src/main/app-menu";

describe("buildMenuTemplate", () => {
  it("includes the app menu first on mac and not on others", () => {
    const mac = buildMenuTemplate("darwin");
    expect(mac[0].label).toBe("OpenReel");
    const win = buildMenuTemplate("win32");
    expect(win[0].label).toBe("File");
  });
  it("has File/Edit/View/Window/Help groups", () => {
    const labels = buildMenuTemplate("win32").map((m) => m.label);
    for (const l of ["File", "Edit", "View", "Window", "Help"]) expect(labels).toContain(l);
  });
  it("File>New uses CmdOrCtrl+N", () => {
    const file = buildMenuTemplate("win32").find((m) => m.label === "File");
    const item = file?.submenu?.find((s) => s.label === "New Project");
    expect(item?.accelerator).toBe("CmdOrCtrl+N");
  });
  it("exposes settings with the platform shortcut", () => {
    const macApp = buildMenuTemplate("darwin")[0];
    expect(macApp.submenu?.find((item) => item.actionId === "settings")?.accelerator)
      .toBe("Cmd+,");

    const windowsEdit = buildMenuTemplate("win32").find(
      (menu) => menu.label === "Edit",
    );
    expect(
      windowsEdit?.submenu?.find((item) => item.actionId === "settings")
        ?.accelerator,
    ).toBe("Ctrl+,");
  });
});

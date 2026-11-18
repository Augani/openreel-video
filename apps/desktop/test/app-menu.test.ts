import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  Menu: { sendActionToFirstResponder: vi.fn(), setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  BrowserWindow: {},
  shell: {},
}));

import { buildMenuTemplate } from "../src/main/app-menu";

interface Node {
  label: string;
  actionId?: string;
  role?: string;
  submenu?: Node[];
}

function walk(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    out.push(n);
    if (n.submenu) walk(n.submenu, out);
  }
  return out;
}

describe("application menu Help items", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    it(`has onboarding re-entry items on ${platform}`, () => {
      const help = buildMenuTemplate(platform).find((m) => m.label === "Help");
      expect(help).toBeDefined();
      const ids = help!.submenu!.map((i) => i.actionId);
      expect(ids).toEqual(expect.arrayContaining(["showWelcomeSetup", "openLessons", "connectAgent", "openLicenses"]));
      const setup = help!.submenu!.find((i) => i.actionId === "showWelcomeSetup");
      expect(setup?.label).toBe("Welcome & Setup…");
    });

    it(`has no dead items (no actionId and no role) on ${platform}`, () => {
      const dead = walk(buildMenuTemplate(platform)).filter(
        (n) => !n.submenu && !n.actionId && !n.role,
      );
      expect(dead.map((n) => n.label)).toEqual([]);
    });
  }
});

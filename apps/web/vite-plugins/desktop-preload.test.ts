import { describe, it, expect } from "vitest";
import { desktopPreloadFiles } from "./desktop-preload";

const chunk = (fileName: string, imports: string[] = [], extra: Record<string, unknown> = {}) => ({
  type: "chunk",
  fileName,
  imports,
  ...extra,
});

describe("desktopPreloadFiles", () => {
  it("returns the shell's static closure minus what the entry already preloads", () => {
    const bundle = {
      "assets/index.js": chunk("assets/index.js", ["assets/react.js"], { isEntry: true }),
      "assets/react.js": chunk("assets/react.js"),
      "assets/DesktopApp.js": chunk("assets/DesktopApp.js", ["assets/index.js", "assets/react.js", "assets/WindowControls.js"], {
        facadeModuleId: "/repo/apps/web/src/desktop/DesktopApp.tsx",
      }),
      "assets/WindowControls.js": chunk("assets/WindowControls.js", ["assets/copy.js"]),
      "assets/copy.js": chunk("assets/copy.js"),
      "assets/EditorInterface.js": chunk("assets/EditorInterface.js", ["assets/index.js"]),
      "assets/style.css": { type: "asset", fileName: "assets/style.css" },
    };
    expect(desktopPreloadFiles(bundle).sort()).toEqual([
      "assets/DesktopApp.js",
      "assets/WindowControls.js",
      "assets/copy.js",
    ]);
  });

  it("does nothing when there is no desktop shell chunk (web build)", () => {
    expect(desktopPreloadFiles({ "assets/index.js": chunk("assets/index.js", [], { isEntry: true }) })).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn(), askForMediaAccess: vi.fn() },
  session: { defaultSession: {} },
}));

import { CHANNELS } from "../src/shared/channels";
import { decidePermission, isTrustedAppOrigin, microphoneSettingsUrl } from "../src/main/ipc/microphone";

describe("isTrustedAppOrigin", () => {
  it("trusts the packaged scheme and loopback dev hosts only", () => {
    expect(isTrustedAppOrigin("app://openreel/index.html")).toBe(true);
    expect(isTrustedAppOrigin("http://localhost:5173/")).toBe(true);
    expect(isTrustedAppOrigin("http://127.0.0.1:5391")).toBe(true);
    expect(isTrustedAppOrigin("app://evil/index.html")).toBe(false);
    expect(isTrustedAppOrigin("https://example.com/")).toBe(false);
    expect(isTrustedAppOrigin("")).toBe(false);
    expect(isTrustedAppOrigin("not a url")).toBe(false);
  });
});

describe("decidePermission", () => {
  const base = { requestingUrl: "app://openreel/index.html", micAccess: "granted" as const };

  it("grants a microphone request from the app once the OS allows it", () => {
    expect(decidePermission({ ...base, permission: "media", mediaTypes: ["audio"] })).toBe(true);
  });

  it("refuses the microphone when macOS or Windows privacy settings block it", () => {
    expect(decidePermission({ ...base, permission: "media", mediaTypes: ["audio"], micAccess: "denied" })).toBe(false);
    expect(decidePermission({ ...base, permission: "media", mediaTypes: ["audio"], micAccess: "restricted" })).toBe(false);
  });

  it("does not let a blocked microphone stop a camera-only request", () => {
    expect(decidePermission({ ...base, permission: "media", mediaTypes: ["video"], micAccess: "denied" })).toBe(true);
  });

  it("refuses every request from a foreign origin", () => {
    expect(decidePermission({ ...base, requestingUrl: "https://example.com/", permission: "media", mediaTypes: ["audio"] })).toBe(false);
    expect(decidePermission({ ...base, requestingUrl: "https://example.com/", permission: "clipboard-read" })).toBe(false);
  });

  it("keeps the default grant for the app's own non-media permissions", () => {
    expect(decidePermission({ ...base, permission: "fullscreen" })).toBe(true);
  });
});

describe("microphone settings", () => {
  it("deep-links to the privacy pane where one exists", () => {
    expect(microphoneSettingsUrl("darwin")).toContain("Privacy_Microphone");
    expect(microphoneSettingsUrl("win32")).toBe("ms-settings:privacy-microphone");
    expect(microphoneSettingsUrl("linux")).toBeNull();
  });

  it("freezes the channel names the preload bridge uses", () => {
    expect(CHANNELS).toMatchObject({
      microphoneStatus: "openreel:microphone:status",
      microphoneRequest: "openreel:microphone:request",
      microphoneOpenSettings: "openreel:microphone:openSettings",
    });
  });
});

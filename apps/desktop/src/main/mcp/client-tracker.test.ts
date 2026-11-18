import { beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_ACTIVE_WINDOW_MS,
  getMcpClientStatus,
  recordActivity,
  recordInitialize,
  recordStartError,
  resetClientTrackerForTests,
} from "./client-tracker";

let clock = 1_000;

describe("doctor client", () => {
  it("is not tracked as a connected client", () => {
    resetClientTrackerForTests();
    recordInitialize({ name: "openreel-mcp-doctor", version: "1" });
    expect(getMcpClientStatus().connected).toBe(false);
    expect(getMcpClientStatus().clients).toHaveLength(0);
  });
});

describe("client tracker", () => {
  beforeEach(() => {
    clock = 1_000;
    resetClientTrackerForTests(() => clock);
  });

  it("starts empty", () => {
    expect(getMcpClientStatus()).toEqual({ connected: false, clients: [], initializeCount: 0, startError: null });
  });

  it("records initialize calls with client info", () => {
    recordInitialize({ name: "claude-code", version: "2.1.0" });
    const status = getMcpClientStatus();
    expect(status.connected).toBe(true);
    expect(status.initializeCount).toBe(1);
    expect(status.clients).toEqual([{ name: "claude-code", version: "2.1.0", connectedAt: 1_000, lastSeenAt: 1_000 }]);
  });

  it("counts every initialize but keeps one row per client and version", () => {
    recordInitialize({ name: "cursor", version: "1" });
    clock = 2_000;
    recordInitialize({ name: "cursor", version: "1" });
    recordInitialize({ name: "cursor", version: "2" });
    const status = getMcpClientStatus();
    expect(status.initializeCount).toBe(3);
    expect(status.clients).toHaveLength(2);
  });

  it("stops reporting connected once a client has been silent past the window", () => {
    recordInitialize({ name: "cline" });
    clock += CLIENT_ACTIVE_WINDOW_MS + 1;
    expect(getMcpClientStatus().connected).toBe(false);
    expect(getMcpClientStatus().clients).toHaveLength(1);
  });

  it("refreshes the latest client on activity", () => {
    recordInitialize({ name: "cline" });
    clock += CLIENT_ACTIVE_WINDOW_MS - 10;
    recordActivity();
    clock += CLIENT_ACTIVE_WINDOW_MS - 10;
    expect(getMcpClientStatus().connected).toBe(true);
  });

  it("ignores activity before any client has initialized", () => {
    recordActivity();
    expect(getMcpClientStatus().connected).toBe(false);
  });

  it("exposes and clears the start error", () => {
    recordStartError("EADDRINUSE: port 4400");
    expect(getMcpClientStatus().startError).toBe("EADDRINUSE: port 4400");
    recordStartError(null);
    expect(getMcpClientStatus().startError).toBeNull();
  });
});

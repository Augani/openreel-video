import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  saveSecret,
  getSecret,
  deleteSecret,
  isSessionUnlocked,
  isMasterPasswordSet,
} from "./secure-storage";

interface KeychainMock {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

let keychain: KeychainMock;

beforeEach(() => {
  keychain = {
    get: vi.fn().mockResolvedValue("stored-key"),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { openreel: unknown }).openreel = {
    platform: "desktop",
    keychain,
  };
});

afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("secure-storage desktop branch", () => {
  it("saveSecret routes to keychain.set with id+value", async () => {
    await saveSecret("openai", "OpenAI", "sk-secret");
    expect(keychain.set).toHaveBeenCalledWith("openai", "sk-secret");
  });

  it("getSecret routes to keychain.get and returns its value", async () => {
    const value = await getSecret("openai");
    expect(keychain.get).toHaveBeenCalledWith("openai");
    expect(value).toBe("stored-key");
  });

  it("getSecret returns null when keychain has no entry", async () => {
    keychain.get.mockResolvedValueOnce(null);
    expect(await getSecret("missing")).toBeNull();
  });

  it("deleteSecret routes to keychain.delete", async () => {
    await deleteSecret("openai");
    expect(keychain.delete).toHaveBeenCalledWith("openai");
  });

  it("isSessionUnlocked is always true on desktop", () => {
    expect(isSessionUnlocked()).toBe(true);
  });

  it("isMasterPasswordSet resolves true on desktop", async () => {
    expect(await isMasterPasswordSet()).toBe(true);
  });
});

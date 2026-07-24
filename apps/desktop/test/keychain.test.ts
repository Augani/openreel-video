import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { KeyStore, type SafeStorageLike } from "../src/main/ipc/keychain";

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(s, "utf8"),
  decryptString: (b) => b.toString("utf8"),
});

let file: string;
beforeEach(() => {
  file = path.join(tmpdir(), `openreel-kc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
});
afterEach(async () => {
  await fs.rm(file, { force: true });
});

describe("KeyStore", () => {
  it("set/get/delete round-trips and persists ciphertext (not plaintext) on disk", async () => {
    const ks = new KeyStore(file, fakeSafe());
    await ks.set("openai", "sk-secret-value");
    expect(await ks.get("openai")).toBe("sk-secret-value");
    const raw = await fs.readFile(file, "utf8");
    expect(raw).not.toContain("sk-secret-value");
    await ks.delete("openai");
    expect(await ks.get("openai")).toBeNull();
  });

  it("get returns null for unknown id", async () => {
    expect(await new KeyStore(file, fakeSafe()).get("nope")).toBeNull();
  });

  it("set throws (never plaintext) when OS encryption is unavailable", async () => {
    await expect(new KeyStore(file, fakeSafe(false)).set("x", "y")).rejects.toThrow();
  });

  it("multiple ids coexist", async () => {
    const ks = new KeyStore(file, fakeSafe());
    await ks.set("openai", "a");
    await ks.set("elevenlabs", "b");
    expect(await ks.get("openai")).toBe("a");
    expect(await ks.get("elevenlabs")).toBe("b");
    await ks.delete("openai");
    expect(await ks.get("openai")).toBeNull();
    expect(await ks.get("elevenlabs")).toBe("b");
  });
});

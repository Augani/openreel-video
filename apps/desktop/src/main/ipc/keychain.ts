import { promises as fs } from "node:fs";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class KeyStore {
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
  ) {}

  private async readAll(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async writeAll(map: Record<string, string>): Promise<void> {
    await fs.writeFile(this.file, JSON.stringify(map), { mode: 0o600 });
  }

  async set(id: string, value: string): Promise<void> {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error(
        "OS key storage is unavailable on this system (no Keychain/DPAPI/libsecret). Cannot securely store the key.",
      );
    }
    const map = await this.readAll();
    map[id] = this.safe.encryptString(value).toString("base64");
    await this.writeAll(map);
  }

  async get(id: string): Promise<string | null> {
    const map = await this.readAll();
    const ciphertext = map[id];
    if (!ciphertext) return null;
    if (!this.safe.isEncryptionAvailable()) return null;
    return this.safe.decryptString(Buffer.from(ciphertext, "base64"));
  }

  async delete(id: string): Promise<void> {
    const map = await this.readAll();
    if (!(id in map)) return;
    delete map[id];
    await this.writeAll(map);
  }
}

let singleton: KeyStore | null = null;

export function getKeyStore(): KeyStore {
  if (!singleton) {
    // Resolved lazily so this module stays unit-testable without an Electron runtime.
    const { app, safeStorage } = require("electron") as typeof import("electron");
    const nodePath = require("node:path") as typeof import("node:path");
    singleton = new KeyStore(
      nodePath.join(app.getPath("userData"), "openreel-keys.json"),
      safeStorage,
    );
  }
  return singleton;
}

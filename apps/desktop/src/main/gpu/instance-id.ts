import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getKeyStore } from "../ipc/keychain";

const INSTANCE_ID_KEY = "gpu-instance-id";

export async function getOrCreateInstanceId(): Promise<string> {
  const store = getKeyStore();
  try {
    const existing = await store.get(INSTANCE_ID_KEY);
    if (existing) return existing;
    const id = randomUUID();
    await store.set(INSTANCE_ID_KEY, id);
    return id;
  } catch {
    const { app } = require("electron") as typeof import("electron");
    const file = path.join(app.getPath("userData"), "openreel-gpu-instance.txt");
    try {
      const fromFile = (await fs.readFile(file, "utf8")).trim();
      if (fromFile) return fromFile;
    } catch {}
    const id = randomUUID();
    await fs.writeFile(file, id, { mode: 0o600 });
    return id;
  }
}

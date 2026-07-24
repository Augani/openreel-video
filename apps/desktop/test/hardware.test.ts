import { describe, it, expect } from "vitest";
import { collectHardwareInfo } from "../src/main/ipc/hardware";
import { hardwareInfoSchema } from "../src/shared/ipc-contract";

describe("collectHardwareInfo", () => {
  it("returns a schema-valid object with real CPU/memory", async () => {
    const info = await collectHardwareInfo();
    expect(hardwareInfoSchema.safeParse(info).success).toBe(true);
    expect(info.cpu.logicalCores).toBeGreaterThan(0);
    expect(info.memory.totalBytes).toBeGreaterThan(0);
  });
});

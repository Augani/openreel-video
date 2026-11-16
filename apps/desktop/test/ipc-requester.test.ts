import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const ipc = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: ipc.register } }));
import { handle } from "../src/main/ipc";
beforeEach(() => vi.clearAllMocks());
describe("IPC requesting editor context", () => {
  it("passes the original requester with validated data", async () => {
    const callback=vi.fn(()=>"done"),event={sender:{id:7}};
    handle("context",z.object({name:z.string()}),callback);
    const listener=ipc.register.mock.calls[0][1];
    expect(await listener(event,{name:"Editor",extra:"discard"})).toBe("done");
    expect(callback).toHaveBeenCalledWith({name:"Editor"},event);
  });
  it("rejects invalid payloads before invoking the handler", async () => {
    const callback=vi.fn();handle("context",z.object({name:z.string()}),callback);
    await expect(ipc.register.mock.calls[0][1]({sender:{}},{name:7})).rejects.toThrow("invalid payload");
    expect(callback).not.toHaveBeenCalled();
  });
});

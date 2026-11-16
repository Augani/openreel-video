import { describe, it, expect } from "vitest";
import { CollabEngine, type CollabHost } from "./client-engine";
import type { ClientMessage } from "./protocol";

interface Doc {
  name: string;
  timeline?: undefined;
}

function setup(allowInit?: boolean) {
  const sent: ClientMessage[] = [];
  const host: CollabHost<Doc> = {
    getProject: () => ({ name: "my private project" }),
    clone: (p) => ({ ...p }),
    replaceProject: () => undefined,
    projectChanged: () => undefined,
    applyAction: async () => true,
    serialize: (p) => ({ ...p }),
    deserialize: (raw) => raw as Doc,
  };
  const engine = new CollabEngine<Doc>(host, { clientId: "c1", name: "n", key: "k", send: (m) => sent.push(m), allowInit });
  return { engine, sent };
}

const needsInitWelcome = { type: "welcome" as const, clientId: "c1", role: "editor" as const, seq: 0, ops: [], peers: [], locks: [], needsInit: true };

describe("CollabEngine initialisation", () => {
  it("uploads the open project when it is the first editor into an empty room", async () => {
    const { engine, sent } = setup();
    engine.handleOpen();
    await engine.handleMessage(needsInitWelcome);
    expect(sent.some((m) => m.type === "init")).toBe(true);
  });

  it("never uploads the open project when it joined someone else's room, whatever the server asks", async () => {
    const { engine, sent } = setup(false);
    engine.handleOpen();
    await engine.handleMessage(needsInitWelcome);
    expect(sent.some((m) => m.type === "init")).toBe(false);
    expect(engine.getSnapshot().status).toBe("syncing");
  });
});

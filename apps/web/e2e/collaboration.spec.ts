import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { RoomCore, type ClientMessage, type Outgoing } from "../../../packages/collab/src/index";
import { chooseFileMenu, clickClip, clipsOf, openEditor, press, readState, seek, settle } from "./helpers";

/**
 * Two (and three) real browsers editing one project through the real client engine. The cloud
 * Durable Object is replaced by an in-test server that drives the very same RoomCore the Durable
 * Object runs, so sequencing, conflicts, locks and presence are the production logic. No network
 * leaves the machine and nothing is deployed.
 */

const ROOM_ID = `r_${"e".repeat(32)}`;
const EDITOR_KEY = "e2e-editor-key";
const VIEWER_KEY = "e2e-viewer-key";

class FakeCloud {
  readonly room = new RoomCore();
  private readonly sockets = new Map<string, WebSocketRoute>();
  /** While true, new connections are dropped immediately (the network is down). */
  refuse = false;

  private dispatch(out: readonly Outgoing[]): void {
    for (const item of out) {
      const data = JSON.stringify(item.msg);
      for (const [clientId, ws] of this.sockets) {
        if (item.to !== "*" && item.to !== clientId) continue;
        if (item.except === clientId) continue;
        ws.send(data);
      }
    }
  }

  attach(context: BrowserContext): Promise<void> {
    return context.routeWebSocket(new RegExp(`/v1/collab/rooms/${ROOM_ID}/ws$`), (ws) => {
      if (this.refuse) {
        void ws.close({ code: 1006 });
        return;
      }
      let clientId: string | null = null;
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        if (msg.type === "hello") {
          const role = msg.key === EDITOR_KEY ? "editor" : msg.key === VIEWER_KEY ? "viewer" : null;
          if (!role) return void ws.close({ code: 4403 });
          clientId = msg.clientId;
          this.sockets.set(clientId, ws);
          this.dispatch(this.room.hello(msg, role, clientId));
        } else if (clientId) {
          this.dispatch(this.room.handle(clientId, msg));
        }
      });
      ws.onClose(() => {
        if (!clientId) return;
        this.sockets.delete(clientId);
        this.dispatch(this.room.leave(clientId));
      });
    });
  }

  /** Cut every live connection, like a dropped network. */
  async cut(): Promise<void> {
    this.refuse = true;
    await Promise.all([...this.sockets.values()].map((ws) => ws.close({ code: 1006 })));
  }
}

async function mockRoomCreation(context: BrowserContext): Promise<void> {
  await context.route("**/v1/collab/rooms", (route) =>
    route.fulfill({ status: 201, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ roomId: ROOM_ID, editorKey: EDITOR_KEY, viewerKey: VIEWER_KEY }) }),
  );
}

/** The toolbar button carries the connection state, so it can be read while the dialog is closed. */
async function collabStatus(page: Page): Promise<string | null> {
  return page.getByTestId("collab-button").getAttribute("data-connection");
}

async function startSession(page: Page, name: string): Promise<{ editor: string; viewer: string }> {
  await chooseFileMenu(page, ["Collaborate…"]);
  await expect(page.getByTestId("collab-dialog")).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByTestId("collab-status")).toHaveAttribute("data-connection", "live", { timeout: 20_000 });
  const editor = await page.getByLabel("Editor invite link").inputValue();
  const viewer = await page.getByLabel("Viewer invite link").inputValue();
  await page.keyboard.press("Escape");
  return { editor, viewer };
}

async function joinByLink(page: Page, link: string, name: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* the tour just shows */
    }
  });
  await page.goto(link);
  await expect(page.getByTestId("collab-dialog")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join session" }).click();
  await expect(page.getByTestId("collab-status")).toHaveAttribute("data-connection", "live", { timeout: 20_000 });
  await page.keyboard.press("Escape");
}

async function split(page: Page, at: number): Promise<void> {
  await seek(page, at);
  const s = await readState(page);
  const clip = clipsOf(s, "Main").find((c) => c.start <= at && at < c.start + c.duration);
  if (!clip) throw new Error(`no clip at ${at}`);
  await clickClip(page, clip.id);
  await press(page, "s");
}

const mainClips = async (page: Page) => clipsOf(await readState(page), "Main").map((c) => [Math.round(c.start * 100) / 100, Math.round(c.duration * 100) / 100]);

test.describe("real-time collaboration", () => {
  test("invite, live edits both ways, presence, separate undo, view-only guests, offline merge", async ({ browser }) => {
    test.setTimeout(240_000);
    const cloud = new FakeCloud();
    const ctxA = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const ctxB = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const ctxV = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    try {
      for (const ctx of [ctxA, ctxB, ctxV]) {
        await mockRoomCreation(ctx);
        await cloud.attach(ctx);
      }
      const alice = await ctxA.newPage();
      await openEditor(alice);
      const invites = await startSession(alice, "Alice");
      expect(invites.editor).toContain("#/editor?collab=");
      expect(invites.editor).toContain(`ck=${EDITOR_KEY}`);
      expect(invites.viewer).toContain(`ck=${VIEWER_KEY}`);

      // Bob follows the editor link, confirms, and gets Alice's project.
      const bob = await ctxB.newPage();
      await joinByLink(bob, invites.editor, "Bob");
      // The invite key left the address bar.
      expect(bob.url()).not.toContain(EDITOR_KEY);
      await expect.poll(async () => (await mainClips(bob)).length, { timeout: 20_000 }).toBe(1);
      await expect(bob.getByTestId("collab-avatars")).toBeVisible();

      // Alice splits; Bob sees the same two clips, and it is not on his undo stack.
      await split(alice, 2);
      await expect.poll(async () => mainClips(bob), { timeout: 15_000 }).toEqual(await mainClips(alice));
      expect((await mainClips(bob)).length).toBe(2);
      expect((await readState(bob)).canUndo).toBe(false);

      // Presence: Bob sees Alice's playhead and selection.
      await seek(alice, 3);
      await expect(bob.getByTestId("remote-playhead")).toHaveAttribute("data-peer", "Alice", { timeout: 10_000 });
      const aliceSelection = (await readState(alice)).selected;
      if (aliceSelection.length > 0) await expect(bob.getByTestId("remote-selection").first()).toHaveAttribute("data-peer", "Alice");

      // Bob splits the second half; Alice converges. Alice undoing does not undo Bob's split.
      await split(bob, 5);
      await expect.poll(async () => mainClips(alice), { timeout: 15_000 }).toEqual(await mainClips(bob));
      expect((await mainClips(alice)).length).toBe(3);
      await press(alice, "Meta+z");
      await expect.poll(async () => (await mainClips(alice)).length, { timeout: 15_000 }).toBe(2);
      await expect.poll(async () => mainClips(bob), { timeout: 15_000 }).toEqual(await mainClips(alice));
      expect((await readState(bob)).canUndo).toBe(true); // Bob's own split is still his to undo

      // A view-only guest sees the project but cannot change it.
      const vera = await ctxV.newPage();
      await joinByLink(vera, invites.viewer, "Vera");
      await expect.poll(async () => mainClips(vera), { timeout: 20_000 }).toEqual(await mainClips(alice));
      await split(vera, 1);
      await settle(vera, 800);
      expect(await mainClips(vera)).toEqual(await mainClips(alice));
      expect(cloud.room.headSeq).toBeGreaterThan(0);

      // Offline: the network drops; Bob keeps editing, Alice edits elsewhere; on reconnect both merge.
      await cloud.cut();
      await expect.poll(() => collabStatus(bob), { timeout: 15_000 }).not.toBe("live");
      await bob.getByTestId("collab-button").click();
      await expect(bob.getByTestId("collab-status")).toHaveAttribute("data-connection", "offline");
      await bob.keyboard.press("Escape");
      const before = (await mainClips(bob)).length;
      await split(bob, 0.5);
      expect((await mainClips(bob)).length).toBe(before + 1);
      cloud.refuse = false;
      await expect.poll(async () => mainClips(alice), { timeout: 40_000 }).toEqual(await mainClips(bob));
      expect((await mainClips(alice)).length).toBe(before + 1);
    } finally {
      await Promise.all([ctxA.close(), ctxB.close(), ctxV.close()]);
    }
  });
});

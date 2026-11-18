/**
 * Real-Electron end-to-end coverage of the AI onboarding path (WP-B, spec 2.4), against the BUILT app
 * and a local fake OpenAI-compatible server (no real keys, no network):
 *
 *  A1  the main-process Ollama probe (IPC) finds the fake /api/tags, and a custom endpoint passes the
 *      "Reply with OK." test plus the tool-call probe;
 *  A2  a generated fixture clip is dropped (file input), the project is created and the clip imported;
 *  A3  the starter chip + "Make my video" hand off to the editor with the chat docked, the model's tool
 *      calls apply to the real timeline, the coach marks appear, and "Undo last AI turn" restores it.
 *
 * The AI sheet is mounted through the e2e hook (window.__openreelE2E.onboardingAi.mount), so this suite
 * does not depend on the onboarding host that another work package owns.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_ONBOARDING_E2E=1:
 *   OPENREEL_DESKTOP_ONBOARDING_E2E=1 pnpm exec vitest run test/onboarding-ai-path.electron.test.ts
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const enabled =
  process.env.OPENREEL_DESKTOP_ONBOARDING_E2E === "1" &&
  fs.existsSync(FFMPEG) &&
  fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(root, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

const require = createRequire(path.join(root, "package.json"));
function loadPlaywright(): { _electron: any } {
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir!, "node_modules/playwright"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const E = (page: any, expression: string): Promise<any> =>
  page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);

// ---- fake OpenAI-compatible model server ------------------------------------------------------

interface FakeServer {
  url: string;
  requests: Array<{ path: string; body: any }>;
  close(): Promise<void>;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

/** First JSON object in a tool message that carries the wanted key, searched depth first. */
function findKey(content: string, key: string): string | undefined {
  try {
    const walk = (value: any): string | undefined => {
      if (!value || typeof value !== "object") return undefined;
      if (typeof value[key] === "string") return value[key];
      for (const child of Object.values(value)) {
        const hit = walk(child);
        if (hit) return hit;
      }
      return undefined;
    };
    return walk(JSON.parse(content));
  } catch {
    const match = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(content);
    return match?.[1];
  }
}

function completion(message: Record<string, unknown>, finish: string) {
  return {
    id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/** Scripted editing turn: list_media -> add_track -> add_clip -> a summary. Everything else is "OK". */
function answer(body: any): unknown {
  const tools: any[] = Array.isArray(body.tools) ? body.tools : [];
  const names = tools.map((t) => t?.function?.name);
  if (names.length === 0) return completion({ content: "OK" }, "stop");
  if (names.length === 1 && names[0] === "report_ready") {
    return completion({ content: null, tool_calls: [toolCall("call_probe", "report_ready", { ok: true })] }, "tool_calls");
  }
  const messages: any[] = body.messages ?? [];
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const toolMessages = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
  switch (toolMessages.length) {
    case 0:
      return completion({ content: null, tool_calls: [toolCall("call_media", "list_media", {})] }, "tool_calls");
    case 1:
      return completion({ content: null, tool_calls: [toolCall("call_track", "add_track", { trackType: "video" })] }, "tool_calls");
    case 2: {
      const mediaId = findKey(String(toolMessages[0].content), "id") ?? "";
      const trackId = findKey(String(toolMessages[1].content), "trackId") ?? findKey(String(toolMessages[1].content), "id") ?? "";
      return completion(
        { content: null, tool_calls: [toolCall("call_clip", "add_clip", { trackId, mediaId, startTime: 0 })] },
        "tool_calls",
      );
    }
    default:
      return completion({ content: "Added your clip to the timeline." }, "stop");
  }
}

async function startFakeServer(): Promise<FakeServer> {
  const requests: FakeServer["requests"] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json", ...CORS });
      res.end(JSON.stringify({ models: [{ name: "fake-tool-model", size: 1234 }] }));
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* not json */
      }
      requests.push({ path: req.url ?? "", body });
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        res.writeHead(200, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify(answer(body)));
        return;
      }
      res.writeHead(404, CORS).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// ---- app session ------------------------------------------------------------------------------

interface Session {
  app: any;
  page: any;
}
const sessions = new Set<Session>();
let work = "";
let fixture = "";
let fake: FakeServer;

async function launch(profile: string): Promise<Session> {
  const { _electron } = loadPlaywright();
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_OLLAMA_URL: fake.url },
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.reload();
  const session = { app, page };
  sessions.add(session);
  return session;
}

function killOpenSessions(): void {
  for (const session of [...sessions]) {
    try {
      session.app.process().kill("SIGKILL");
    } catch {
      /* already closed */
    }
  }
  sessions.clear();
}

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "onboarding-ai-e2e-"));
  fixture = path.join(work, "practice-clip.mp4");
  // A 2 second generated clip with a tone: original footage, no downloads.
  execFileSync(
    FFMPEG,
    [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      fixture,
    ],
    { stdio: "ignore" },
  );
  fake = await startFakeServer();
});
afterEach(killOpenSessions);
afterAll(async () => {
  killOpenSessions();
  if (enabled) {
    await fake.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

d("onboarding AI path (Electron, fake OpenAI-compatible server)", () => {
  it(
    "connects a model, imports a clip, hands off to the docked chat, applies the AI edit and undoes it",
    async () => {
      const { page } = await launch(path.join(work, "profile"));
      await page.getByRole("button", { name: /Horizontal/ }).waitFor({ timeout: 60_000 });

      // The e2e hook installs asynchronously after the first paint.
      await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.onboardingAi), undefined, { timeout: 60_000 });
      await E(page, "h.onboardingAi.mount()");
      const sheet = page.getByRole("dialog", { name: "Pick the AI that will edit for you" });
      await sheet.waitFor({ timeout: 30_000 });

      // A1: the Ollama probe runs in the main process and finds the fake /api/tags.
      await sheet.getByText("Detected · 1 model").waitFor({ timeout: 15_000 });

      await sheet.getByRole("radio", { name: /Custom endpoint/ }).click();
      await sheet.getByLabel("Endpoint URL").fill(`${fake.url}/v1`);
      await sheet.getByLabel("Model ID").fill("fake-tool-model");
      await sheet.getByRole("button", { name: "Test connection" }).click();
      await sheet.getByText(/editing tools work/).waitFor({ timeout: 30_000 });
      // The test sent a plain turn and a tool-call probe to the fake server.
      expect(fake.requests.some((r) => !(r.body.tools ?? []).length)).toBe(true);
      expect(fake.requests.some((r) => r.body.tools?.[0]?.function?.name === "report_ready")).toBe(true);
      await sheet.getByRole("button", { name: "Continue" }).click();

      // A2: bring a clip; the format defaults from the clip and the project is created.
      await page.getByRole("heading", { name: "Bring your clips" }).waitFor({ timeout: 10_000 });
      await page.getByLabel("Choose clip files").setInputFiles(fixture);
      await page.getByText("practice-clip.mp4").waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Describe your video" }).waitFor({ timeout: 120_000 });
      expect(await E(page, "h.project.getState().project.mediaLibrary.items.length")).toBe(1);
      expect(await E(page, "h.project.getState().project.timeline.tracks.flatMap(t => t.clips).length")).toBe(0);

      // A3: honest starter chips, then hand off.
      const chip = "Cut these into a 30-second highlight with a title and smooth transitions";
      await page.getByRole("button", { name: chip }).click();
      await page.getByRole("button", { name: "Make my video" }).click();

      await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
      await page.locator(".workspace-chat").waitFor({ timeout: 30_000 });
      await page.waitForFunction(
        () => {
          const chat = (window as any).__openreelE2E.chat.getState();
          return chat.status === "idle" && chat.messages.some((m: any) => m.role === "assistant" && m.text.includes("Added your clip"));
        },
        undefined,
        { timeout: 90_000 },
      );
      // The prompt went through the real chat store, with the editing tool catalog attached.
      const editingRequest = fake.requests.find((r) => r.body.tools?.length > 5);
      expect(editingRequest?.body.messages.some((m: any) => m.role === "user" && m.content === chip)).toBe(true);
      expect(await E(page, "h.project.getState().project.timeline.tracks.flatMap(t => t.clips).length")).toBe(1);

      // Coach marks: the undo mark follows the finished turn, then export, each once.
      const undoMark = page.locator('[data-coach-mark="undo"]');
      await undoMark.waitFor({ timeout: 15_000 });
      await expect(await undoMark.textContent()).toContain("Undo AI edit puts everything back");
      await undoMark.getByRole("button", { name: "Got it" }).click();
      const exportMark = page.locator('[data-coach-mark="export"]');
      await exportMark.waitFor({ timeout: 10_000 });
      await exportMark.getByRole("button", { name: "Done" }).click();
      await page.locator("[data-coach-mark]").waitFor({ state: "detached", timeout: 10_000 });

      // One undo step puts the timeline back.
      await page.getByRole("button", { name: "Assistant actions" }).click();
      await page.getByRole("menuitem", { name: "Undo last AI turn" }).click();
      await page.waitForFunction(
        () => (window as any).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).length === 0,
        undefined,
        { timeout: 15_000 },
      );
      expect(await E(page, "h.project.getState().project.mediaLibrary.items.length")).toBe(1);

      // The key never reached local storage (this connection had none and was not remembered).
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      expect(stored).not.toContain("openreel-ai-connection");
      await sleep(100);
    },
    360_000,
  );
});

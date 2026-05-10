#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cwd, env, platform } from "node:process";

const HOST = env.CODEX_LOCAL_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(env.CODEX_LOCAL_BRIDGE_PORT || "14567");
const MAX_BODY_BYTES = Number(env.CODEX_LOCAL_BRIDGE_MAX_BODY_BYTES || "65536");
const CODEX_BIN = env.CODEX_BIN || (platform === "win32" ? "codex.cmd" : "codex");
const CODEX_TIMEOUT_MS = Number(env.CODEX_LOCAL_BRIDGE_TIMEOUT_MS || "120000");
const ALLOWED_ORIGINS = new Set(
  (env.CODEX_LOCAL_BRIDGE_ORIGINS ||
    [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
      "https://openreel.video",
      "https://app.openreel.video",
    ].join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

if (!LOOPBACK_HOSTS.has(HOST)) {
  throw new Error("CODEX_LOCAL_BRIDGE_HOST must be a loopback host.");
}

function originAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function writeCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function runCodexText(system, prompt) {
  const finalPrompt = [
    system,
    "",
    "Return only the final text. Do not include Markdown fences or explanations.",
    "",
    "Input:",
    prompt,
  ].join("\n");

  return new Promise((resolve, reject) => {
    const child = spawn(
      CODEX_BIN,
      ["exec", "--ask-for-approval", "never", "--sandbox", "read-only", "--cd", cwd(), finalPrompt],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex exec timed out."));
    }, CODEX_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `codex exec exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  writeCors(res, origin);

  if (!originAllowed(origin)) {
    sendJson(res, 403, { error: "Origin is not allowed." });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, provider: "codex-local" });
    return;
  }

  if (req.method === "POST" && req.url === "/v1/text") {
    try {
      const body = await readJson(req);
      const system = typeof body.system === "string" ? body.system : "";
      const prompt = typeof body.prompt === "string" ? body.prompt : "";

      if (!prompt.trim()) {
        sendJson(res, 400, { error: "Missing prompt." });
        return;
      }

      const text = await runCodexText(system, prompt);
      sendJson(res, 200, { text });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Local bridge listening on http://${HOST}:${PORT}`);
});

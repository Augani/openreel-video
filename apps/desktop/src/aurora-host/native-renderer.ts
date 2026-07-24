import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  Mesh,
  RayTraceOptions,
} from "../../../../packages/core/src/creation/index";
import type { AuroraRenderedFrame } from "./render-preview";

const REQUEST_MAGIC = Buffer.from([0x4f, 0x52, 0x41, 0x52, 0x51, 0x31, 0x00, 0x00]);
const RESPONSE_MAGIC = Buffer.from([0x4f, 0x52, 0x41, 0x52, 0x53, 0x31, 0x00, 0x00]);
const EXECUTABLE_BASENAME =
  process.platform === "win32"
    ? "creation_aurora_renderer.exe"
    : "creation_aurora_renderer";
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;

function parseHexColor(
  value: string | undefined,
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  if (!value || value === "transparent") return fallback;
  const normalized = value.trim().replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
    ? [r, g, b]
    : fallback;
}

function writeFloatTriplet(
  buffer: Buffer,
  offset: number,
  value: readonly [number, number, number],
): number {
  buffer.writeFloatLE(value[0], offset);
  buffer.writeFloatLE(value[1], offset + 4);
  buffer.writeFloatLE(value[2], offset + 8);
  return offset + 12;
}

function buildNativeRenderRequest(mesh: Mesh, options: RayTraceOptions): Buffer {
  const colors = mesh.colors ?? new Float32Array(0);
  const headerSize = 8 + 4 * 7 + 4 * 10 + 4 * 5 + 4 * 3 + 4 * 3;
  const totalSize =
    headerSize +
    mesh.positions.byteLength +
    mesh.normals.byteLength +
    colors.byteLength +
    mesh.indices.byteLength;
  const buffer = Buffer.alloc(totalSize);
  REQUEST_MAGIC.copy(buffer, 0);

  let offset = REQUEST_MAGIC.byteLength;
  buffer.writeInt32LE(options.width, offset);
  offset += 4;
  buffer.writeInt32LE(options.height, offset);
  offset += 4;
  buffer.writeInt32LE(mesh.positions.length, offset);
  offset += 4;
  buffer.writeInt32LE(mesh.normals.length, offset);
  offset += 4;
  buffer.writeInt32LE(colors.length, offset);
  offset += 4;
  buffer.writeInt32LE(mesh.indices.length, offset);
  offset += 4;

  offset = writeFloatTriplet(buffer, offset, [
    options.camera.position.x,
    options.camera.position.y,
    options.camera.position.z,
  ]);
  offset = writeFloatTriplet(buffer, offset, [
    options.camera.target.x,
    options.camera.target.y,
    options.camera.target.z,
  ]);
  offset = writeFloatTriplet(buffer, offset, [
    options.camera.up?.x ?? 0,
    options.camera.up?.y ?? 1,
    options.camera.up?.z ?? 0,
  ]);
  buffer.writeFloatLE(options.camera.fov ?? 45, offset);
  offset += 4;

  const light = options.light ?? { direction: { x: 0.4, y: 0.9, z: 0.5 } };
  offset = writeFloatTriplet(buffer, offset, [
    light.direction.x,
    light.direction.y,
    light.direction.z,
  ]);
  buffer.writeFloatLE(light.ambient ?? 0.2, offset);
  offset += 4;
  buffer.writeFloatLE(light.intensity ?? 0.9, offset);
  offset += 4;

  offset = writeFloatTriplet(
    buffer,
    offset,
    parseHexColor(options.baseColor, [0.58, 0.64, 0.72]),
  );
  offset = writeFloatTriplet(
    buffer,
    offset,
    parseHexColor(options.background, [0.06, 0.09, 0.16]),
  );
  buffer.writeInt32LE(options.shadows !== false ? 1 : 0, offset);
  offset += 4;

  Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength).copy(
    buffer,
    offset,
  );
  offset += mesh.positions.byteLength;
  Buffer.from(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.byteLength).copy(
    buffer,
    offset,
  );
  offset += mesh.normals.byteLength;
  if (colors.byteLength > 0) {
    Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength).copy(
      buffer,
      offset,
    );
    offset += colors.byteLength;
  }
  Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength).copy(
    buffer,
    offset,
  );
  return buffer;
}

function parseNativeRenderResponse(buffer: Buffer): AuroraRenderedFrame {
  if (buffer.byteLength < 36) {
    throw new Error("Aurora native renderer response was truncated.");
  }
  if (!buffer.subarray(0, RESPONSE_MAGIC.byteLength).equals(RESPONSE_MAGIC)) {
    throw new Error("Aurora native renderer response had an invalid header.");
  }

  let offset = RESPONSE_MAGIC.byteLength;
  const width = buffer.readInt32LE(offset);
  offset += 4;
  const height = buffer.readInt32LE(offset);
  offset += 4;
  const coveredPixels = buffer.readInt32LE(offset);
  offset += 4;
  const shadowedPixels = buffer.readInt32LE(offset);
  offset += 4;
  const renderMs = buffer.readDoubleLE(offset);
  offset += 8;
  const rgbaLength = buffer.readInt32LE(offset);
  offset += 4;
  const expectedLength = width * height * 4;
  if (rgbaLength !== expectedLength || buffer.byteLength !== offset + rgbaLength) {
    throw new Error("Aurora native renderer response had an invalid RGBA payload.");
  }

  return {
    backend: "native",
    rgba: Uint8Array.from(buffer.subarray(offset, offset + rgbaLength)),
    width,
    height,
    coveredPixels,
    shadowedPixels,
    renderMs,
  };
}

function nativeRendererCandidates(): readonly string[] {
  const candidates = new Set<string>();
  const explicit = process.env.OPENREEL_AURORA_RENDERER_PATH?.trim();
  if (explicit) {
    candidates.add(path.resolve(explicit));
  }

  const processResourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const packaged = processResourcesPath
    ? path.join(processResourcesPath, "aurora", EXECUTABLE_BASENAME)
    : "";
  if (packaged) candidates.add(packaged);

  const here = __dirname;
  candidates.add(
    path.resolve(here, "../../resources/aurora", EXECUTABLE_BASENAME),
  );
  candidates.add(
    path.resolve(here, "../../../../packages/creation-core/build", EXECUTABLE_BASENAME),
  );
  candidates.add(
    path.resolve(process.cwd(), "packages/creation-core/build", EXECUTABLE_BASENAME),
  );

  let current = path.resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.add(
      path.join(current, "packages", "creation-core", "build", EXECUTABLE_BASENAME),
    );
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return [...candidates];
}

export function findNativeAuroraRendererPath(): string | null {
  const explicit = process.env.OPENREEL_AURORA_RENDERER_PATH?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    return existsSync(resolved) ? resolved : null;
  }
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    return null;
  }
  for (const candidate of nativeRendererCandidates()) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function runNativeRenderer(
  executablePath: string,
  requestPath: string,
  responsePath: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executablePath, ["render", requestPath, responsePath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > 16_384) {
        stderr = stderr.slice(-16_384);
      }
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          stderr.trim() ||
            `Aurora native renderer exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

class NativeAuroraRendererClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = Buffer.alloc(0);
  private pending:
    | {
        readonly resolve: (frame: AuroraRenderedFrame) => void;
        readonly reject: (error: Error) => void;
        expectedBytes: number | null;
      }
    | null = null;
  private queue = Promise.resolve();

  constructor(private readonly executablePath: string) {}

  render(mesh: Mesh, options: RayTraceOptions): Promise<AuroraRenderedFrame> {
    const run = this.queue.then(() => this.renderOnce(mesh, options));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    this.stdoutBuffer = Buffer.alloc(0);
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      pending.reject(new Error("Aurora native renderer client disposed"));
    }
    child?.kill();
  }

  private renderOnce(mesh: Mesh, options: RayTraceOptions): Promise<AuroraRenderedFrame> {
    const child = this.ensureChild();
    const payload = buildNativeRenderRequest(mesh, options);
    const message = Buffer.alloc(4 + payload.byteLength);
    message.writeUInt32LE(payload.byteLength, 0);
    payload.copy(message, 4);

    return new Promise<AuroraRenderedFrame>((resolve, reject) => {
      this.pending = { resolve, reject, expectedBytes: null };
      child.stdin.write(message, (error) => {
        if (!error) return;
        const current = this.pending;
        this.pending = null;
        if (current) {
          current.reject(error);
        }
        this.fail(error);
      });
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const child = spawn(this.executablePath, ["serve"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer | string) => {
      this.handleStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", (error) => this.fail(error));
    child.once("close", (code, signal) => {
      this.fail(
        new Error(
          `Aurora native renderer service exited (${signal ?? code ?? "unknown"})`,
        ),
      );
    });
    child.stderr.on("data", () => {
      // stderr is only surfaced if the process exits/fails; we keep the
      // transport hot and avoid buffering logs here to keep the client simple.
    });
    child.stdin.on("error", (error) => this.fail(error));
    return child;
  }

  private handleStdout(chunk: Buffer): void {
    if (!this.pending) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    if (this.pending.expectedBytes === null) {
      if (this.stdoutBuffer.byteLength < 4) return;
      this.pending.expectedBytes = this.stdoutBuffer.readUInt32LE(0);
      if (
        this.pending.expectedBytes <= 0 ||
        this.pending.expectedBytes > MAX_RESPONSE_BYTES
      ) {
        this.fail(
          new Error(
            `Aurora native renderer returned an invalid response length (${this.pending.expectedBytes}).`,
          ),
        );
        return;
      }
    }

    const totalBytes = 4 + (this.pending.expectedBytes ?? 0);
    if (this.stdoutBuffer.byteLength < totalBytes) return;

    const payload = this.stdoutBuffer.subarray(4, totalBytes);
    this.stdoutBuffer = this.stdoutBuffer.subarray(totalBytes);
    const pending = this.pending;
    this.pending = null;

    try {
      pending.resolve(parseNativeRenderResponse(payload));
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const child = this.child;
    const pending = this.pending;
    this.pending = null;
    this.child = null;
    this.stdoutBuffer = Buffer.alloc(0);
    if (pending) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
    if (child && !child.killed) {
      child.kill();
    }
  }
}

let sharedNativeAuroraRendererClient: NativeAuroraRendererClient | null = null;
let sharedNativeAuroraRendererPath: string | null = null;
let nativeRendererExitHookInstalled = false;

function getNativeAuroraRendererClient(
  executablePath: string,
): NativeAuroraRendererClient {
  if (
    !sharedNativeAuroraRendererClient ||
    sharedNativeAuroraRendererPath !== executablePath
  ) {
    sharedNativeAuroraRendererClient?.dispose();
    sharedNativeAuroraRendererClient = new NativeAuroraRendererClient(executablePath);
    sharedNativeAuroraRendererPath = executablePath;
  }
  if (!nativeRendererExitHookInstalled) {
    nativeRendererExitHookInstalled = true;
    process.once("exit", () => {
      sharedNativeAuroraRendererClient?.dispose();
      sharedNativeAuroraRendererClient = null;
      sharedNativeAuroraRendererPath = null;
    });
  }
  return sharedNativeAuroraRendererClient;
}

export function resetNativeAuroraRendererClientForTests(): void {
  sharedNativeAuroraRendererClient?.dispose();
  sharedNativeAuroraRendererClient = null;
  sharedNativeAuroraRendererPath = null;
}

async function renderMeshWithNativeAuroraRendererViaFiles(
  executablePath: string,
  mesh: Mesh,
  options: RayTraceOptions,
): Promise<AuroraRenderedFrame | null> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openreel-aurora-native-"));
  const requestPath = path.join(tempDir, "request.bin");
  const responsePath = path.join(tempDir, "response.bin");

  try {
    await writeFile(requestPath, buildNativeRenderRequest(mesh, options));
    await runNativeRenderer(executablePath, requestPath, responsePath);
    const response = await readFile(responsePath);
    return parseNativeRenderResponse(response);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function renderMeshWithNativeAuroraRenderer(
  mesh: Mesh,
  options: RayTraceOptions,
): Promise<AuroraRenderedFrame | null> {
  const executablePath = findNativeAuroraRendererPath();
  if (!executablePath) {
    return null;
  }

  try {
    const client = getNativeAuroraRendererClient(executablePath);
    return await client.render(mesh, options);
  } catch (serviceError) {
    try {
      return await renderMeshWithNativeAuroraRendererViaFiles(
        executablePath,
        mesh,
        options,
      );
    } catch (fileError) {
      const serviceMessage =
        serviceError instanceof Error ? serviceError.message : String(serviceError);
      const fileMessage =
        fileError instanceof Error ? fileError.message : String(fileError);
      throw new Error(
        `Aurora native renderer failed via stdio service (${serviceMessage}) and file fallback (${fileMessage}).`,
      );
    }
  }
}

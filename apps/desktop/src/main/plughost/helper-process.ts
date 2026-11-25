import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { FrameDecoder, FrameError, encodeFrame } from "../../shared/plughost-protocol";

/**
 * One helper process and the request/response conversation with it.
 *
 * Crash isolation lives here: whatever the plugin does (segfault, infinite loop, garbage on the pipe, exit), the effect on
 * the editor is a rejected promise with a reason. Every request has a timeout; a timeout kills the helper (a hung plugin
 * cannot be asked nicely); the process is always reaped.
 */

/** "plugin": the helper answered with an error (the plugin refused or failed validly); the others mean the helper or the plugin broke. */
export type HelperFailureKind = "crash" | "timeout" | "protocol" | "spawn" | "closed" | "plugin";

export class HelperError extends Error {
  constructor(readonly kind: HelperFailureKind, message: string, readonly detail?: string) {
    super(message);
    this.name = "HelperError";
  }
}

export interface HelperSpawnOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly spawn?: typeof nodeSpawn;
}

interface Pending {
  readonly resolve: (message: HelperReply) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly type: string;
}

export interface HelperReply {
  readonly json: Record<string, unknown>;
  readonly binary: Uint8Array;
}

const STDERR_TAIL_BYTES = 4000;

export class HelperProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrTail = "";
  private ended: HelperError | null = null;

  constructor(private readonly options: HelperSpawnOptions) {
    super();
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get alive(): boolean {
    return this.child !== null && this.ended === null;
  }

  /** Spawns the helper and waits for its hello. Rejects with kind "spawn" when the binary cannot start. */
  async start(timeoutMs = 10_000): Promise<Record<string, unknown>> {
    const spawn = this.options.spawn ?? nodeSpawn;
    try {
      this.child = spawn(this.options.command, [...this.options.args], { stdio: ["pipe", "pipe", "pipe"], env: this.options.env ?? process.env, windowsHide: true });
    } catch (error) {
      throw new HelperError("spawn", `the plugin helper could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
    const child = this.child;
    child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });
    child.stdin?.on("error", () => undefined);
    child.once("error", (error) => this.end(new HelperError("spawn", `the plugin helper could not start: ${error.message}`)));
    child.once("exit", (code, signal) => {
      const accessViolation = code !== null && (code >>> 0) === 0xc0000005;
      const reason = signal ? `was killed by ${signal}` : `exited with code ${code}${accessViolation ? " (access violation)" : ""}`;
      this.end(new HelperError("crash", `the plugin helper ${reason}`, this.stderrTail.trim() || undefined));
    });
    const hello = await this.request({ type: "hello" }, timeoutMs);
    return hello.json;
  }

  private onData(chunk: Buffer): void {
    let frames;
    try {
      frames = this.decoder.push(chunk);
    } catch (error) {
      this.kill(new HelperError("protocol", `the plugin helper sent an unreadable frame: ${error instanceof FrameError ? error.message : String(error)}`));
      return;
    }
    for (const frame of frames) {
      const reqId = frame.json.reqId;
      const pending = typeof reqId === "number" ? this.pending.get(reqId) : undefined;
      if (!pending) {
        this.emit("event", frame.json, frame.binary);
        continue;
      }
      this.pending.delete(reqId as number);
      clearTimeout(pending.timer);
      if (frame.json.type === "error") pending.reject(new HelperError("plugin", String(frame.json.message ?? "the plugin reported an error")));
      else pending.resolve({ json: frame.json, binary: frame.binary });
    }
  }

  request(message: Record<string, unknown>, timeoutMs: number, binary?: Uint8Array): Promise<HelperReply> {
    if (this.ended) return Promise.reject(this.ended);
    const child = this.child;
    if (!child?.stdin || !child.stdin.writable) return Promise.reject(new HelperError("closed", "the plugin helper is not running"));
    const reqId = this.nextId++;
    const type = String(message.type);
    return new Promise<HelperReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        const error = new HelperError("timeout", `the plugin did not answer "${type}" within ${Math.round(timeoutMs / 1000)} s`, this.stderrTail.trim() || undefined);
        reject(error);
        this.kill(error);
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer, type });
      try {
        child.stdin!.write(encodeFrame({ ...message, reqId }, binary));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(new HelperError("closed", `could not talk to the plugin helper: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }

  private end(error: HelperError): void {
    if (this.ended) return;
    this.ended = error;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.emit("exit", error);
  }

  /** Kills the process (SIGKILL: a hung plugin ignores everything else) and fails every request in flight with `reason`. */
  kill(reason?: HelperError): void {
    this.end(reason ?? new HelperError("closed", "the plugin helper was stopped"));
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }

  /** Asks the helper to leave, then makes sure it is gone. */
  async close(): Promise<void> {
    if (!this.ended) {
      try {
        await this.request({ type: "close" }, 2000);
      } catch {
        /* the kill below covers it */
      }
    }
    this.child?.stdin?.end();
    this.kill(new HelperError("closed", "the plugin helper was stopped"));
  }
}

import type { JobKind, JobResult, JobRunner } from "@openreel/agent";

export interface GpuRunnerConfig {
  readonly gpuBaseUrl: string;
  readonly brokerBaseUrl: string;
  readonly bundleId: string;
  readonly instanceId: string;
  /** Broker platform leg; "desktop" uses the unattested open path. */
  readonly platform?: string;
  readonly fetchFn?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly maxPollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const TERMINAL_OK = new Set(["succeeded", "completed", "complete", "done"]);
const TERMINAL_FAIL = new Set(["failed", "error", "cancelled", "canceled"]);

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface TokenCache {
  token: string;
  exp: number;
}

/**
 * Mints short-lived GPU JWTs via the auth broker's open (unattested) leg, so a
 * server-side agent can authorize GPU jobs without a bundled secret. Tokens are
 * cached until shortly before expiry.
 */
export class GpuTokenProvider {
  private cached: TokenCache | null = null;

  constructor(private readonly config: GpuRunnerConfig) {}

  invalidate(): void {
    this.cached = null;
  }

  private get fetchFn(): typeof fetch {
    return this.config.fetchFn ?? fetch;
  }

  private nowSeconds(): number {
    return Math.floor((this.config.now ? this.config.now() : Date.now()) / 1000);
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Bundle-ID": this.config.bundleId,
    };
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.exp - this.nowSeconds() > 60) {
      return this.cached.token;
    }
    const platform = this.config.platform ?? "desktop";
    const challengeRes = await this.fetchFn(`${this.config.brokerBaseUrl}/auth/challenge`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform, instanceId: this.config.instanceId }),
    });
    if (!challengeRes.ok) {
      throw new Error(`auth challenge failed: ${challengeRes.status}`);
    }
    const challenge = (await challengeRes.json()) as { challengeId?: string };
    if (!challenge.challengeId) {
      throw new Error("auth challenge missing challengeId");
    }
    const tokenRes = await this.fetchFn(`${this.config.brokerBaseUrl}/auth/token`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform, challengeId: challenge.challengeId }),
    });
    if (!tokenRes.ok) {
      throw new Error(`auth token mint failed: ${tokenRes.status}`);
    }
    const minted = (await tokenRes.json()) as { token?: string; exp?: number };
    if (!minted.token || typeof minted.exp !== "number") {
      throw new Error("auth token response malformed");
    }
    this.cached = { token: minted.token, exp: minted.exp };
    return minted.token;
  }
}

interface GpuJobStatus {
  jobID: string;
  status: string;
  progress?: number;
  message?: string;
  manifestURL?: string;
  error?: string;
}

/**
 * Builds a JobRunner that delegates the agent's runJob calls (export, transcribe,
 * upscale, remove-background, …) to the GPU worker at `ai.openreel.video`,
 * authorized by the broker. Submits the job, polls to a terminal state, and
 * returns the job reference / manifest. Requires live GPU + broker infra.
 */
export function createGpuJobRunner(config: GpuRunnerConfig): JobRunner {
  const tokens = new GpuTokenProvider(config);
  const fetchFn = config.fetchFn ?? fetch;
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const maxPollMs = config.maxPollMs ?? 10 * 60 * 1000;
  const sleep = config.sleep ?? realSleep;
  const now = config.now ?? Date.now;

  async function authedFetch(url: string, init: RequestInit): Promise<Response> {
    const withAuth = async (): Promise<Response> => {
      const token = await tokens.getToken();
      return fetchFn(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${token}`,
          "X-Bundle-ID": config.bundleId,
          Accept: "application/json",
        },
      });
    };
    let res = await withAuth();
    if (res.status === 401) {
      tokens.invalidate();
      res = await withAuth();
    }
    return res;
  }

  return async (kind: JobKind, params: Record<string, unknown>): Promise<JobResult> => {
    try {
      const submitRes = await authedFetch(`${config.gpuBaseUrl}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, params }),
      });
      if (!submitRes.ok) {
        return { ok: false, error: `GPU submit failed: ${submitRes.status}` };
      }
      const created = (await submitRes.json()) as GpuJobStatus;
      const jobID = created.jobID;
      if (!jobID) return { ok: false, error: "GPU submit returned no jobID" };

      const deadline = now() + maxPollMs;
      let status = created.status;
      let last: GpuJobStatus = created;
      while (!TERMINAL_OK.has(status.toLowerCase()) && !TERMINAL_FAIL.has(status.toLowerCase())) {
        if (now() >= deadline) {
          return { ok: false, error: `GPU job ${jobID} timed out (last status: ${status})` };
        }
        await sleep(pollIntervalMs);
        const statusRes = await authedFetch(`${config.gpuBaseUrl}/jobs/${jobID}`, {
          method: "GET",
        });
        if (!statusRes.ok) {
          return { ok: false, error: `GPU status failed: ${statusRes.status}` };
        }
        last = (await statusRes.json()) as GpuJobStatus;
        status = last.status;
      }

      if (TERMINAL_FAIL.has(status.toLowerCase())) {
        return { ok: false, error: last.error ?? `GPU job ${jobID} ${status}` };
      }
      return {
        ok: true,
        data: { jobID, status, manifestURL: last.manifestURL },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

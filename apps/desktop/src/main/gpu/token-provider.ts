export interface TokenProviderDeps {
  brokerBaseUrl: string;
  bundleId: string;
  instanceId: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  token: string;
  exp: number;
}

const REFRESH_LEEWAY_SECONDS = 60;

export class GpuTokenProvider {
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly deps: TokenProviderDeps) {}

  invalidate(): void {
    this.cached = null;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.exp - this.nowSeconds() > REFRESH_LEEWAY_SECONDS) {
      return this.cached.token;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.mint().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private nowSeconds(): number {
    return Math.floor((this.deps.now ? this.deps.now() : Date.now()) / 1000);
  }

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Bundle-ID": this.deps.bundleId,
    };
  }

  private async mint(): Promise<string> {
    const challengeRes = await this.fetchFn(`${this.deps.brokerBaseUrl}/auth/challenge`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform: "desktop", instanceId: this.deps.instanceId }),
    });
    if (!challengeRes.ok) {
      throw new Error(`auth challenge failed: ${challengeRes.status}`);
    }
    const challenge = (await challengeRes.json()) as { challengeId?: string };
    if (!challenge.challengeId) {
      throw new Error("auth challenge missing challengeId");
    }

    const tokenRes = await this.fetchFn(`${this.deps.brokerBaseUrl}/auth/token`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform: "desktop", challengeId: challenge.challengeId }),
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

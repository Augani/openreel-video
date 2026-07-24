import type { AiCloudJobCreated, AiCloudJobStatusResponse } from "@openreel/core";

const BUNDLE_ID = "com.openreel.video";
const INSTANCE_ID_STORAGE_KEY = "openreel.gpu.instanceId";
const REFRESH_LEEWAY_SECONDS = 60;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function brokerBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_OPENREEL_AUTH_BROKER_BASE_URL as string | undefined;
  return trimTrailingSlash(fromEnv && fromEnv.length > 0 ? fromEnv : "https://api.openreel.video");
}

function gpuBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_OPENREEL_GPU_BASE_URL as string | undefined;
  return trimTrailingSlash(fromEnv && fromEnv.length > 0 ? fromEnv : "https://ai.openreel.video");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function getInstanceId(): string {
  try {
    const existing = localStorage.getItem(INSTANCE_ID_STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(INSTANCE_ID_STORAGE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export class GpuRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GpuRequestError";
  }
}

interface NormalizedPresign {
  uploadUrl: string;
  mediaKey: string;
  downloadUrl?: string;
  headers: Record<string, string>;
}

export function normalizePresign(raw: Record<string, unknown>): NormalizedPresign {
  const uploadUrl = (raw.uploadURL ?? raw.putUrl) as string | undefined;
  const mediaKey = (raw.mediaKey ?? raw.objectKey) as string | undefined;
  if (!uploadUrl || !mediaKey) {
    throw new Error("presign response missing putUrl/uploadURL or objectKey/mediaKey");
  }
  const downloadUrl = (raw.getUrl ?? raw.downloadURL ?? raw.downloadUrl) as string | undefined;
  const headers = (raw.headers as Record<string, string> | undefined) ?? {};
  return { uploadUrl, mediaKey, downloadUrl, headers };
}

interface SubmitArgs {
  kind: string;
  params: Record<string, unknown>;
  mediaKey?: string;
  mediaFilename?: string;
}

export function buildSubmitBody(args: SubmitArgs): string {
  const request = { kind: args.kind, params: args.params };
  if (args.mediaKey) {
    return JSON.stringify({ request, mediaKey: args.mediaKey, mediaFilename: args.mediaFilename });
  }
  return JSON.stringify(request);
}

export class WebGpuTokenProvider {
  private cached: { token: string; exp: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly broker: string,
    private readonly bundleId: string,
    private readonly instanceId: string,
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.exp - nowSeconds() > REFRESH_LEEWAY_SECONDS) {
      return this.cached.token;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.mint().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Bundle-ID": this.bundleId,
    };
  }

  private async mint(): Promise<string> {
    const challengeRes = await fetch(`${this.broker}/auth/challenge`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform: "desktop", instanceId: this.instanceId }),
    });
    if (!challengeRes.ok) {
      throw new GpuRequestError(`auth challenge failed: ${challengeRes.status}`, challengeRes.status);
    }
    const challenge = (await challengeRes.json()) as { challengeId?: string };
    if (!challenge.challengeId) {
      throw new Error("auth challenge missing challengeId");
    }

    const tokenRes = await fetch(`${this.broker}/auth/token`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform: "desktop", challengeId: challenge.challengeId }),
    });
    if (!tokenRes.ok) {
      throw new GpuRequestError(`auth token mint failed: ${tokenRes.status}`, tokenRes.status);
    }
    const minted = (await tokenRes.json()) as { token?: string; exp?: number };
    if (!minted.token || typeof minted.exp !== "number") {
      throw new Error("auth token response malformed");
    }
    this.cached = { token: minted.token, exp: minted.exp };
    return minted.token;
  }
}

export interface WebGpuJobClientDeps {
  gpuBaseUrl: string;
  brokerBaseUrl: string;
  bundleId: string;
  tokenProvider: Pick<WebGpuTokenProvider, "getToken" | "invalidate">;
}

export class WebGpuJobClient {
  constructor(private readonly deps: WebGpuJobClientDeps) {}

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.deps.tokenProvider.getToken();
    return {
      Authorization: `Bearer ${token}`,
      "X-Bundle-ID": this.deps.bundleId,
      Accept: "application/json",
    };
  }

  private async authedFetch(url: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Response> {
    const baseHeaders = (init.headers as Record<string, string> | undefined) ?? {};
    let res = await fetch(url, { ...init, headers: { ...baseHeaders, ...(await this.authHeaders()) } });
    if (res.status === 401) {
      this.deps.tokenProvider.invalidate();
      res = await fetch(url, { ...init, headers: { ...baseHeaders, ...(await this.authHeaders()) } });
    }
    return res;
  }

  async uploadMedia(args: { blob: Blob; filename: string; contentType?: string }): Promise<{ mediaKey: string; downloadUrl?: string }> {
    const presignRes = await this.authedFetch(`${this.deps.brokerBaseUrl}/auth/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: args.filename, contentType: args.contentType }),
    });
    if (!presignRes.ok) {
      throw new GpuRequestError(`presign failed: ${presignRes.status}`, presignRes.status);
    }
    const presign = normalizePresign((await presignRes.json()) as Record<string, unknown>);
    const putHeaders: Record<string, string> = { ...presign.headers };
    const contentType = args.contentType || args.blob.type;
    if (contentType && !putHeaders["Content-Type"] && !putHeaders["content-type"]) {
      putHeaders["Content-Type"] = contentType;
    }
    const putRes = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: putHeaders,
      body: args.blob,
    });
    if (!putRes.ok) {
      throw new GpuRequestError(`upload PUT failed: ${putRes.status}`, putRes.status);
    }
    return { mediaKey: presign.mediaKey, downloadUrl: presign.downloadUrl };
  }

  async submitJob(args: SubmitArgs): Promise<AiCloudJobCreated> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildSubmitBody(args),
    });
    if (res.status === 503) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new GpuRequestError("queue full", 503, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!res.ok) {
      throw new GpuRequestError(`submit failed: ${res.status}`, res.status);
    }
    return (await res.json()) as AiCloudJobCreated;
  }

  async jobStatus(jobID: string): Promise<AiCloudJobStatusResponse> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}`, { method: "GET" });
    if (!res.ok) {
      throw new GpuRequestError(`status failed: ${res.status}`, res.status);
    }
    return (await res.json()) as AiCloudJobStatusResponse;
  }

  async fetchManifest(jobID: string): Promise<Record<string, unknown>> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}/manifest`, { method: "GET" });
    if (!res.ok) {
      throw new GpuRequestError(`manifest failed: ${res.status}`, res.status);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async downloadArtifact(jobID: string, relativePath: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
    const res = await this.authedFetch(
      `${this.deps.gpuBaseUrl}/jobs/${jobID}/artifacts/${relativePath}`,
      { method: "GET" },
    );
    if (!res.ok) {
      throw new GpuRequestError(`artifact download failed: ${res.status}`, res.status);
    }
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const bytes = await res.arrayBuffer();
    return { bytes, mime };
  }

  async cancelJob(jobID: string): Promise<AiCloudJobStatusResponse> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}`, { method: "DELETE" });
    if (!res.ok) {
      throw new GpuRequestError(`cancel failed: ${res.status}`, res.status);
    }
    return (await res.json()) as AiCloudJobStatusResponse;
  }
}

let cachedClient: WebGpuJobClient | null = null;

export function getWebGpuClient(): WebGpuJobClient {
  if (cachedClient) return cachedClient;
  const broker = brokerBaseUrl();
  const tokenProvider = new WebGpuTokenProvider(broker, BUNDLE_ID, getInstanceId());
  cachedClient = new WebGpuJobClient({
    gpuBaseUrl: gpuBaseUrl(),
    brokerBaseUrl: broker,
    bundleId: BUNDLE_ID,
    tokenProvider,
  });
  return cachedClient;
}

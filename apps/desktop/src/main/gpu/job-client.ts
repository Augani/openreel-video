import { readFile, writeFile } from "node:fs/promises";

export interface NormalizedPresign {
  uploadUrl: string;
  mediaKey: string;
  downloadUrl?: string;
  headers: Record<string, string>;
}

export function normalizePresign(raw: Record<string, unknown>): NormalizedPresign {
  const uploadUrl = (raw.uploadURL ?? raw.putUrl) as string | undefined;
  const mediaKey = (raw.mediaKey ?? raw.objectKey) as string | undefined;
  if (!uploadUrl || !mediaKey) {
    throw new Error("presign response missing uploadURL/putUrl or mediaKey/objectKey");
  }
  const downloadUrl = (raw.getUrl ?? raw.downloadURL ?? raw.downloadUrl) as string | undefined;
  const headers = (raw.headers as Record<string, string> | undefined) ?? {};
  return { uploadUrl, mediaKey, downloadUrl, headers };
}

export interface SubmitArgs {
  kind: string;
  params: Record<string, unknown>;
  mediaKey?: string;
  mediaFilename?: string;
}

export function buildSubmitBody(args: SubmitArgs): { body: string; contentType: string } {
  const request = { kind: args.kind, params: args.params };
  if (args.mediaKey) {
    return {
      body: JSON.stringify({ request, mediaKey: args.mediaKey, mediaFilename: args.mediaFilename }),
      contentType: "application/json",
    };
  }
  return { body: JSON.stringify(request), contentType: "application/json" };
}

export interface GpuJobClientDeps {
  gpuBaseUrl: string;
  brokerBaseUrl: string;
  bundleId: string;
  tokenProvider: { getToken(): Promise<string>; invalidate(): void };
  fetchFn?: typeof fetch;
  tempFilePath?: (ext: string) => Promise<string>;
}

export interface GpuJobStatus {
  jobID: string;
  status: string;
  progress?: number;
  message?: string;
  manifestURL?: string;
  error?: string;
  queuePosition?: number;
  pendingAhead?: number;
}

export interface GpuJobCreated {
  jobID: string;
  status: string;
  manifestURL?: string;
}

export class GpuRetryableError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GpuRetryableError";
  }
}

export class GpuJobClient {
  constructor(private readonly deps: GpuJobClientDeps) {}

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.deps.tokenProvider.getToken();
    return {
      Authorization: `Bearer ${token}`,
      "X-Bundle-ID": this.deps.bundleId,
      Accept: "application/json",
    };
  }

  private async authedFetch(url: string, init: RequestInit): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string>), ...(await this.authHeaders()) };
    let res = await this.fetchFn(url, { ...init, headers });
    if (res.status === 401) {
      this.deps.tokenProvider.invalidate();
      const retryHeaders = { ...(init.headers as Record<string, string>), ...(await this.authHeaders()) };
      res = await this.fetchFn(url, { ...init, headers: retryHeaders });
    }
    return res;
  }

  async uploadMedia(args: { srcPath: string; filename: string; contentType?: string }): Promise<{ mediaKey: string; downloadUrl?: string }> {
    const bytes = await readFile(args.srcPath);
    return this.uploadBytes({
      bytes: new Uint8Array(bytes),
      filename: args.filename,
      contentType: args.contentType,
    });
  }

  async uploadBytes(args: {
    bytes: Uint8Array | ArrayBuffer | ArrayBufferView;
    filename: string;
    contentType?: string;
  }): Promise<{ mediaKey: string; downloadUrl?: string }> {
    const presignRes = await this.authedFetch(`${this.deps.brokerBaseUrl}/auth/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: args.filename, contentType: args.contentType }),
    });
    if (!presignRes.ok) {
      throw new Error(`presign failed: ${presignRes.status}`);
    }
    const presign = normalizePresign((await presignRes.json()) as Record<string, unknown>);
    const body =
      args.bytes instanceof Uint8Array
        ? args.bytes
        : args.bytes instanceof ArrayBuffer
          ? new Uint8Array(args.bytes)
          : new Uint8Array(args.bytes.buffer, args.bytes.byteOffset, args.bytes.byteLength);
    const putHeaders: Record<string, string> = { ...presign.headers };
    if (!putHeaders["Content-Type"] && !putHeaders["content-type"] && args.contentType) {
      putHeaders["Content-Type"] = args.contentType;
    }
    const putRes = await this.fetchFn(presign.uploadUrl, {
      method: "PUT",
      headers: putHeaders,
      body: body as unknown as BodyInit,
    });
    if (!putRes.ok) {
      throw new Error(`upload PUT failed: ${putRes.status}`);
    }
    return { mediaKey: presign.mediaKey, downloadUrl: presign.downloadUrl };
  }

  async submitJob(args: SubmitArgs): Promise<GpuJobCreated> {
    const { body, contentType } = buildSubmitBody(args);
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    if (res.status === 503) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new GpuRetryableError("queue full", 503, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!res.ok) {
      throw new Error(`submit failed: ${res.status}`);
    }
    return (await res.json()) as GpuJobCreated;
  }

  async jobStatus(jobID: string): Promise<GpuJobStatus> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}`, { method: "GET" });
    if (!res.ok) {
      throw new GpuRetryableError(`status failed: ${res.status}`, res.status);
    }
    return (await res.json()) as GpuJobStatus;
  }

  async fetchManifest(jobID: string): Promise<Record<string, unknown>> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}/manifest`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`manifest failed: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async downloadArtifact(jobID: string, relativePath: string): Promise<{ tempPath: string; mime: string }> {
    if (!this.deps.tempFilePath) {
      throw new Error("tempFilePath dependency not provided");
    }
    const res = await this.authedFetch(
      `${this.deps.gpuBaseUrl}/jobs/${jobID}/artifacts/${relativePath}`,
      { method: "GET" },
    );
    if (!res.ok) {
      throw new Error(`artifact download failed: ${res.status}`);
    }
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const ext = relativePath.split(".").pop() ?? "bin";
    const tempPath = await this.deps.tempFilePath(ext);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(tempPath, buffer);
    return { tempPath, mime };
  }

  async cancelJob(jobID: string): Promise<GpuJobStatus> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`cancel failed: ${res.status}`);
    }
    return (await res.json()) as GpuJobStatus;
  }
}

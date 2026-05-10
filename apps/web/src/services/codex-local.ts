export const CODEX_LOCAL_PROVIDER_ID = "codex-local";
export const DEFAULT_CODEX_LOCAL_ENDPOINT = "http://127.0.0.1:14567";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface CodexLocalTextOptions {
  endpoint: string;
  systemPrompt: string;
  text: string;
  signal?: AbortSignal;
}

export interface CodexLocalImageOptions {
  endpoint: string;
  prompt: string;
  sourceFile?: File;
  aspectRatio?: string;
  signal?: AbortSignal;
}

interface CodexTextResponse {
  text?: string;
  output_text?: string;
  choices?: Array<{ message?: { content?: string }; text?: string }>;
}

interface CodexImageRecord {
  dataUrl?: string;
  imageUrl?: string;
  url?: string;
  b64_json?: string;
  mimeType?: string;
}

interface CodexImageResponse extends CodexImageRecord {
  images?: CodexImageRecord[];
  data?: CodexImageRecord[];
}

export function normalizeCodexLocalEndpoint(endpoint: string): string {
  const value = endpoint.trim() || DEFAULT_CODEX_LOCAL_ENDPOINT;
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Codex Local bridge must use http or https.");
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("Codex Local bridge must use a loopback host such as localhost or 127.0.0.1.");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function buildCodexLocalUrl(endpoint: string, path: string): string {
  const base = normalizeCodexLocalEndpoint(endpoint);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function parseCodexTextResponse(data: CodexTextResponse, fallback: string): string {
  const text =
    data.text ??
    data.output_text ??
    data.choices?.[0]?.message?.content ??
    data.choices?.[0]?.text ??
    fallback;

  return text.trim() || fallback;
}

export async function enhanceTextWithCodexLocal(options: CodexLocalTextOptions): Promise<string> {
  const response = await fetch(buildCodexLocalUrl(options.endpoint, "/v1/text"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: options.systemPrompt,
      prompt: options.text,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `Codex Local error (${response.status})`);
  }

  const data = (await response.json()) as CodexTextResponse;
  return parseCodexTextResponse(data, options.text);
}

export async function generateImageWithCodexLocal(options: CodexLocalImageOptions): Promise<Blob> {
  const form = new FormData();
  form.set("prompt", options.prompt);
  if (options.aspectRatio) form.set("aspectRatio", options.aspectRatio);
  if (options.sourceFile) form.set("source", options.sourceFile, options.sourceFile.name);

  const response = await fetch(buildCodexLocalUrl(options.endpoint, "/v1/images/edits"), {
    method: "POST",
    body: form,
    signal: options.signal,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `Codex Local image error (${response.status})`);
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.startsWith("image/")) {
    return response.blob();
  }

  const data = (await response.json()) as CodexImageResponse;
  return imageResponseToBlob(data);
}

async function imageResponseToBlob(data: CodexImageResponse): Promise<Blob> {
  const image = data.images?.[0] ?? data.data?.[0] ?? data;
  const dataUrl = image.dataUrl;
  const url = image.imageUrl ?? image.url;
  const base64 = image.b64_json;

  if (dataUrl) {
    return fetch(dataUrl).then((response) => response.blob());
  }

  if (url) {
    return fetch(url).then((response) => response.blob());
  }

  if (base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: image.mimeType ?? "image/png" });
  }

  throw new Error("Codex Local image response did not include an image.");
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const error = data.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      return String((error as { message: unknown }).message);
    }
    if (typeof data.message === "string") return data.message;
  }
  return response.text().catch(() => "");
}

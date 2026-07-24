/**
 * Studio API client (STUDIO_PLAN §34.2). Talks to the marketplace/studio Worker.
 * Dev identity is sent via headers (matches the API auth shim); production swaps
 * to cookie/JWT. Base URL is configurable via VITE_API_URL.
 */
import type { AssetKind, Graph } from "@openreel/fxpkg";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

const IDENTITY = {
  "X-User-Id": "u-studio",
  "X-Creator-Id": "c-studio",
  "X-Creator-Handle": "augani",
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...IDENTITY, ...(init?.headers ?? {}) },
  });
  if (!res.ok && res.status !== 422) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface DraftResponse {
  id: string;
  kind: AssetKind;
  title?: string;
}

export const studioApi = {
  base: BASE,
  listBlueprints: () => call<{ blueprints: Array<{ id: string; label: string; kind: AssetKind; difficulty: string }> }>("/v1/blueprints"),
  nodelib: (abi = "1.2") => call<{ nodes: Array<{ id: string; category: string; label: string }> }>(`/v1/nodelib?abi=${abi}`),
  createDraft: (kind: AssetKind, title: string, graph: Graph, manifestDraft: Record<string, unknown>) =>
    call<DraftResponse>("/v1/drafts", { method: "POST", body: JSON.stringify({ kind, title, graph, manifest_draft: manifestDraft }) }),
  saveDraft: (id: string, graph: Graph) =>
    call<DraftResponse>(`/v1/drafts/${id}`, { method: "PUT", body: JSON.stringify({ graph }) }),
  validateDraft: (id: string) =>
    call<{ validation?: { ok: boolean; errors: unknown[] }; compile?: { ok: boolean } }>(`/v1/drafts/${id}/validate`, { method: "POST" }),
  submitDraft: (id: string) =>
    call<{ submission: { id: string; state: string }; checks?: unknown }>(`/v1/drafts/${id}/submit`, { method: "POST" }),
  listAssets: (sort = "trending") =>
    call<{ assets: Array<{ id: string; slug: string; kind: AssetKind; title?: string }> }>(`/v1/assets?sort=${sort}`),
};

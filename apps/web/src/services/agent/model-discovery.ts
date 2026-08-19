import {
  apiFetch,
  normalizeCompatibleBaseUrl,
} from "../api-proxy";
import type { LlmProvider } from "../../stores/settings-store";

export interface DiscoveredLlmModel {
  readonly id: string;
  readonly label: string;
}

interface DiscoverModelsOptions {
  readonly provider: LlmProvider;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly signal?: AbortSignal;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function errorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.message === "string") return payload.message;
  if (isRecord(payload.error)) {
    if (typeof payload.error.message === "string") return payload.error.message;
    if (typeof payload.error.type === "string") return payload.error.type;
  }
  return null;
}

/** Discover models from the endpoint's standard GET /models route. */
export async function discoverCompatibleModels({
  provider,
  baseUrl,
  apiKey,
  signal,
}: DiscoverModelsOptions): Promise<DiscoveredLlmModel[]> {
  const normalizedBaseUrl = normalizeCompatibleBaseUrl(baseUrl);
  const response = await apiFetch(provider, "/models", apiKey, {
    baseUrl: normalizedBaseUrl,
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      errorMessage(payload) ??
        `Could not load models from the endpoint (${response.status}).`,
    );
  }

  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : [];
  const seen = new Set<string>();
  const models: DiscoveredLlmModel[] = [];

  for (const candidate of candidates) {
    const id =
      typeof candidate === "string"
        ? candidate.trim()
        : isRecord(candidate) && typeof candidate.id === "string"
          ? candidate.id.trim()
          : "";
    if (!id || seen.has(id)) continue;
    const label =
      isRecord(candidate) && typeof candidate.display_name === "string"
        ? candidate.display_name.trim() || id
        : isRecord(candidate) && typeof candidate.name === "string"
          ? candidate.name.trim() || id
          : id;
    seen.add(id);
    models.push({ id, label });
  }

  return models;
}

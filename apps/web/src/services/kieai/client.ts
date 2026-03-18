/**
 * KieAI base client
 *
 * Retrieves the API key from secure-storage (encrypted IndexedDB) and
 * provides a typed fetch wrapper used by every KieAI service module.
 *
 * The session must be unlocked (master password entered) before any call.
 * API key is stored under the id "kieai-api-key".
 */

import { getSecret } from "../secure-storage";
import { KieAIError } from "./types";
import type { KieAIResponse } from "./types";

/** File upload API base (kieai.redpandaai.co) */
export const KIEAI_BASE_URL = "https://kieai.redpandaai.co";
/** Generation API base (api.kie.ai) */
export const KIEAI_API_BASE_URL = "https://api.kie.ai";
export const KIEAI_SECRET_ID = "kie-ai";

async function getApiKey(): Promise<string> {
  const key = await getSecret(KIEAI_SECRET_ID);
  if (!key) {
    throw new KieAIError(
      401,
      "KieAI API key not configured. Add it in Settings → API Keys.",
    );
  }
  return key;
}

/** POST JSON — used by URL upload, Base64 upload, and task creation */
export async function kieaiPostJson<TBody extends object, TData>(
  path: string,
  body: TBody,
  baseUrl = KIEAI_BASE_URL,
): Promise<TData> {
  const apiKey = await getApiKey();

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new KieAIError(res.status, `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as KieAIResponse<TData>;

  if (json.code !== 200) {
    throw new KieAIError(json.code, json.msg);
  }

  return json.data;
}

/** GET with query params — used for task status polling */
export async function kieaiGet<TData>(
  path: string,
  params: Record<string, string>,
  baseUrl = KIEAI_API_BASE_URL,
): Promise<TData> {
  const apiKey = await getApiKey();
  const url = new URL(`${baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new KieAIError(res.status, `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as KieAIResponse<TData>;
  if (json.code !== 200) {
    throw new KieAIError(json.code, json.msg);
  }
  return json.data;
}

/** POST multipart/form-data — used by stream upload */
export async function kieaiPostForm<TData>(
  path: string,
  form: FormData,
): Promise<TData> {
  const apiKey = await getApiKey();

  const res = await fetch(`${KIEAI_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      // Do NOT set Content-Type here — browser sets it with the correct boundary
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    throw new KieAIError(res.status, `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as KieAIResponse<TData>;

  if (json.code !== 200) {
    throw new KieAIError(json.code, json.msg);
  }

  return json.data;
}

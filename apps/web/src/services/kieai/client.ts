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

export const KIEAI_BASE_URL = "https://kieai.redpandaai.co";
export const KIEAI_SECRET_ID = "kieai-api-key";

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

/** POST JSON — used by URL upload and Base64 upload */
export async function kieaiPostJson<TBody extends object, TData>(
  path: string,
  body: TBody,
): Promise<TData> {
  const apiKey = await getApiKey();

  const res = await fetch(`${KIEAI_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as KieAIResponse<TData>;

  if (!json.success) {
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

  const json = (await res.json()) as KieAIResponse<TData>;

  if (!json.success) {
    throw new KieAIError(json.code, json.msg);
  }

  return json.data;
}

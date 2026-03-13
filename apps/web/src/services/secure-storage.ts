/**
 * Secure storage service for encrypting/decrypting sensitive data (API keys)
 * using Web Crypto API with PBKDF2 key derivation and AES-GCM encryption.
 *
 * Security model:
 * - Master password → PBKDF2 (100k iterations, SHA-256) → derived AES-GCM-256 key
 * - Each secret encrypted with unique IV
 * - Derived key held in memory only, never persisted
 * - Salt stored alongside encrypted data (not secret)
 * - A verification hash is stored to validate the master password
 */

const SECURE_DB_NAME = "openreel-secure";
const SECURE_DB_VERSION = 1;
const STORE_SECRETS = "secrets";
const STORE_META = "meta";

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export interface SecureRecord {
  readonly id: string;
  readonly label: string;
  readonly encryptedData: ArrayBuffer;
  readonly iv: Uint8Array;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface MetaRecord {
  readonly id: string;
  readonly value: ArrayBuffer | Uint8Array;
}

let dbInstance: IDBDatabase | null = null;
let derivedKey: CryptoKey | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_UNLOCK_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
let failedAttempts = 0;
let lockedUntil = 0;

// Listeners notified when the session locks (for cache cleanup, etc.)
const lockListeners: Array<() => void> = [];

/**
 * Register a callback invoked whenever the session locks.
 * Returns an unsubscribe function.
 */
export function onSessionLock(listener: () => void): () => void {
  lockListeners.push(listener);
  return () => {
    const idx = lockListeners.indexOf(listener);
    if (idx >= 0) lockListeners.splice(idx, 1);
  };
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function resetInactivityTimer(): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  inactivityTimer = setTimeout(() => {
    lockSession();
  }, SESSION_TIMEOUT_MS);
}

function createDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECURE_DB_NAME, SECURE_DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open secure database: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_SECRETS)) {
        db.createObjectStore(STORE_SECRETS, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "id" });
      }
    };
  });
}

async function getDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await createDatabase();
  dbInstance.onclose = () => {
    dbInstance = null;
  };
  return dbInstance;
}

function idbTransaction<T>(
  db: IDBDatabase,
  storeName: string,
  mode: "readonly" | "readwrite",
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`IDB operation failed: ${request.error?.message}`));
  });
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(data: string, key: CryptoKey): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(data),
  );

  return { encrypted, iv };
}

async function decrypt(encrypted: ArrayBuffer, iv: Uint8Array, key: CryptoKey): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    encrypted,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Check if a master password has been configured.
 */
export async function isMasterPasswordSet(): Promise<boolean> {
  const db = await getDatabase();
  const meta = await idbTransaction<MetaRecord | undefined>(
    db,
    STORE_META,
    "readonly",
    (store) => store.get("verification"),
  );
  return !!meta;
}

/**
 * Check if the session is currently unlocked.
 */
export function isSessionUnlocked(): boolean {
  return derivedKey !== null;
}

/**
 * Set up the master password for the first time.
 * Generates a random salt, derives a key, and stores a verification token.
 */
export async function setupMasterPassword(password: string): Promise<void> {
  if (password.length < 8) {
    throw new Error("Master password must be at least 8 characters");
  }

  const alreadySet = await isMasterPasswordSet();
  if (alreadySet) {
    throw new Error(
      "Master password already configured. Use changeMasterPassword instead.",
    );
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt);

  // Create a verification token: encrypt a known string
  const verificationPlaintext = "openreel-verify-v1";
  const { encrypted: verificationData, iv: verificationIv } = await encrypt(verificationPlaintext, key);

  const db = await getDatabase();
  await idbTransaction(db, STORE_META, "readwrite", (store) =>
    store.put({ id: "salt", value: salt }),
  );
  await idbTransaction(db, STORE_META, "readwrite", (store) =>
    store.put({ id: "verification", value: verificationData }),
  );
  await idbTransaction(db, STORE_META, "readwrite", (store) =>
    store.put({ id: "verification_iv", value: verificationIv }),
  );

  derivedKey = key;

  resetInactivityTimer();
}

/**
 * Unlock the session with the master password.
 * Verifies the password against the stored verification token.
 */
export function getUnlockBackoffMs(): number {
  if (failedAttempts === 0) return 0;
  const now = Date.now();
  return Math.max(0, lockedUntil - now);
}

export async function unlockSession(password: string): Promise<boolean> {
  if (failedAttempts >= MAX_UNLOCK_ATTEMPTS) {
    throw new Error(
      "Account locked after too many failed attempts. Reset secure storage to regain access.",
    );
  }

  const remaining = getUnlockBackoffMs();
  if (remaining > 0) {
    throw new Error(
      `Too many failed attempts. Try again in ${Math.ceil(remaining / 1000)}s.`,
    );
  }

  const db = await getDatabase();
  const saltMeta = await idbTransaction<MetaRecord | undefined>(
    db,
    STORE_META,
    "readonly",
    (store) => store.get("salt"),
  );
  const verificationMeta = await idbTransaction<MetaRecord | undefined>(
    db,
    STORE_META,
    "readonly",
    (store) => store.get("verification"),
  );
  const verificationIvMeta = await idbTransaction<MetaRecord | undefined>(
    db,
    STORE_META,
    "readonly",
    (store) => store.get("verification_iv"),
  );

  if (!saltMeta || !verificationMeta || !verificationIvMeta) {
    throw new Error("Master password not configured");
  }

  const salt = saltMeta.value instanceof Uint8Array
    ? saltMeta.value
    : new Uint8Array(saltMeta.value as ArrayBuffer);
  const key = await deriveKey(password, salt);

  try {
    const iv = verificationIvMeta.value instanceof Uint8Array
      ? verificationIvMeta.value
      : new Uint8Array(verificationIvMeta.value as ArrayBuffer);
    const decrypted = await decrypt(verificationMeta.value as ArrayBuffer, iv, key);

    if (decrypted !== "openreel-verify-v1") {
      failedAttempts++;
      lockedUntil = Date.now() + BASE_BACKOFF_MS * Math.pow(2, failedAttempts - 1);
      return false;
    }
  } catch {
    failedAttempts++;
    lockedUntil = Date.now() + BASE_BACKOFF_MS * Math.pow(2, failedAttempts - 1);
    return false;
  }

  failedAttempts = 0;
  lockedUntil = 0;
  derivedKey = key;

  resetInactivityTimer();
  return true;
}

/**
 * Lock the session, clearing the derived key from memory.
 */
export function lockSession(): void {
  derivedKey = null;

  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  for (const listener of lockListeners) {
    listener();
  }
}

/**
 * Change the master password. Re-encrypts all stored secrets.
 */
export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  if (newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters");
  }

  // Verify current password
  const unlocked = await unlockSession(currentPassword);
  if (!unlocked || !derivedKey) {
    return false;
  }

  const oldKey = derivedKey;

  // Decrypt all existing secrets
  const db = await getDatabase();
  const allSecrets = await new Promise<SecureRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_SECRETS, "readonly");
    const store = tx.objectStore(STORE_SECRETS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const decryptedSecrets: Array<{ id: string; label: string; value: string; createdAt: number }> = [];
  for (const record of allSecrets) {
    const iv = record.iv instanceof Uint8Array
      ? record.iv
      : new Uint8Array(record.iv as unknown as ArrayBuffer);
    const value = await decrypt(record.encryptedData, iv, oldKey);
    decryptedSecrets.push({
      id: record.id,
      label: record.label,
      value,
      createdAt: record.createdAt,
    });
  }

  // Set up new password
  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const newKey = await deriveKey(newPassword, newSalt);

  // Store new salt and verification
  const verificationPlaintext = "openreel-verify-v1";
  const { encrypted: verificationData, iv: verificationIv } = await encrypt(verificationPlaintext, newKey);

  await idbTransaction(db, STORE_META, "readwrite", (store) =>
    store.put({ id: "salt", value: newSalt }),
  );
  await idbTransaction(db, STORE_META, "readwrite", (store) =>
    store.put({ id: "verification", value: verificationData }),
  );
  await idbTransaction(db, STORE_META, "readwrite", (store) =>
    store.put({ id: "verification_iv", value: verificationIv }),
  );

  // Re-encrypt all secrets with new key
  for (const secret of decryptedSecrets) {
    const { encrypted, iv } = await encrypt(secret.value, newKey);
    const record: SecureRecord = {
      id: secret.id,
      label: secret.label,
      encryptedData: encrypted,
      iv,
      createdAt: secret.createdAt,
      updatedAt: Date.now(),
    };
    await idbTransaction(db, STORE_SECRETS, "readwrite", (store) =>
      store.put(record),
    );
  }

  derivedKey = newKey;
  resetInactivityTimer();
  return true;
}

/**
 * Save an encrypted secret (API key).
 * Session must be unlocked.
 */
export async function saveSecret(id: string, label: string, value: string): Promise<void> {
  if (!derivedKey) {
    throw new Error("Session is locked. Unlock with master password first.");
  }

  resetInactivityTimer();

  const { encrypted, iv } = await encrypt(value, derivedKey);

  const db = await getDatabase();
  // Check if record exists to preserve createdAt
  const existing = await idbTransaction<SecureRecord | undefined>(
    db,
    STORE_SECRETS,
    "readonly",
    (store) => store.get(id),
  );

  const record: SecureRecord = {
    id,
    label,
    encryptedData: encrypted,
    iv,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  await idbTransaction(db, STORE_SECRETS, "readwrite", (store) =>
    store.put(record),
  );
}

/**
 * Retrieve and decrypt a secret.
 * Session must be unlocked.
 */
export async function getSecret(id: string): Promise<string | null> {
  if (!derivedKey) {
    throw new Error("Session is locked. Unlock with master password first.");
  }

  resetInactivityTimer();

  const db = await getDatabase();
  const record = await idbTransaction<SecureRecord | undefined>(
    db,
    STORE_SECRETS,
    "readonly",
    (store) => store.get(id),
  );

  if (!record) {
    return null;
  }

  const iv = record.iv instanceof Uint8Array
    ? record.iv
    : new Uint8Array(record.iv as unknown as ArrayBuffer);

  return await decrypt(record.encryptedData, iv, derivedKey);
}

/**
 * Delete a secret.
 */
export async function deleteSecret(id: string): Promise<void> {
  if (!derivedKey) {
    throw new Error("Session is locked");
  }

  const db = await getDatabase();
  await idbTransaction(db, STORE_SECRETS, "readwrite", (store) =>
    store.delete(id),
  );
}

/**
 * List all stored secret metadata (without decrypted values).
 */
export async function listSecrets(): Promise<Array<{ id: string; label: string; createdAt: number; updatedAt: number }>> {
  const db = await getDatabase();
  const records = await new Promise<SecureRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_SECRETS, "readonly");
    const store = tx.objectStore(STORE_SECRETS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return records.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Completely reset all secure storage (master password + all secrets).
 * Use with caution — this is irreversible.
 */
export async function resetSecureStorage(): Promise<void> {
  lockSession();

  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SECURE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("Failed to reset secure storage"));
  });
}

// Lock session and close database when tab is closing
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    lockSession();
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }
  });
}

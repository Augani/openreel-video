import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ExternalLink,
  Shield,
  KeyRound,
} from "@/icons/lucide-compat";
import { Button, Input } from "@openreel/ui";
import { Card } from "@openreel/ui";



import { useSettingsStore, SERVICE_REGISTRY } from "../../../stores/settings-store";
import {
  isMasterPasswordSet,
  isSessionUnlocked,
  setupMasterPassword,
  unlockSession,
  lockSession,
  saveSecret,
  getSecret,
  deleteSecret,
  hasSecret,
  listSecrets,
  changeMasterPassword,
  onSessionLock,
} from "../../../services/secure-storage";
import { MasterPasswordDialog } from "./MasterPasswordDialog";
import { toast } from "../../../stores/notification-store";

export const ApiKeysPanel: React.FC = () => {
  const addConfiguredService = useSettingsStore(state => state.addConfiguredService);
  const removeConfiguredService = useSettingsStore(state => state.removeConfiguredService);

  const systemKeychain = typeof window !== "undefined" && window.openreel?.platform === "desktop" && Boolean(window.openreel.keychain);
  const [passwordSet, setPasswordSet] = useState(systemKeychain);
  const [unlocked, setUnlocked] = useState(systemKeychain);
  const epoch = useRef(0), alive = useRef(true);
  const [passwordDialogMode, setPasswordDialogMode] = useState<
    "setup" | "unlock" | "change" | null
  >(null);
  const [storedKeys, setStoredKeys] = useState<
    Array<{ id: string; label: string; createdAt: number; updatedAt: number }>
  >([]);
  const [addingService, setAddingService] = useState<string | null>(null);
  const [newKeyValue, setNewKeyValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const refreshState = useCallback(async () => {
    const isSet = await isMasterPasswordSet();
    setPasswordSet(isSet);
    setUnlocked(isSessionUnlocked());

    if (isSessionUnlocked()) {
      const keys =
        systemKeychain
          ? (
              await Promise.all(
                SERVICE_REGISTRY.map(async (service) =>
                  (await hasSecret(service.id))
                    ? {
                        id: service.id,
                        label: service.label,
                        createdAt: 0,
                        updatedAt: 0,
                      }
                    : null,
                ),
              )
            ).filter((key): key is NonNullable<typeof key> => key !== null)
          : await listSecrets();
      setStoredKeys(keys);
    }
  }, [systemKeychain]);

  const clearSessionView = useCallback(() => {
    epoch.current++;
    if (!systemKeychain) { setUnlocked(false); setStoredKeys([]); }
    setRevealedKeys({}); setShowKey({}); setNewKeyValue(""); setAddingService(null);
  }, [systemKeychain]);

  useEffect(() => {
    alive.current = true;
    void refreshState();
    const unsubscribe = onSessionLock(clearSessionView);
    return () => { alive.current = false; unsubscribe(); };
  }, [refreshState, clearSessionView]);

  const handlePasswordSubmit = useCallback(
    async (password: string, newPassword?: string): Promise<boolean> => {
      if (passwordDialogMode === "setup") {
        await setupMasterPassword(password);
        setPasswordDialogMode(null);
        await refreshState();
        toast.success("Master password set", "Your API keys will be encrypted with AES-256-GCM.");
        return true;
      }

      if (passwordDialogMode === "unlock") {
        const success = await unlockSession(password);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success("Session unlocked", "You can now manage API keys.");
        }
        return success;
      }

      if (passwordDialogMode === "change" && newPassword) {
        const success = await changeMasterPassword(password, newPassword);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success("Password changed", "All keys have been re-encrypted.");
        }
        return success;
      }

      return false;
    },
    [passwordDialogMode, refreshState],
  );

  const handleSaveKey = useCallback(
    async (serviceId: string) => {
      if (!newKeyValue.trim()) return;

      const service = SERVICE_REGISTRY.find((s) => s.id === serviceId);
      if (!service) return;

      try {
        await saveSecret(serviceId, service.label, newKeyValue.trim());
        addConfiguredService(serviceId);
        setNewKeyValue("");
        setAddingService(null);
        await refreshState();
        toast.success(`${service.label} key saved`, "API key encrypted and stored.");
      } catch (err) {
        toast.error("Failed to save", err instanceof Error ? err.message : "Unknown error");
      }
    },
    [newKeyValue, addConfiguredService, refreshState],
  );

  const handleDeleteKey = useCallback(
    async (serviceId: string) => {
      const service = SERVICE_REGISTRY.find((s) => s.id === serviceId);
      try {
        await deleteSecret(serviceId);
        removeConfiguredService(serviceId);
        setRevealedKeys((prev) => {
          const next = { ...prev };
          delete next[serviceId];
          return next;
        });
        await refreshState();
        toast.success(`${service?.label ?? serviceId} key removed`);
      } catch (err) {
        toast.error("Failed to delete", err instanceof Error ? err.message : "Unknown error");
      }
    },
    [removeConfiguredService, refreshState],
  );

  const handleRevealKey = useCallback(async (serviceId: string) => {
    if (!isSessionUnlocked()) return;
    const owner = epoch.current;
    if (revealedKeys[serviceId]) {
      setShowKey((prev) => ({ ...prev, [serviceId]: !prev[serviceId] }));
      return;
    }

    try {
      const value = await getSecret(serviceId);
      if (value && alive.current && owner === epoch.current && isSessionUnlocked()) {
        setRevealedKeys((prev) => ({ ...prev, [serviceId]: value }));
        setShowKey((prev) => ({ ...prev, [serviceId]: true }));
      }
    } catch (err) {
      toast.error("Failed to decrypt", err instanceof Error ? err.message : "Unknown error");
    }
  }, [revealedKeys]);

  const handleLock = useCallback(() => {
    lockSession();
    clearSessionView();
  }, [clearSessionView]);

  const availableServices = SERVICE_REGISTRY.filter(
    (s) => !storedKeys.some((k) => k.id === s.id),
  );

  // Not set up yet
  if (!passwordSet) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Shield size={32} className="text-primary" aria-hidden />
        </div>
        <h3 className="text-[15px] leading-5 text-fg-2 font-bold block mb-2">
          Secure API Key Storage
        </h3>
        <p className="text-[12px] leading-5 text-fg-2 font-normal block mb-6 max-w-sm">
          Set up a master password to encrypt and store your API keys locally.
          Keys are encrypted with AES-256-GCM and are only sent when making a request to the selected service.
        </p>
        <Button onClick={() => setPasswordDialogMode("setup")} type="button" aria-label="Set Up Master Password" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<KeyRound size={16} aria-hidden />}</span>
          <span className="truncate">{"Set Up Master Password"}</span>
        </Button>

        {passwordDialogMode && (
          <MasterPasswordDialog
            isOpen={!!passwordDialogMode}
            onClose={() => setPasswordDialogMode(null)}
            mode={passwordDialogMode}
            onSubmit={handlePasswordSubmit}
          />
        )}
      </div>
    );
  }

  // Locked
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
          <Lock size={32} className="text-amber-500" aria-hidden />
        </div>
        <h3 className="text-[15px] leading-5 text-fg-2 font-bold block mb-2">
          Session Locked
        </h3>
        <p className="text-[12px] leading-5 text-fg-2 font-normal block mb-6 max-w-sm">
          Enter your master password to view and manage API keys.
        </p>
        <Button onClick={() => setPasswordDialogMode("unlock")} type="button" aria-label="Unlock" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Unlock size={16} aria-hidden />}</span>
          <span className="truncate">{"Unlock"}</span>
        </Button>

        {passwordDialogMode && (
          <MasterPasswordDialog
            isOpen={!!passwordDialogMode}
            onClose={() => setPasswordDialogMode(null)}
            mode={passwordDialogMode}
            onSubmit={handlePasswordSubmit}
          />
        )}
      </div>
    );
  }

  // Unlocked — full management UI
  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-primary" aria-hidden />
          <span className="text-[12px] leading-5 text-fg-2 font-normal">
            {storedKeys.length} key{storedKeys.length !== 1 ? "s" : ""} stored
          </span>
        </div>
        {systemKeychain ? <span className="text-xs text-fg-2">System keychain</span> : <div className="flex items-center gap-2">
          <Button onClick={() => setPasswordDialogMode("change")} type="button" aria-label="Change Password" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Key size={14} aria-hidden />}</span>
            <span className="truncate">{"Change Password"}</span>
          </Button>
          <Button onClick={handleLock} type="button" aria-label="Lock" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Lock size={14} aria-hidden />}</span>
            <span className="truncate">{"Lock"}</span>
          </Button>
        </div>}
      </div>

      {/* Stored keys list */}
      <div className="space-y-3">
        {storedKeys.map((stored) => {
          const service = SERVICE_REGISTRY.find((s) => s.id === stored.id);
          const isRevealed = showKey[stored.id] && revealedKeys[stored.id];

          return (
            <Card key={stored.id} className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-4 border border-border"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-primary" aria-hidden />
                  <span className="text-[12px] leading-4 text-fg-2 font-bold">
                    {service?.label ?? stored.label}
                  </span>
                  {service?.docsUrl && (
                    <Button asChild variant="link" size="icon-sm" className="h-6 w-6 text-fg-muted hover:text-primary">
                      <a aria-label={`${service.label} documentation`} href={service.docsUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} aria-hidden /></a>
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => handleRevealKey(stored.id)} type="button" aria-label={isRevealed ? "Hide key" : "Show key"} title={isRevealed ? "Hide key" : "Show key"} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
                    {isRevealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteKey(stored.id)} type="button" aria-label="Delete key" title="Delete key" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-status-error/12 text-status-error hover:bg-status-error/20">
                    {<Trash2 size={14} aria-hidden />}
                  </Button>
                </div>
              </div>

              {service && (
                <p className="text-[12px] leading-5 text-fg-2 font-normal block mb-2">
                  {service.description}
                </p>
              )}

              <Card className="min-w-0 rounded-[7px] border shadow-none border-border bg-bg-1 p-2 font-mono text-xs text-text-secondary">
                {isRevealed
                  ? revealedKeys[stored.id]
                  : "••••••••••••••••••••••••••••••••"}
              </Card>

              <span className="text-fg-2 font-normal block mt-2 text-[10px]">
                {stored.createdAt > 0
                  ? `Added ${new Date(stored.createdAt).toLocaleDateString()} · Updated ${new Date(stored.updatedAt).toLocaleDateString()}`
                  : "Stored securely in the system keychain"}
              </span>
            </Card>
          );
        })}
      </div>

      {/* Add new key */}
      {addingService ? (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-4 border border-primary/30">
          <div className="flex items-center gap-2 mb-3">
            <Plus size={14} className="text-primary" aria-hidden />
            <span className="text-[12px] leading-4 text-fg-2 font-bold">
              Add{" "}
              {SERVICE_REGISTRY.find((s) => s.id === addingService)?.keyOptional
                ? `Optional ${SERVICE_REGISTRY.find((s) => s.id === addingService)?.label} Key`
                : `${SERVICE_REGISTRY.find((s) => s.id === addingService)?.label} Key`}
            </span>
          </div>
          <Input
            aria-label="API key"
            type="password"
            value={newKeyValue}
            onChange={event => setNewKeyValue(event.target.value)}
            placeholder={
              SERVICE_REGISTRY.find((s) => s.id === addingService)?.keyOptional
                ? "Paste an API key if your endpoint requires one"
                : "Paste your API key here"
            }
            autoFocus
            autoComplete="off"
            className="mb-3 h-8 rounded-md bg-bg-2 font-mono text-xs md:text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => {
                setAddingService(null);
                setNewKeyValue("");
              }} type="button" aria-label="Cancel" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
              <span className="truncate">{"Cancel"}</span>
            </Button>
            <Button onClick={() => handleSaveKey(addingService)} type="button" aria-label="Save Key" disabled={(!newKeyValue.trim())} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
              <span className="truncate">{"Save Key"}</span>
            </Button>
          </div>
        </Card>
      ) : availableServices.length > 0 ? (
        <div>
          <h3 className="text-[12px] leading-4 text-fg-2 font-bold block mb-3">
            Add API Key
          </h3>
          <div className="grid gap-2">
            {availableServices.map((service) => (
              <Button variant="ghost" key={service.id} onClick={() => setAddingService(service.id)} type="button" aria-label={`Add ${service.keyOptional ? "optional " : ""}${service.label} API key`} className="group/card block h-auto min-w-0 whitespace-normal rounded-[7px] text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 bg-bg-1 hover:bg-bg-2 p-3 border border-border">
                <div className="flex items-center gap-3 text-left">
                  <div className="p-2 rounded-lg bg-background-tertiary">
                    <Plus size={14} className="text-primary" aria-hidden />
                  </div>
                  <div>
                    <span className="text-[12px] leading-4 text-fg-2 font-bold block">
                      {service.label}{service.keyOptional ? " (optional key)" : ""}
                    </span>
                    <span className="text-[12px] leading-5 text-fg-2 font-normal block">
                      {service.description}
                    </span>
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {passwordDialogMode && (
        <MasterPasswordDialog
          isOpen={!!passwordDialogMode}
          onClose={() => setPasswordDialogMode(null)}
          mode={passwordDialogMode}
          onSubmit={handlePasswordSubmit}
        />
      )}
    </div>
  );
};

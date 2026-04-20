import React, { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { Input } from "@openreel/ui";
import { Button } from "@openreel/ui";
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
  listSecrets,
  changeMasterPassword,
} from "../../../services/secure-storage";
import { MasterPasswordDialog } from "./MasterPasswordDialog";
import { toast } from "../../../stores/notification-store";
import { useI18n } from "../../../i18n";

export const ApiKeysPanel: React.FC = () => {
  const { t, formatDate } = useI18n();
  const { addConfiguredService, removeConfiguredService } = useSettingsStore();

  const [passwordSet, setPasswordSet] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
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
      const keys = await listSecrets();
      setStoredKeys(keys);
    }
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const handlePasswordSubmit = useCallback(
    async (password: string, newPassword?: string): Promise<boolean> => {
      if (passwordDialogMode === "setup") {
        await setupMasterPassword(password);
        setPasswordDialogMode(null);
        await refreshState();
        toast.success(
          t("toast.masterPasswordSet.title"),
          t("toast.masterPasswordSet.description"),
        );
        return true;
      }

      if (passwordDialogMode === "unlock") {
        const success = await unlockSession(password);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success(
            t("toast.sessionUnlocked.title"),
            t("toast.sessionUnlocked.description"),
          );
        }
        return success;
      }

      if (passwordDialogMode === "change" && newPassword) {
        const success = await changeMasterPassword(password, newPassword);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success(
            t("toast.passwordChanged.title"),
            t("toast.passwordChanged.description"),
          );
        }
        return success;
      }

      return false;
    },
    [passwordDialogMode, refreshState, t],
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
        toast.success(
          t("toast.keySaved.title", { label: service.label }),
          t("toast.keySaved.description"),
        );
      } catch (err) {
        toast.error(
          t("toast.failedToSave"),
          err instanceof Error ? err.message : "Unknown error",
        );
      }
    },
    [newKeyValue, addConfiguredService, refreshState, t],
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
        toast.success(
          t("toast.keyRemoved", { label: service?.label ?? serviceId }),
        );
      } catch (err) {
        toast.error(
          t("toast.failedToDelete"),
          err instanceof Error ? err.message : "Unknown error",
        );
      }
    },
    [removeConfiguredService, refreshState, t],
  );

  const handleRevealKey = useCallback(
    async (serviceId: string) => {
      if (revealedKeys[serviceId]) {
        setShowKey((prev) => ({ ...prev, [serviceId]: !prev[serviceId] }));
        return;
      }

      try {
        const value = await getSecret(serviceId);
        if (value) {
          setRevealedKeys((prev) => ({ ...prev, [serviceId]: value }));
          setShowKey((prev) => ({ ...prev, [serviceId]: true }));
        }
      } catch (err) {
        toast.error(
          t("toast.failedToDecrypt"),
          err instanceof Error ? err.message : "Unknown error",
        );
      }
    },
    [revealedKeys, t],
  );

  const handleLock = useCallback(() => {
    lockSession();
    setUnlocked(false);
    setStoredKeys([]);
    setRevealedKeys({});
    setShowKey({});
  }, []);

  const availableServices = SERVICE_REGISTRY.filter(
    (s) => !storedKeys.some((k) => k.id === s.id),
  );

  if (!passwordSet) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Shield size={32} className="text-primary" />
        </div>
        <h3 className="text-lg font-medium text-text-primary mb-2">
          {t("apiKeys.secureStorage.title")}
        </h3>
        <p className="text-sm text-text-muted mb-6 max-w-sm">
          {t("apiKeys.secureStorage.description")}
        </p>
        <Button onClick={() => setPasswordDialogMode("setup")}>
          <KeyRound size={16} className="mr-2" />
          {t("apiKeys.secureStorage.setup")}
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

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
          <Lock size={32} className="text-amber-500" />
        </div>
        <h3 className="text-lg font-medium text-text-primary mb-2">
          {t("apiKeys.locked.title")}
        </h3>
        <p className="text-sm text-text-muted mb-6 max-w-sm">
          {t("apiKeys.locked.description")}
        </p>
        <Button onClick={() => setPasswordDialogMode("unlock")}>
          <Unlock size={16} className="mr-2" />
          {t("apiKeys.locked.unlock")}
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Shield size={14} className="text-primary" />
          <span>{t("apiKeys.storedCount", { count: storedKeys.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPasswordDialogMode("change")}
          >
            <Key size={14} className="mr-1" />
            {t("apiKeys.changePassword")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleLock}>
            <Lock size={14} className="mr-1" />
            {t("apiKeys.lock")}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {storedKeys.map((stored) => {
          const service = SERVICE_REGISTRY.find((s) => s.id === stored.id);
          const isRevealed = showKey[stored.id] && revealedKeys[stored.id];

          return (
            <div
              key={stored.id}
              className="border border-border rounded-lg p-4 bg-background-secondary"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-primary" />
                  <span className="text-sm font-medium text-text-primary">
                    {service?.label ?? stored.label}
                  </span>
                  {service?.docsUrl && (
                    <a
                      href={service.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-muted hover:text-primary transition-colors"
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRevealKey(stored.id)}
                    className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                    title={isRevealed ? t("apiKeys.hideKey") : t("apiKeys.showKey")}
                  >
                    {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={() => handleDeleteKey(stored.id)}
                    className="p-1.5 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                    title={t("apiKeys.deleteKey")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {service && (
                <p className="text-xs text-text-muted mb-2">
                  {service.description}
                </p>
              )}

              <div className="font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary">
                {isRevealed ? revealedKeys[stored.id] : t("apiKeys.maskedValue")}
              </div>

              <div className="text-[10px] text-text-muted mt-2">
                {t("apiKeys.addedUpdated", {
                  added: formatDate(stored.createdAt),
                  updated: formatDate(stored.updatedAt),
                })}
              </div>
            </div>
          );
        })}
      </div>

      {addingService ? (
        <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
          <div className="flex items-center gap-2 mb-3">
            <Plus size={14} className="text-primary" />
            <span className="text-sm font-medium text-text-primary">
              {t("apiKeys.addKey", {
                label: SERVICE_REGISTRY.find((s) => s.id === addingService)?.label ?? "",
              })}
            </span>
          </div>
          <Input
            type="password"
            value={newKeyValue}
            onChange={(e) => setNewKeyValue(e.target.value)}
            placeholder={t("apiKeys.placeholder")}
            autoFocus
            className="mb-3 font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAddingService(null);
                setNewKeyValue("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => handleSaveKey(addingService)}
              disabled={!newKeyValue.trim()}
            >
              {t("apiKeys.saveKey")}
            </Button>
          </div>
        </div>
      ) : availableServices.length > 0 ? (
        <div>
          <h4 className="text-sm font-medium text-text-secondary mb-3">
            {t("apiKeys.addApiKey")}
          </h4>
          <div className="grid gap-2">
            {availableServices.map((service) => (
              <button
                key={service.id}
                onClick={() => setAddingService(service.id)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
              >
                <div className="p-2 rounded-lg bg-background-tertiary group-hover:bg-primary/10 transition-colors">
                  <Plus
                    size={14}
                    className="text-text-muted group-hover:text-primary transition-colors"
                  />
                </div>
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {service.label}
                  </div>
                  <div className="text-xs text-text-muted">
                    {service.description}
                  </div>
                </div>
              </button>
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

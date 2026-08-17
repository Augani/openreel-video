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
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLink as Link } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
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
import { useTranslation } from "react-i18next";

export const ApiKeysPanel: React.FC = () => {
  const { t } = useTranslation();
  const { addConfiguredService, removeConfiguredService } =
    useSettingsStore();

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
      toast.error("Failed to decrypt", err instanceof Error ? err.message : "Unknown error");
    }
  }, [revealedKeys]);

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

  // Not set up yet
  if (!passwordSet) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Shield size={32} className="text-primary" aria-hidden />
        </div>
        <Text as="h3" type="large" weight="bold" display="block" className="mb-2">
          {t("Secure API Key Storage")}</Text>
        <Text as="p" type="supporting" color="secondary" display="block" className="mb-6 max-w-sm">
          {t("Set up a master password to encrypt and store your API keys locally. Keys are encrypted with AES-256-GCM and never leave your browser.")}</Text>
        <Button
          label={t("Set Up Master Password")}
          onClick={() => setPasswordDialogMode("setup")}
          variant="primary"
          icon={<KeyRound size={16} aria-hidden />}
        />

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
        <Text as="h3" type="large" weight="bold" display="block" className="mb-2">
          {t("Session Locked")}</Text>
        <Text as="p" type="supporting" color="secondary" display="block" className="mb-6 max-w-sm">
          {t("Enter your master password to view and manage API keys.")}</Text>
        <Button
          label={t("Unlock")}
          onClick={() => setPasswordDialogMode("unlock")}
          variant="primary"
          icon={<Unlock size={16} aria-hidden />}
        />

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
          <Text type="supporting" color="secondary">
            {storedKeys.length} {t(" key")}{storedKeys.length !== 1 ? "s" : ""} {t(" stored")}</Text>
        </div>
        <div className="flex items-center gap-2">
          <Button
            label={t("Change Password")}
            variant="secondary"
            size="sm"
            onClick={() => setPasswordDialogMode("change")}
            icon={<Key size={14} aria-hidden />}
          />
          <Button
            label={t("Lock")}
            variant="secondary"
            size="sm"
            onClick={handleLock}
            icon={<Lock size={14} aria-hidden />}
          />
        </div>
      </div>

      {/* Stored keys list */}
      <div className="space-y-3">
        {storedKeys.map((stored) => {
          const service = SERVICE_REGISTRY.find((s) => s.id === stored.id);
          const isRevealed = showKey[stored.id] && revealedKeys[stored.id];

          return (
            <Card
              key={stored.id}
              variant="muted"
              padding={4}
              className="border border-border"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-primary" aria-hidden />
                  <Text type="label" weight="bold">
                    {service?.label ?? stored.label}
                  </Text>
                  {service?.docsUrl && (
                    <Link
                      label={`${service.label} documentation`}
                      href={service.docsUrl}
                      isExternalLink
                      color="secondary"
                      className="text-text-muted hover:text-primary"
                    >
                      <ExternalLink size={12} aria-hidden />
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={isRevealed ? t("Hide key") : t("Show key")}
                    onClick={() => handleRevealKey(stored.id)}
                    variant="ghost"
                    size="sm"
                    icon={isRevealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  />
                  <IconButton
                    label={t("Delete key")}
                    onClick={() => handleDeleteKey(stored.id)}
                    variant="destructive"
                    size="sm"
                    icon={<Trash2 size={14} aria-hidden />}
                  />
                </div>
              </div>

              {service && (
                <Text as="p" type="supporting" color="secondary" display="block" className="mb-2">
                  {service.description}
                </Text>
              )}

              <Card variant="default" padding={2} className="font-mono text-xs text-text-secondary">
                {isRevealed
                  ? revealedKeys[stored.id]
                  : "••••••••••••••••••••••••••••••••"}
              </Card>

              <Text type="supporting" color="secondary" display="block" className="mt-2 text-[10px]">
                {t("Added ")}{new Date(stored.createdAt).toLocaleDateString()} {t(" · Updated ")}{new Date(stored.updatedAt).toLocaleDateString()}
              </Text>
            </Card>
          );
        })}
      </div>

      {/* Add new key */}
      {addingService ? (
        <Card variant="green" padding={4} className="border border-primary/30">
          <div className="flex items-center gap-2 mb-3">
            <Plus size={14} className="text-primary" aria-hidden />
            <Text type="label" weight="bold">
              {t("Add")}{" "}
              {t(SERVICE_REGISTRY.find((s) => s.id === addingService)?.label ?? "")} {t(" Key")}</Text>
          </div>
          <ToolcraftTextInputControl
            label={t("API key")}
            isLabelHidden
            type="password"
            value={newKeyValue}
            onChange={setNewKeyValue}
            placeholder={t("Paste your API key here")}
            hasAutoFocus
            width="100%"
            className="mb-3 font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              label={t("Cancel")}
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddingService(null);
                setNewKeyValue("");
              }}
            />
            <Button
              label={t("Save Key")}
              variant="primary"
              size="sm"
              onClick={() => handleSaveKey(addingService)}
              isDisabled={!newKeyValue.trim()}
            />
          </div>
        </Card>
      ) : availableServices.length > 0 ? (
        <div>
          <Text as="h3" type="label" weight="bold" color="secondary" display="block" className="mb-3">
            {t("Add API Key")}</Text>
          <div className="grid gap-2">
            {availableServices.map((service) => (
              <ClickableCard
                key={service.id}
                label={`Add ${service.label} API key`}
                onClick={() => setAddingService(service.id)}
                padding={3}
                variant="default"
                className="border border-border"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="p-2 rounded-lg bg-background-tertiary">
                    <Plus size={14} className="text-primary" aria-hidden />
                  </div>
                  <div>
                    <Text type="label" weight="bold" display="block">
                      {t(service.label)}
                    </Text>
                    <Text type="supporting" color="secondary" display="block">
                      {service.description}
                    </Text>
                  </div>
                </div>
              </ClickableCard>
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

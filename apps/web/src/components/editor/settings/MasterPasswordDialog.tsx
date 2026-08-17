import React, { useState, useCallback } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useTranslation } from "react-i18next";

interface MasterPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "setup" | "unlock" | "change";
  onSubmit: (password: string, newPassword?: string) => Promise<boolean>;
}

export const MasterPasswordDialog: React.FC<MasterPasswordDialogProps> = ({
  isOpen,
  onClose,
  mode,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowNewPassword(false);
    setError(null);
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "setup") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    if (mode === "change") {
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New passwords do not match");
        return;
      }
    }

    setLoading(true);
    try {
      const success = await onSubmit(
        password,
        mode === "change" ? newPassword : undefined,
      );
      if (success) {
        resetForm();
      } else {
        setError(
          mode === "unlock"
            ? "Incorrect password"
            : "Operation failed. Check your current password.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [mode, password, newPassword, confirmPassword, onSubmit, resetForm]);

  const titles = {
    setup: "Set Master Password",
    unlock: "Unlock Settings",
    change: "Change Master Password",
  };

  const descriptions = {
    setup: "Create a master password to encrypt your API keys. This password is never stored — only a verification hash is kept.",
    unlock: "Enter your master password to access encrypted API keys.",
    change: "Change your master password. All stored keys will be re-encrypted.",
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={titles[mode]}
            subtitle={descriptions[mode]}
            onOpenChange={(open) => !open && handleClose()}
            startContent={<Lock size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <form id="master-password-form" onSubmit={handleSubmit} className="space-y-4">
          {mode === "change" && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label={t("Current Password")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={t("Enter current password")}
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? t("Hide password") : t("Show password")}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "unlock") && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label={mode === "setup" ? t("Password") : t("Master Password")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={
                    mode === "setup"
                      ? t("Min. 8 characters")
                      : t("Enter master password")
                  }
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? t("Hide password") : t("Show password")}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "change") && (
            <>
              <div className="space-y-2">
                <div className="relative">
                  <ToolcraftTextInputControl
                    label={mode === "change" ? t("New Password") : t("Confirm Password")}
                    type={showNewPassword ? "text" : "password"}
                    value={mode === "change" ? newPassword : confirmPassword}
                    onChange={(value) =>
                      mode === "change"
                        ? setNewPassword(value)
                        : setConfirmPassword(value)
                    }
                    placeholder={
                      mode === "change"
                        ? t("Min. 8 characters")
                        : t("Repeat password")
                    }
                    width="100%"
                    className="pr-10"
                  />
                  <IconButton
                    label={showNewPassword ? t("Hide password") : t("Show password")}
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    variant="ghost"
                    size="sm"
                    icon={showNewPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  />
                </div>
              </div>

              {mode === "change" && (
                <div className="space-y-2">
                  <ToolcraftTextInputControl
                    label={t("Confirm New Password")}
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder={t("Repeat new password")}
                    width="100%"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <Card variant="red" padding={2} className="flex items-center gap-2 bg-error/10 text-sm text-error">
              <AlertTriangle size={14} />
              {error}
            </Card>
          )}

          {mode === "setup" && (
            <Card variant="muted" padding={2} className="flex items-start gap-2 bg-background-secondary">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
              <Text type="supporting" color="secondary" className="text-xs">
                {t("Your password is used to derive an encryption key via PBKDF2 (100k iterations). API keys are encrypted with AES-256-GCM. If you forget this password, stored keys cannot be recovered.")}</Text>
            </Card>
          )}
        </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex justify-end gap-2">
              <Button
                label={t("Cancel")}
                variant="secondary"
                onClick={handleClose}
                isDisabled={loading}
              />
              <Button
                label={
                  loading
                    ? t("Processing...")
                    : mode === "setup"
                      ? t("Set Password")
                      : mode === "unlock"
                        ? t("Unlock")
                        : t("Change Password")
                }
                type="submit"
                form="master-password-form"
                isDisabled={loading}
                variant="primary"
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};

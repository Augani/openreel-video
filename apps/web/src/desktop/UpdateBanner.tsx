import type { JSX } from "react";
import { useEffect, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import type { OpenReelUpdaterStatus } from "../types/global";
import { useTranslation } from "react-i18next";

// Notify → (consented) download → install. Subscribes to main-process update
// status and drives download/install through window.openreel.updater. The
// install path quits through the normal guarded flow, so unsaved changes are
// still protected.
export function UpdateBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OpenReelUpdaterStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const updater = window.openreel?.updater;
    if (!updater) return;
    return updater.onStatus((next) => {
      setStatus(next);
      if (next.state === "available" || next.state === "downloaded") {
        setDismissed(false);
      }
    });
  }, []);

  if (!status || dismissed) return null;

  const visible =
    status.state === "available" ||
    status.state === "downloading" ||
    status.state === "downloaded";
  if (!visible) return null;

  const card =
    "fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-bg-elev p-4 text-fg shadow-2xl";
  return (
    <div className={card} role="status" aria-live="polite">
      {status.state === "available" && (
        <>
          <Text type="body" weight="bold" display="block" className="text-sm">
            {t("Update ")}{status.version} {t(" available")}</Text>
          <Text type="supporting" color="secondary" display="block" className="mt-1 text-xs">
            {t("A new version of OpenReel is ready to download.")}</Text>
          <div className="mt-3 flex gap-2">
            <Button
              label={t("Download")}
              variant="primary"
              size="sm"
              onClick={() => void window.openreel?.updater.download()}
            />
            <Button
              label={t("Later")}
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
            />
          </div>
        </>
      )}

      {status.state === "downloading" && (
        <>
          <Text type="body" weight="bold" display="block" className="text-sm">
            {t("Downloading update…")}</Text>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${status.percent}%` }}
            />
          </div>
          <Text type="supporting" color="secondary" display="block" className="mt-1 text-xs">
            {status.percent}%
          </Text>
        </>
      )}

      {status.state === "downloaded" && (
        <>
          <Text type="body" weight="bold" display="block" className="text-sm">
            {t("Update ")}{status.version} {t(" ready")}</Text>
          <Text type="supporting" color="secondary" display="block" className="mt-1 text-xs">
            {t("Restart to install — you’ll be asked to save any unsaved changes first.")}</Text>
          <div className="mt-3 flex gap-2">
            <Button
              label={t("Restart & Install")}
              variant="primary"
              size="sm"
              onClick={() => void window.openreel?.updater.install()}
            />
            <Button
              label={t("Later")}
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
            />
          </div>
        </>
      )}
    </div>
  );
}

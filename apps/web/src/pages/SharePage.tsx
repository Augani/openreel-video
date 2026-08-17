import React, { useEffect, useState } from "react";
import {
  Play,
  Download,
  Clock,
  AlertCircle,
  ExternalLink,
  Loader2,
} from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftLink as Link,
  ToolcraftText as Text,
} from "@openreel/ui";
import {
  getShareInfo,
  getShareDownloadUrl,
  formatExpiresIn,
  isShareExpired,
  type ShareInfo,
} from "../services/share-service";
import { useTranslation } from "react-i18next";

interface SharePageProps {
  shareId: string;
}

type PageStatus = "loading" | "ready" | "expired" | "not-found" | "error";

export const SharePage: React.FC<SharePageProps> = ({ shareId }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadShareInfo = async () => {
      try {
        const info = await getShareInfo(shareId);
        if (!info) {
          setStatus("not-found");
          return;
        }

        if (isShareExpired(info.expiresAt)) {
          setStatus("expired");
          return;
        }

        setShareInfo(info);
        setStatus("ready");
      } catch (err) {
        if (err instanceof Error && err.message.includes("expired")) {
          setStatus("expired");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load share");
          setStatus("error");
        }
      }
    };

    loadShareInfo();
  }, [shareId]);

  const downloadUrl = getShareDownloadUrl(shareId);

  const handleCreateProject = () => {
    window.location.hash = "#/editor";
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = downloadUrl;
    if (shareInfo?.filename) {
      link.download = shareInfo.filename;
    }
    link.click();
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 size={48} className="text-primary animate-spin mx-auto" />
          <Text type="supporting" color="secondary" className="text-text-muted">{t("Loading video...")}</Text>
        </div>
      </div>
    );
  }

  if (status === "not-found") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="w-20 h-20 mx-auto bg-text-muted/10 rounded-full flex items-center justify-center">
            <AlertCircle size={40} className="text-text-muted" />
          </div>
          <div>
            <Text type="body" color="primary" weight="bold" className="text-2xl text-text-primary">
              {t("Video Not Found")}</Text>
            <Text type="supporting" color="secondary" className="text-text-muted mt-2">
              {t("This video doesn't exist or the link is invalid.")}</Text>
          </div>
          <Button
            label={t("Create Your Own Video")}
            icon={<ExternalLink size={18} aria-hidden />}
            variant="primary"
            size="lg"
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          />
        </div>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="w-20 h-20 mx-auto bg-warning/10 rounded-full flex items-center justify-center">
            <Clock size={40} className="text-warning" />
          </div>
          <div>
            <Text type="body" color="primary" weight="bold" className="text-2xl text-text-primary">
              {t("Link Expired")}</Text>
            <Text type="supporting" color="secondary" className="text-text-muted mt-2">
              {t("This share link has expired. Share links are only valid for 24 hours.")}</Text>
          </div>
          <Button
            label={t("Create Your Own Video")}
            icon={<ExternalLink size={18} aria-hidden />}
            variant="primary"
            size="lg"
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="w-20 h-20 mx-auto bg-error/10 rounded-full flex items-center justify-center">
            <AlertCircle size={40} className="text-error" />
          </div>
          <div>
            <Text type="body" color="primary" weight="bold" className="text-2xl text-text-primary">{t("Error")}</Text>
            <Text type="supporting" color="secondary" className="text-text-muted mt-2">
              {error || "Something went wrong"}
            </Text>
          </div>
          <Button
            label={t("Try Again")}
            variant="primary"
            size="lg"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <div className="text-center space-y-2">
          <Text type="body" color="primary" weight="bold" className="text-2xl text-text-primary">
            {shareInfo?.filename || "Shared Video"}
          </Text>
          {shareInfo && (
            <div className="flex items-center justify-center gap-4 text-sm text-text-muted">
              <span>{(shareInfo.size / (1024 * 1024)).toFixed(1)} MB</span>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Clock size={14} />
                <span>{formatExpiresIn(shareInfo.expiresAt)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-2xl">
          <video src={downloadUrl} controls className="w-full h-full" poster="">
            {t("Your browser does not support the video tag.")}</video>
        </div>

        <div className="flex items-center justify-center gap-4">
          <Button
            label={t("Download")}
            icon={<Download size={18} aria-hidden />}
            variant="primary"
            size="lg"
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          />
          <Button
            label={t("Create Your Own")}
            icon={<Play size={18} aria-hidden />}
            variant="secondary"
            size="lg"
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-background-secondary hover:bg-background-tertiary border border-border text-text-primary font-medium rounded-lg transition-colors"
          />
        </div>

        <div className="text-center">
          <Text type="supporting" color="secondary" className="text-xs text-text-muted">
            {t("Made with")}{" "}
            <Link href="#/editor" className="text-primary hover:underline">
              {t("Open Reel Video")}</Link>
          </Text>
        </div>
      </div>
    </div>
  );
};

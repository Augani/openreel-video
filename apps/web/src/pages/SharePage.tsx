import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Download,
  Clock,
  AlertCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  getShareInfo,
  getShareDownloadUrl,
  formatExpiresIn,
  isShareExpired,
  type ShareInfo,
} from "../services/share-service";

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

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 size={48} className="text-primary animate-spin mx-auto" />
          <p className="text-text-muted">{t("share.loading")}</p>
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
            <h1 className="text-2xl font-bold text-text-primary">
              {t("error.videoNotFound")}
            </h1>
            <p className="text-text-muted mt-2">
              {t("error.videoNotFoundDesc")}
            </p>
          </div>
          <button
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          >
            <ExternalLink size={18} />
            {t("share.createOwn")}
          </button>
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
            <h1 className="text-2xl font-bold text-text-primary">
              {t("error.linkExpired")}
            </h1>
            <p className="text-text-muted mt-2">
              {t("error.linkExpiredDesc")}
            </p>
          </div>
          <button
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          >
            <ExternalLink size={18} />
            {t("share.createOwn")}
          </button>
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
            <h1 className="text-2xl font-bold text-text-primary">{t("error.error")}</h1>
            <p className="text-text-muted mt-2">
              {error || t("error.somethingWrong")}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          >
            {t("error.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-text-primary">
            {shareInfo?.filename || t("share.sharedVideo")}
          </h1>
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
            Your browser does not support the video tag.
          </video>
        </div>

        <div className="flex items-center justify-center gap-4">
          <a
            href={downloadUrl}
            download={shareInfo?.filename}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          >
            <Download size={18} />
            {t("share.download")}
          </a>
          <button
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-background-secondary hover:bg-background-tertiary border border-border text-text-primary font-medium rounded-lg transition-colors"
          >
            <Play size={18} />
            {t("share.createOwnShort")}
          </button>
        </div>

        <div className="text-center">
          <p className="text-xs text-text-muted">
            {t("share.madeWith")}
          </p>
        </div>
      </div>
    </div>
  );
};

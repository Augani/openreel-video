import React, { useEffect, useState } from "react";
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
import { useI18n } from "../i18n";

interface SharePageProps {
  shareId: string;
}

type PageStatus = "loading" | "ready" | "expired" | "not-found" | "error";

export const SharePage: React.FC<SharePageProps> = ({ shareId }) => {
  const { t } = useI18n();
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
          setError(err instanceof Error ? err.message : t("share.error.default"));
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
              {t("share.notFound.title")}
            </h1>
            <p className="text-text-muted mt-2">
              {t("share.notFound.description")}
            </p>
          </div>
          <button
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          >
            <ExternalLink size={18} />
            {t("share.createOwnVideo")}
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
              {t("share.expired.title")}
            </h1>
            <p className="text-text-muted mt-2">
              {t("share.expired.description")}
            </p>
          </div>
          <button
            onClick={handleCreateProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          >
            <ExternalLink size={18} />
            {t("share.createOwnVideo")}
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
            <h1 className="text-2xl font-bold text-text-primary">{t("share.error.title")}</h1>
            <p className="text-text-muted mt-2">
              {error || t("share.error.default")}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors"
          >
            {t("share.tryAgain")}
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
            {shareInfo?.filename || t("share.defaultFilename")}
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
            {t("share.videoTagUnsupported")}
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
            {t("share.createOwn")}
          </button>
        </div>

        <div className="text-center">
          <p className="text-xs text-text-muted">
            {t("share.madeWith")}{" "}
            <a href="#/editor" className="text-primary hover:underline">
              Open Reel Video
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

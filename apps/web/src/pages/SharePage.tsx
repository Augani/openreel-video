import React, { useEffect, useState } from "react";
import {
  Play,
  Download,
  Clock,
  AlertCircle,
  ExternalLink,
  Loader2,
} from "@/icons/lucide-compat";
import { Button } from "@openreel/ui";
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
          <span className="text-[12px] leading-5 font-normal text-text-muted">Loading video...</span>
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
            <span className="font-bold text-2xl text-text-primary">
              Video Not Found
            </span>
            <span className="text-[12px] leading-5 font-normal text-text-muted mt-2">
              This video doesn't exist or the link is invalid.
            </span>
          </div>
          <Button onClick={handleCreateProject} type="button" aria-label="Create Your Own Video" className="min-w-0 justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 text-[13px] inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ExternalLink size={18} aria-hidden />}</span>
            <span className="truncate">{"Create Your Own Video"}</span>
          </Button>
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
            <span className="font-bold text-2xl text-text-primary">
              Link Expired
            </span>
            <span className="text-[12px] leading-5 font-normal text-text-muted mt-2">
              This share link has expired. Share links are only valid for 24
              hours.
            </span>
          </div>
          <Button onClick={handleCreateProject} type="button" aria-label="Create Your Own Video" className="min-w-0 justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 text-[13px] inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ExternalLink size={18} aria-hidden />}</span>
            <span className="truncate">{"Create Your Own Video"}</span>
          </Button>
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
            <span className="font-bold text-2xl text-text-primary">Error</span>
            <span className="text-[12px] leading-5 font-normal text-text-muted mt-2">
              {error || "Something went wrong"}
            </span>
          </div>
          <Button onClick={() => window.location.reload()} type="button" aria-label="Try Again" className="min-w-0 justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 text-[13px] inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors">
            <span className="truncate">{"Try Again"}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <div className="text-center space-y-2">
          <span className="font-bold text-2xl text-text-primary">
            {shareInfo?.filename || "Shared Video"}
          </span>
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
          <Button onClick={handleDownload} type="button" aria-label="Download" className="min-w-0 justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 text-[13px] inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-lg transition-colors">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Download size={18} aria-hidden />}</span>
            <span className="truncate">{"Download"}</span>
          </Button>
          <Button onClick={handleCreateProject} type="button" aria-label="Create Your Own" className="min-w-0 justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 text-[13px] hover:text-fg inline-flex items-center gap-2 px-6 py-3 bg-background-secondary hover:bg-background-tertiary border border-border text-text-primary font-medium rounded-lg transition-colors">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Play size={18} aria-hidden />}</span>
            <span className="truncate">{"Create Your Own"}</span>
          </Button>
        </div>

        <div className="text-center">
          <span className="font-normal text-xs text-text-muted">
            Made with{" "}
            <Button asChild variant="link" className="h-auto p-0 text-xs text-primary hover:underline">
              <a href="#/editor">Open Reel Video</a>
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
};

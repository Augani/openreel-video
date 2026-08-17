import type { JSX } from "react";
import type React from "react";
import { WindowControls } from "./WindowControls";
import { OpenReelMark } from "../brand/OpenReelMark";
import { useTranslation } from "react-i18next";

export function DesktopTitleBar({ platform, children }: { platform: string; children?: React.ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const isMac = platform === "darwin";
  return (
    <header
      className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-1 text-fg"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2" style={{ paddingLeft: isMac ? 76 : 12 }}>
        <OpenReelMark size={16} className="text-accent" />
        <span className="text-xs font-semibold tracking-wide text-fg-2">{t("OpenReel")}</span>
      </div>
      <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        {children}
      </div>
      <WindowControls platform={platform} />
    </header>
  );
}

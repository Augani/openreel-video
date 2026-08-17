import type { JSX } from "react";
import { useTranslation } from "react-i18next";

export function MotionBrandMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const dimension = Number.isFinite(size) && size > 0 ? size : 26;
  return (
    <svg
      width={dimension}
      height={dimension}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={t("OpenReel")}
    >
      <polygon points="16,2.5 16,16 4,16" fill="#2ee0a3" />
      <polygon points="16,2.5 28,16 16,16" fill="#16c08a" />
      <polygon points="4,16 16,16 16,29.5" fill="#11a877" />
      <polygon points="16,16 28,16 16,29.5" fill="#0c9067" />
      <polygon
        points="16,2.5 28,16 16,29.5 4,16"
        fill="none"
        stroke="#063f2d"
        strokeOpacity="0.35"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <line x1="16" y1="2.5" x2="16" y2="29.5" stroke="#063f2d" strokeOpacity="0.3" strokeWidth="0.8" />
      <line x1="4" y1="16" x2="28" y2="16" stroke="#063f2d" strokeOpacity="0.3" strokeWidth="0.8" />
    </svg>
  );
}

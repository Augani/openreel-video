import { useEffect, useState } from "react";
import { useT } from "@openreel/i18n/react";


function supportsBrowserEditing(): boolean {
  try {
    return typeof Blob !== "undefined" && typeof File !== "undefined" &&
      typeof URL.createObjectURL === "function" &&
      Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}

/** Gate missing browser APIs, allowing capable phones, tablets and computers. */
export function MobileBlocker() {
  const t = useT();
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => { setUnsupported(!supportsBrowserEditing()); }, []);
  if (!unsupported) return null;
  return (
    <div role="alert" className="fixed inset-0 z-[9999] bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <span className="text-[13px] leading-5 text-fg-2 font-bold block">{t("Your browser needs an update")}</span>
        <span className="text-[12px] leading-5 text-fg-2 font-normal block">{t("OpenReel needs local file access and canvas rendering. Open this page in a current browser to edit on your phone, tablet or computer.")}</span>
      </div>
    </div>
  );
}

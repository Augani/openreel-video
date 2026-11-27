import type { View } from "../App";
import { useT } from "@openreel/i18n/react";

export function StatusBar({ view }: { view: View }) {
  const t = useT();
  return (
    <footer className="flex h-[22px] items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 text-[10px] text-zinc-600">
      {view === "hub" ? (
        <span>{t("Ready")}</span>
      ) : (
        <>
          <span>{t("● Saved")}</span>
          <span className="ml-auto">{t("— ms/frame")}</span>
        </>
      )}
    </footer>
  );
}

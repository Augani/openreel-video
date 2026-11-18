import type { JSX } from "react";
import type React from "react";
import { Button } from "@openreel/ui";
import { Icon } from "@/icons/Icon";

export function WindowControls({ platform }: { platform: string }): JSX.Element | null {
  if (platform === "darwin") return null;
  const api = typeof window !== "undefined" ? window.openreel?.win : undefined;
  if (!api) return null;
  return (
    <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Button variant="ghost" size="icon-sm" onClick={() => void api.minimize()} type="button" aria-label="Minimize" title="Minimize" className="shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-transparent hover:text-fg grid h-10 w-11 place-items-center text-fg-2 hover:bg-hover">
        {<Icon name="minus" size={14} />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => void api.toggleMaximize()} type="button" aria-label="Maximize" title="Maximize" className="shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-transparent hover:text-fg grid h-10 w-11 place-items-center text-fg-2 hover:bg-hover">
        {<Icon name="square.on.square" size={13} />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => void api.close()} type="button" aria-label="Close" title="Close" className="shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-transparent grid h-10 w-11 place-items-center text-fg-2 hover:bg-red-600 hover:text-white">
        {<Icon name="xmark" size={14} />}
      </Button>
    </div>
  );
}

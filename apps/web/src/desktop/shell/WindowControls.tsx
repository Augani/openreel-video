import type { JSX } from "react";
import type React from "react";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { Icon } from "@/icons/Icon";

export function WindowControls({ platform }: { platform: string }): JSX.Element | null {
  if (platform === "darwin") return null;
  const api = typeof window !== "undefined" ? window.openreel?.win : undefined;
  if (!api) return null;
  return (
    <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <IconButton
        label="Minimize"
        icon={<Icon name="minus" size={14} />}
        variant="ghost"
        size="lg"
        className="grid h-10 w-11 place-items-center text-fg-2 hover:bg-hover"
        onClick={() => void api.minimize()}
      />
      <IconButton
        label="Maximize"
        icon={<Icon name="square.on.square" size={13} />}
        variant="ghost"
        size="lg"
        className="grid h-10 w-11 place-items-center text-fg-2 hover:bg-hover"
        onClick={() => void api.toggleMaximize()}
      />
      <IconButton
        label="Close"
        icon={<Icon name="xmark" size={14} />}
        variant="ghost"
        size="lg"
        className="grid h-10 w-11 place-items-center text-fg-2 hover:bg-red-600 hover:text-white"
        onClick={() => void api.close()}
      />
    </div>
  );
}

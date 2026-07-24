import type { JSX } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import "@astryxdesign/theme-neutral/theme.css";

import { useThemeStore } from "../../stores/theme-store";
import "./openreel-astryx-theme.css";

export function AstryxProvider({
  children,
}: {
  children: JSX.Element;
}): JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const astryxMode = mode === "auto" ? "system" : mode;

  return (
    <Theme theme={neutralTheme} mode={astryxMode}>
      {children}
    </Theme>
  );
}

import { createContext, useContext, type ReactNode } from "react";

export interface AppCommands {
  goHome(): void;
  newEffect(): void;
  newFilter(): void;
  newTemplate(): void;
  openPreset(id: string): void;
  openRecent(id: string): void;
  openTutorials(): void;
}

const Ctx = createContext<AppCommands | null>(null);

export function CommandsProvider({ app, children }: { app: AppCommands; children: ReactNode }) {
  return <Ctx.Provider value={app}>{children}</Ctx.Provider>;
}

export function useCommands(): AppCommands {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCommands must be used inside CommandsProvider");
  return c;
}

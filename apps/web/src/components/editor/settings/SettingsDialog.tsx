import { Suspense, lazy, useRef } from "react";
import { Settings, Key, Plug, Bot, FolderInput, HardDrive } from "@/icons/lucide-compat";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, ScrollArea, Tabs, TabsList, TabsTrigger, TabsContent } from "@openreel/ui";
import { useSettingsStore, type SettingsTab } from "../../../stores/settings-store";
import { GeneralPanel } from "./GeneralPanel";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { McpPanel } from "./McpPanel";
import { AISettingsPanel } from "./AISettingsPanel";

// Desktop only and rarely opened: its own chunk, off the editor bundle.
const WatchFoldersPanel = lazy(() => import("./WatchFoldersPanel"));
const RenderCachePanel = lazy(() => import("./RenderCachePanel"));

export function SettingsDialog() {
  const open = useSettingsStore(state => state.settingsOpen);
  const selected = useSettingsStore(state => state.settingsTab);
  const close = useSettingsStore(state => state.closeSettings);
  const openSettings = useSettingsStore(state => state.openSettings);
  const opener = useRef<HTMLElement | null>(null);
  const tabs: Array<{ id: SettingsTab; label: string; icon: typeof Settings }> = [
    { id: "general", label: "General", icon: Settings },
    { id: "ai-editor", label: "AI Editor", icon: Bot },
    { id: "api-keys", label: "API Keys", icon: Key },
    ...(typeof window !== "undefined" && window.openreel?.platform === "desktop" ? [{ id: "mcp" as const, label: "MCP", icon: Plug }] : []),
    { id: "render-cache" as const, label: "Render cache", icon: HardDrive },
    ...(typeof window !== "undefined" && window.openreel?.watchFolders ? [{ id: "watch-folders" as const, label: "Watch folders", icon: FolderInput }] : []),
  ];
  const value = tabs.some(tab => tab.id === selected) ? selected : "general";
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent className="flex h-[min(760px,calc(100dvh-32px))] w-[calc(100vw-24px)] max-w-[720px] flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg-1 p-0"
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }}>
      <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
        <DialogTitle className="flex items-center gap-2 text-sm"><Settings size={18} className="text-primary" aria-hidden />Settings</DialogTitle>
        <DialogDescription className="text-xs leading-5 text-fg-2">Configure preferences and manage API keys for external services.</DialogDescription>
      </DialogHeader>
      <Tabs value={value} onValueChange={next => openSettings(next as SettingsTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Settings" layoutId="settings-tabs" className="mx-5 mt-4 grid h-auto shrink-0 gap-0.5 rounded-md border border-border bg-bg-1 p-0.5" style={{ gridTemplateColumns: `repeat(${tabs.length},minmax(0,1fr))` }}>
          {tabs.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} className="h-8 min-w-0 gap-1.5 rounded px-2 text-xs"><Icon size={14} className="shrink-0" aria-hidden /><span className="truncate">{label}</span></TabsTrigger>)}
        </TabsList>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4">
            <TabsContent value="general" className="mt-0"><GeneralPanel /></TabsContent>
            <TabsContent value="ai-editor" className="mt-0"><AISettingsPanel /></TabsContent>
            <TabsContent value="api-keys" className="mt-0"><ApiKeysPanel /></TabsContent>
            {tabs.some(tab => tab.id === "mcp") && <TabsContent value="mcp" className="mt-0"><McpPanel /></TabsContent>}
            {value === "render-cache" && <TabsContent value="render-cache" className="mt-0"><Suspense fallback={<p className="text-xs text-fg-2">Loading…</p>}><RenderCachePanel /></Suspense></TabsContent>}
            {value === "watch-folders" && <TabsContent value="watch-folders" className="mt-0"><Suspense fallback={<p className="text-xs text-fg-2">Loading…</p>}><WatchFoldersPanel /></Suspense></TabsContent>}
          </div>
        </ScrollArea>
      </Tabs>
    </DialogContent>
  </Dialog>;
}

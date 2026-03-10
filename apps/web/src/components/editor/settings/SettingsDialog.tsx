import React, { useCallback } from "react";
import { Settings, Key } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { GeneralPanel } from "./GeneralPanel";
import { ApiKeysPanel } from "./ApiKeysPanel";

const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "api-keys", label: "API Keys", icon: Key },
] as const;

export const SettingsDialog: React.FC = () => {
  const { settingsOpen, settingsTab, closeSettings } = useSettingsStore();

  const setTab = useCallback((tab: string) => {
    useSettingsStore.setState({ settingsTab: tab });
  }, []);

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] bg-background flex flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings size={18} className="text-primary" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Configure preferences and manage API keys for external services.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-muted rounded-md">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-sm transition-colors ${
                settingsTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto pr-1 mt-2">
          {settingsTab === "general" && <GeneralPanel />}
          {settingsTab === "api-keys" && <ApiKeysPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
};

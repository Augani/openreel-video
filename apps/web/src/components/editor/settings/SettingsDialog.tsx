import React, { useCallback } from "react";
import { Settings, Key } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openreel/ui";
import { useSettingsStore, type SettingsTab } from "../../../stores/settings-store";
import { GeneralPanel } from "./GeneralPanel";
import { ApiKeysPanel } from "./ApiKeysPanel";

const TABS: readonly { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "api-keys", label: "API Keys", icon: Key },
];

export const SettingsDialog: React.FC = () => {
  const { settingsOpen, settingsTab, closeSettings, openSettings } = useSettingsStore();

  const setTab = useCallback((tab: SettingsTab) => {
    openSettings(tab);
  }, [openSettings]);

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

        <div role="tablist" aria-label="Settings" className="flex gap-1 p-1 bg-muted rounded-md">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={settingsTab === tab.id}
              aria-controls={`settings-tabpanel-${tab.id}`}
              id={`settings-tab-${tab.id}`}
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

        <div
          role="tabpanel"
          id={`settings-tabpanel-${settingsTab}`}
          aria-labelledby={`settings-tab-${settingsTab}`}
          className="flex-1 overflow-y-auto pr-1 mt-2"
        >
          {settingsTab === "general" && <GeneralPanel />}
          {settingsTab === "api-keys" && <ApiKeysPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
};

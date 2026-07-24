import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@openreel/ui";
import type { InspectorTabDef, InspectorTabId } from "../clip-tabs.config";

export interface InspectorTabsProps {
  tabs: InspectorTabDef[];
  activeId: InspectorTabId;
  onSelect: (id: InspectorTabId) => void;
}

export const InspectorTabs: React.FC<InspectorTabsProps> = ({ tabs, activeId, onSelect }) => {
  return (
    <Tabs
      value={activeId}
      onValueChange={(value) => onSelect(value as InspectorTabId)}
      className="shrink-0"
    >
      <TabsList
        aria-label="Inspector tabs"
        className="flex h-auto items-center justify-start gap-0.5 overflow-x-auto rounded-none border-b border-border bg-transparent px-2 py-1 scrollbar-none"
        layoutId="inspector-tabs"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              onClick={() => onSelect(tab.id)}
              className="h-7 gap-1.5 rounded-[7px] px-2 text-[12px] text-fg-3 data-[state=active]:text-fg"
            >
              <Icon size={13} aria-hidden />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
};

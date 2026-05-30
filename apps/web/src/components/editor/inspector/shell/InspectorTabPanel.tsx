import * as React from "react";

export interface InspectorTabPanelProps {
  tab: string;
  active: string;
  children: React.ReactNode;
}

export const InspectorTabPanel: React.FC<InspectorTabPanelProps> = ({ tab, active, children }) =>
  active === tab ? <div role="tabpanel">{children}</div> : null;

import { Tabs, TabsList, TabsTrigger } from "@openreel/ui";

export function WorkspaceTabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: React.ReactNode }[];
  label: string;
}) {
  const prefix = `workspace-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className="shrink-0 min-w-0"
    >
      <TabsList
        className="workspace-panel-tabs w-full justify-start rounded-none"
        aria-label={label}
        layoutId={label}
      >
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            id={`${prefix}-tab-${option.value}`}
            aria-controls={`${prefix}-panel`}
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The shared content region can be a sibling of the tab list without changing its flex layout. */
export function workspaceTabPanel(label: string, value: string) {
  const prefix = `workspace-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return {
    role: "tabpanel" as const,
    id: `${prefix}-panel`,
    "aria-labelledby": `${prefix}-tab-${value}`,
    tabIndex: 0,
  };
}

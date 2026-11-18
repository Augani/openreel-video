import {
  MessageSquare,
  Film,
  Music2,
  Type,
  Pencil,
  PanelsTopLeft,
  Shapes,
  Sparkles,
  BookText,
  SlidersHorizontal,
  Bookmark,
  MessageCircle,
  History,
} from "lucide-react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@openreel/ui";
import { useUIStore } from "../../stores/ui-store";
import {
  useEditorWorkspaceStore,
  type AssetSection,
} from "../../stores/editor-workspace-store";

const tools = [
  ["media", "Media", Film],
  ["audio", "Audio", Music2],
  ["text", "Text & captions", Type],
  ["effects", "Effects", Pencil],
  ["transitions", "Transitions", PanelsTopLeft],
  ["graphics", "Graphics", Shapes],
  ["ai", "AI Generate", Sparkles],
  ["recipes", "Recipes", BookText],
  ["markers", "Markers", Bookmark],
  ["comments", "Comments", MessageCircle],
  ["versions", "Versions", History],
] as const;

export function EditorActionRail() {
  const section = useEditorWorkspaceStore((s) => s.section);
  const setSection = useEditorWorkspaceStore((s) => s.setSection);
  const chatVisible = useUIStore((s) => s.panels.agentChat?.visible ?? false);
  const choose = (value: AssetSection) => {
    setSection(value);
    useUIStore.getState().setPanelVisible("agentChat", false);
  };
  const railButton = (
    label: string,
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
  ) => (
    <Tooltip key={label}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          className={`workspace-rail-button ${active ? "is-active" : ""}`}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <TooltipProvider delayDuration={350}>
      <nav
        data-tour="toolbar"
        aria-label="Editor tools"
        className="workspace-rail"
      >
        <div className="workspace-rail-scroll" data-testid="workspace-rail-scroll">
        {railButton(
          "AI Editor chat",
          chatVisible,
          () =>
            useUIStore.getState().setPanelVisible("agentChat", !chatVisible),
          <MessageSquare />,
        )}
        {tools.map(([value, label, Icon]) =>
          railButton(
            label,
            !chatVisible && section === value,
            () => choose(value),
            <Icon />,
          ),
        )}
        </div>
        {railButton(
          "Project settings",
          !chatVisible && section === "settings",
          () => choose("settings"),
          <SlidersHorizontal />,
        )}
      </nav>
    </TooltipProvider>
  );
}

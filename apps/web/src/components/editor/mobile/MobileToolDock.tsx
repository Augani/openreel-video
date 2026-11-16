import { Button } from "@openreel/ui";
import { MobileEditorIcon } from "./MobileEditorIcon";
import { MOBILE_CLIP_TOOLS, MOBILE_MAIN_TOOLS, type MobileToolId } from "./mobile-tools";

export function MobileToolDock({ selectionTitle, onTool, onDone, onBack, unavailable = [] }: {
  selectionTitle?: string;
  onTool: (id: MobileToolId) => void;
  onDone: () => void;
  onBack: () => void;
  unavailable?: readonly MobileToolId[];
}) {
  return <div className={`mobile-tool-dock ${selectionTitle ? "has-selection" : ""}`}>
    {selectionTitle && <div className="mobile-clip-heading">
      <Button variant="ghost" size="icon" aria-label="Back to main tools" className="mobile-clip-back" onClick={onBack}><MobileEditorIcon name="back"/></Button>
      <span>{selectionTitle}</span>
      <Button variant="ghost" className="mobile-clip-done" onClick={onDone}>Done</Button>
    </div>}
    <nav aria-label={selectionTitle ? "Selected clip tools" : "Editor workspace"} className="mobile-tool-row">
      {(selectionTitle ? MOBILE_CLIP_TOOLS : MOBILE_MAIN_TOOLS).map(tool => <Button
        key={tool.id} variant="ghost" className={`mobile-tool-button ${tool.id === "find" ? "is-find" : ""} ${tool.danger ? "is-danger" : ""}`}
        disabled={unavailable.includes(tool.id)} onClick={() => onTool(tool.id)}
      ><span className="mobile-tool-icon"><MobileEditorIcon name={tool.icon}/></span><span className="mobile-tool-label">{tool.label}</span></Button>)}
    </nav>
  </div>;
}

import { useState, type ReactNode } from "react";
import { Button } from "@openreel/ui";
import { useRouter } from "../../../hooks/use-router";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { ProjectSwitcher } from "../ProjectSwitcher";
import { WorkspaceSaveStatus } from "../WorkspaceSaveStatus";
import { MobileEditorIcon } from "./MobileEditorIcon";

export function MobileEditorHeader({onAI, onExport, menu, exportControl, exportLabel = "Export", exportDisabled = false}: {
  onAI: () => void; onExport: () => void; menu: ReactNode; exportControl?: ReactNode; exportLabel?: string; exportDisabled?: boolean;
}) {
  const project = useProjectStore(state => state.project);
  const [leaving, setLeaving] = useState(false);
  const {navigate} = useRouter();
  const android = /Android/i.test(navigator.userAgent);
  const back = async () => {
    if (leaving) return;
    setLeaving(true);
    try { await useProjectStore.getState().forceSave(); navigate("recent"); }
    catch { toast.error("Project could not be saved", "Your project is still open. Try saving it again."); }
    finally { setLeaving(false); }
  };
  return <div className="mobile-editor-topbar" data-platform={android ? "android" : "ios"}>
    <Button variant="ghost" size="icon" className="mobile-editor-icon-button" aria-label={android ? "Close project" : "Back to projects"} disabled={leaving} onClick={() => void back()}><MobileEditorIcon name={android ? "close" : "back"}/></Button>
    <div className="mobile-editor-title">
      <ProjectSwitcher menuContent={menu} trigger={<Button variant="ghost" aria-label="Project menu" className="mobile-editor-title-button"><strong>{project.name}</strong><span>{Math.min(project.settings.width, project.settings.height)}p · {project.settings.frameRate} fps · <WorkspaceSaveStatus/></span></Button>}/>
    </div>
    <Button className="mobile-editor-ai" aria-label="AI assist" onClick={onAI}><MobileEditorIcon name="sparkle" size={15}/>AI</Button>
    {exportControl ?? <Button className="mobile-editor-export" disabled={exportDisabled} onClick={onExport}>{exportLabel}</Button>}
  </div>;
}

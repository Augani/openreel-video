import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Button, Input, ScrollArea, DropdownMenu, DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@openreel/ui";
import { Film, PlayCircle, LoaderCircle } from "lucide-react";
import { MobileHomeIcon } from "./MobileHomeIcon";
import { checkForRecovery, autoSaveManager, type AutoSaveMetadata } from "../../services/auto-save";
import { saveCurrentProjectForReplacement } from "../../services/project-replacement";
import { getProjectPreview } from "../../services/project-preview-cache";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useRouter } from "../../hooks/use-router";
import { toast } from "../../stores/notification-store";
import "./mobile-project-home.css";

const TemplateGallery = lazy(() => import("./TemplateGallery").then(m => ({ default: m.TemplateGallery })));
const SettingsDialog = lazy(() => import("../editor/settings/SettingsDialog").then(m => ({ default: m.SettingsDialog })));
type HomeTab = "projects" | "templates" | "learn";
const formats = [
  { label: "Horizontal · 16:9", width: 1920, height: 1080 },
  { label: "Vertical · 9:16", width: 1080, height: 1920 },
  { label: "Square · 1:1", width: 1080, height: 1080 },
];

function savedAt(timestamp: number) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Edited just now";
  if (elapsed < 3_600_000) return `Edited ${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `Edited ${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 172_800_000) return "Yesterday";
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function durationLabel(duration: number) {
  const seconds = Math.max(0, Math.floor(duration));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function MobileProjectHome({ initialTab }: { initialTab?: "templates" | "recent" }) {
  const [tab, setTab] = useState<HomeTab>(initialTab === "templates" ? "templates" : "projects");
  const [saves, setSaves] = useState<AutoSaveMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const { navigate } = useRouter();
  const settingsOpen = useSettingsStore(s => s.settingsOpen);
  const android = /Android/i.test(navigator.userAgent);

  useEffect(() => {
    setTab(initialTab === "templates" ? "templates" : "projects");
    setShowAll(false);
  }, [initialTab]);

  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const currentRequest = ++request;
      try {
        const snapshots = await checkForRecovery();
        const latest = new Map<string, AutoSaveMetadata>();
        for (const save of snapshots) {
          if (save.timestamp > (latest.get(save.projectId)?.timestamp ?? -Infinity)) latest.set(save.projectId, save);
        }
        if (active && request === currentRequest) { setSaves([...latest.values()].sort((a, b) => b.timestamp - a.timestamp)); setLoadError(false); }
      } catch {
        if (active && request === currentRequest) setLoadError(true);
      } finally { if (active && request === currentRequest) setLoading(false); }
    };
    void load();
    autoSaveManager.on("saved", load);
    return () => { active = false; autoSaveManager.off("saved", load); };
  }, [loadAttempt]);

  const preserveCurrent = async () => {
    await saveCurrentProjectForReplacement(useProjectStore.getState().project.id);
  };
  const startEmpty = async (format = formats[0]) => {
    if (operation.current) return;
    operation.current = true; setOpening("new");
    try {
      await preserveCurrent();
      useProjectStore.getState().createNewProject("New Project", { width: format.width, height: format.height, frameRate: 30 });
      useEditorWorkspaceStore.getState().setSection("media");
      navigate("editor");
    } catch { toast.error("Project could not be saved", "Your current project is still open. Try saving it again."); }
    finally { operation.current = false; setOpening(null); }
  };
  const openEditor = async (mode: "record" | "ai" | "tour") => {
    if (operation.current) return;
    if (!useProjectStore.getState().hasOpenProject) useProjectStore.getState().createNewProject("New Project");
    if (mode === "ai") useUIStore.getState().setPanelVisible("agentChat", true);
    if (mode === "record") useUIStore.getState().openModal("recorder");
    navigate("editor");
    if (mode === "tour") (await import("../editor/tour/useTour")).startTour();
  };
  const importFiles = async (files: File[]) => {
    if (!files.length || operation.current) return;
    operation.current = true; setOpening("import");
    try {
      await preserveCurrent();
      useProjectStore.getState().createNewProject("New Project");
      const projectId = useProjectStore.getState().project.id;
      useEditorWorkspaceStore.getState().setSection("media");
      navigate("editor");
      for (const file of files) {
        if (useProjectStore.getState().project.id !== projectId) break;
        const result = await useProjectStore.getState().importMedia(file);
        if (!result.success) toast.error(`Could not import ${file.name}`, result.error?.message);
      }
    } catch { toast.error("Could not start the project", "Your current project is still available. Try again."); }
    finally { operation.current = false; setOpening(null); }
  };
  const openDraft = async (save: AutoSaveMetadata) => {
    if (operation.current) return;
    // A draft card for the open project resumes its live state, including unsaved edits.
    const current = useProjectStore.getState();
    if (current.hasOpenProject && current.project.id === save.projectId) { navigate("editor"); return; }
    operation.current = true;
    setOpening(save.id);
    try {
      await preserveCurrent();
      if (await useProjectStore.getState().recoverFromAutoSave(save.id)) navigate("editor");
      else toast.error("Could not open this draft", "The saved project is still available. Try again.");
    } catch { toast.error("Could not open this draft", "Try opening it again."); }
    finally { operation.current = false; setOpening(null); }
  };
  const matching = saves.filter(save => save.projectName.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = showAll || query ? matching : matching.slice(0, 4);

  return (
    <main className="mobile-project-home" data-platform={android ? "android" : "ios"}>
      <header className="mobile-project-header">
        <h1>{tab === "projects" ? "Projects" : tab === "templates" ? "Templates" : "Learn"}</h1>
        <Button variant="ghost" size="icon" aria-label="Search projects" onClick={() => { setTab("projects"); setSearching(!searching); if (searching) setQuery(""); }}><MobileHomeIcon name="search"/></Button>
        <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => useSettingsStore.getState().openSettings()}><MobileHomeIcon name="settings"/></Button>
      </header>
      <ScrollArea className="mobile-project-scroll">
        {tab === "projects" ? <div className="mobile-project-body">
          {searching && <Input autoFocus aria-label="Search drafts" placeholder="Search projects" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setQuery(""); setSearching(false); } }}/>} 
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button className="mobile-new-project" disabled={opening !== null}>
              <span className="mobile-new-icon"><MobileHomeIcon name="plus"/></span>
              <span><strong>New project</strong><small>Pick videos and photos from your {android ? "gallery" : "library"}</small></span>
            </Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-64">
              <DropdownMenuItem onSelect={() => fileInput.current?.click()}>Choose videos and photos…</DropdownMenuItem>
              <DropdownMenuSeparator/>
              {formats.map(format => <DropdownMenuItem key={format.label} onSelect={() => void startEmpty(format)}>Start empty · {format.label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Input ref={fileInput} className="sr-only" type="file" tabIndex={-1} multiple accept="video/*,image/*" aria-label="Media for a new project" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void importFiles(files); }}/>
          <div className="mobile-project-quick">
            <Button variant="ghost" disabled={opening !== null} onClick={() => void openEditor("record")}><span><MobileHomeIcon name="record"/></span><strong>Record</strong><small>Camera or screen</small></Button>
            <Button variant="ghost" disabled={opening !== null} className="is-ai" onClick={() => void openEditor("ai")}><span><MobileHomeIcon name="ai"/></span><strong>AI edit</strong><small>Describe it, we cut it</small></Button>
            <Button variant="ghost" onClick={() => setTab("templates")}><span><MobileHomeIcon name="templates"/></span><strong>Templates</strong><small>Swap in your clips</small></Button>
          </div>
          <section className="mobile-project-drafts" aria-label="Drafts">
            <div className="mobile-project-section-title"><h2>Drafts</h2><Button variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "See all"}</Button></div>
            {loading ? <p role="status">Loading drafts…</p> : loadError ? <div role="alert"><p>Drafts could not be loaded.</p><Button variant="ghost" onClick={() => { setLoading(true); setLoadAttempt(value => value + 1); }}>Retry</Button></div> : !visible.length ? <p className="mobile-project-empty">{query ? "No projects match your search." : "Your saved projects will appear here."}</p> : <div className="mobile-project-grid">
              {visible.map(save => {
                const preview = save.preview ?? getProjectPreview(save.projectId);
                return <Button variant="ghost" className="mobile-project-draft" key={save.projectId} disabled={opening !== null} aria-label={`Open ${save.projectName}`} onClick={() => void openDraft(save)}>
                  <span className="mobile-project-thumbnail">
                    {preview?.thumbnailUrl ? <img src={preview.thumbnailUrl} alt="" loading="lazy"/> : <Film size={28} aria-hidden/>}
                    {opening === save.id && <LoaderCircle className="animate-spin" aria-label="Opening project"/>}
                    {preview && <span>{durationLabel(preview.duration)}</span>}
                  </span>
                  <strong>{save.projectName}</strong><small>{savedAt(save.timestamp)}</small>
                </Button>;
              })}
            </div>}
          </section>
        </div> : tab === "templates" ? <div className="mobile-project-secondary"><Suspense fallback={<p role="status">Loading templates…</p>}><TemplateGallery onTemplateApplied={() => navigate("editor")}/></Suspense></div> : <section className="mobile-project-learn">
          <PlayCircle size={32}/><h2>Make your first edit</h2><p>Import your media, arrange clips on the timeline, add titles and audio, then export your video.</p>
          <Button onClick={() => void openEditor("tour")}>Take the editor tour</Button>
          <h2>Your project stays editable</h2><p>Use Undo to revisit a change. Open a clip’s properties to adjust its text, effects, animation or sound.</p>
        </section>}
      </ScrollArea>
      <nav className="mobile-project-nav" aria-label="Main">
        {([["projects", "Projects"], ["templates", "Templates"], ["learn", "Learn"]] as const).map(([value, label]) => <Button variant="ghost" aria-pressed={tab === value} className={tab === value ? "is-active" : ""} key={value} onClick={() => setTab(value)}><span><MobileHomeIcon name={value}/></span><small>{label}</small></Button>)}
      </nav>
      {settingsOpen && <Suspense fallback={null}><SettingsDialog/></Suspense>}
    </main>
  );
}

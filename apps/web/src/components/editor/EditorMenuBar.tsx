import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openEditorProject } from "../../services/project-replacement";
import { openMediaImport } from "../../services/open-media-import";
import { toast } from "../../stores/notification-store";
import { ArrowLeft, ChevronRight, Menu } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuLabel,
} from "@openreel/ui";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
} from "@openreel/ui/components/menubar";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useSettingsStore } from "../../stores/settings-store";
import { usePluginManagerStore } from "../../stores/plugin-manager-store";
import { useProjectManagerStore } from "../../stores/project-manager-store";
import {
  useEditorWorkspaceStore,
  type AssetSection,
} from "../../stores/editor-workspace-store";
import { keyboardShortcuts } from "../../services/keyboard-shortcuts";
import { renderCacheService } from "../../services/render-cache-service";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";
import { flattenMulticamCommand } from "../../services/multicam-controller";
import { useRouter } from "../../hooks/use-router";
import { launchEditorTour, launchMoGraphTour } from "./tour/tour-launch";
import { DOCS_URL, ISSUES_URL } from "./about-links";
import { useOnboardingStore } from "../../stores/onboarding-store";
import { openAudioChannelsForSelection } from "../../services/audio-channels";
import { runEnhanceSpeechCommand } from "../../services/enhance-speech";
import { canResetClipTransform, resetClipTransform } from "../../services/reset-clip-transform";

// Reset Transform enablement is a boolean derived from the selection and the project. Reading it
// as a snapshot keeps the menu bar out of the render that a timeline click triggers: it re-renders
// only when the answer changes, not whenever the selection array does.
function subscribeResetInputs(onChange: () => void) {
  const stopProject = useProjectStore.subscribe(onChange);
  const stopUI = useUIStore.subscribe((state, prev) => {
    if (state.selectedItems !== prev.selectedItems) onChange();
  });
  return () => { stopProject(); stopUI(); };
}

function readCanResetSelectedTransform(): boolean {
  const selected = useUIStore.getState().selectedItems;
  const selectedId = selected.length === 1 && ["clip", "text-clip", "shape-clip"].includes(selected[0].type) ? selected[0].id : undefined;
  return canResetClipTransform(useProjectStore.getState(), selectedId);
}
import { exportTimelineInterchange, openTimelineImport, useInterchangeExportPickerStore } from "../../services/timeline-interchange";
import { useWorkspaceLayoutStore, layoutsEqual } from "../../stores/workspace-layout-store";
import { getQuickExportPresets, type QuickExportPresetId } from "../../services/quick-export-presets";

const AboutDialog = lazy(() => import("./AboutDialog").then((m) => ({ default: m.AboutDialog })));

type MenuAction = { label: string; action: () => void; shortcut?: string; description?: string; disabled?: boolean };
type Entry = MenuAction | { label: string; children: MenuAction[]; disabled?: boolean; heading?: string } | null;
export function EditorMenuBar({
  onExport,
  onCompress,
  onQuickExport,
}: {
  onExport: () => void;
  onCompress: () => void;
  onQuickExport?: (preset: QuickExportPresetId) => void;
}) {
  const { navigate } = useRouter();
  const includeMarkers = useInterchangeExportPickerStore((s) => s.includeMarkers);
  const [compactPath, setCompactPath] = useState<string[]>([]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const compactContent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (compactContent.current?.dataset.state === "open") {
      compactContent.current.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();
    }
  }, [compactPath]);
  const canReset = useSyncExternalStore(subscribeResetInputs, readCanResetSelectedTransform);
  const exporting = useUIStore(state => state.exportState.isExporting);
  const applying = useUIStore(state => state.effectApplicationClipId !== null);
  const playbackLocked = useTimelineStore(state => !!state.playbackLockedReason);
  const projectSettings = useProjectStore(state => state.project.settings);
  const hasContent = useProjectStore(state => state.project.timeline.duration > 0);
  const userWorkspaces = useWorkspaceLayoutStore((s) => s.userWorkspaces);
  const activeWorkspaceId = useWorkspaceLayoutStore((s) => s.activeId);
  const liveLayout = useWorkspaceLayoutStore((s) => s.layout);
  const workspaces = useWorkspaceLayoutStore.getState().all();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const liveSection = useEditorWorkspaceStore((s) => s.section);
  const liveMixer = useUIStore((s) => s.panels.audioMixer?.visible ?? false);
  const liveChat = useUIStore((s) => s.panels.agentChat?.visible ?? false);
  const layoutChanged = !!activeWorkspace && !layoutsEqual(activeWorkspace.layout, { ...liveLayout, section: liveSection, mixerOpen: liveMixer, chatOpen: liveChat });
  const command = (id: string) => () => keyboardShortcuts.runCommand(id);
  const ui = () => useUIStore.getState();
  const section = (value: AssetSection) => () => {
    useEditorWorkspaceStore.getState().setSection(value);
    ui().setPanelVisible("agentChat", false);
  };
  const menus: Record<string, Entry[]> = {
    File: [
      { label: "New project…", action: () => navigate("new"), shortcut: "⌘N" },
      {
        label: "Open project…",
        action: () => {
          void openEditorProject().then((opened) => {
            if (opened) navigate("editor");
          }).catch((error: unknown) => {
            toast.error("Could not open project", error instanceof Error ? error.message : "Your current project is still open. Please try again.");
          });
        },
      },
      {
        label: "Import media…",
        action: openMediaImport,
        shortcut: "⌘I",
      },
      {
        label: "Record screen or camera…",
        action: () => ui().openModal("recorder"),
      },
      null,
      { label: "Save project…", action: command("file.save"), shortcut: "⌘S" },
      { label: "Save project as…", description: "Write the project to a new file and keep working in it", action: command("file.saveAs"), shortcut: "⇧⌘S" },
      { label: "Save version…", description: "Keep a named snapshot you can restore later", action: section("versions") },
      { label: "Export…", action: onExport, shortcut: "⌘E", disabled: exporting || applying || playbackLocked },
      ...(onQuickExport ? [{
        label: "Quick export",
        disabled: !hasContent || exporting || applying || playbackLocked,
        children: getQuickExportPresets(projectSettings).map(preset => ({
          label: preset.label,
          description: preset.description,
          action: () => onQuickExport(preset.id),
        })),
      }] : []),
      ...(window.openreel?.projectManager ? [{ label: "Project Manager…", description: "Collect or consolidate the project and its media into a new folder", disabled: exporting || applying, action: () => useProjectManagerStore.getState().setOpen(true) }] : []),
      { label: "Collaborate…", description: "Edit this project live with other people", action: command("collab.open"), shortcut: "⇧⌘J" },
      { label: "Compress video…", action: onCompress },
      { label: "Import captions…", description: "SRT, WebVTT, SBV, TTML / DFXP / iTT, SCC, MCC or EBU-STL as caption cues (one undo step); anything a format carries that OpenReel cannot show is listed", disabled: exporting || applying || playbackLocked, action: () => { void import("../../services/caption-file-import").then((module) => module.openCaptionImport()); } },
      { label: "Embed CEA-608 captions…", description: "Write the captions into an exported MP4 / MOV video stream (H.264 SEI), no re-encode", disabled: exporting || applying || playbackLocked, action: () => { void import("../../services/caption-sei").then((module) => module.openCea608Embed()); } },
      {
        label: "Export timeline",
        heading: "Hand off to another editor",
        disabled: !hasContent || exporting || applying || playbackLocked,
        children: [
          { label: "Timeline XML (Premiere/Resolve)", description: "Final Cut Pro 7 XML (xmeml v5)", action: () => exportTimelineInterchange("xmeml") },
          { label: "FCPXML (Final Cut)", description: "Final Cut Pro X, FCPXML 1.10", action: () => exportTimelineInterchange("fcpxml") },
          { label: "EDL", description: "CMX3600, one file per video track", action: () => exportTimelineInterchange("edl") },
          { label: "OpenTimelineIO", description: "OTIO JSON (Resolve, Avid, Premiere plugins)", action: () => exportTimelineInterchange("otio") },
          { label: "AAF (Avid/Premiere/Resolve)", description: "Edit only: tracks, speed, dissolves, levels, markers. Media is linked by path, not embedded", action: () => exportTimelineInterchange("aaf") },
          { label: includeMarkers ? "Include markers: on" : "Include markers: off", description: "Click to toggle whether exported timelines carry the project's markers", action: () => useInterchangeExportPickerStore.getState().setIncludeMarkers(!includeMarkers) },
          { label: "Choose sequence…", description: "Export any sequence, not only the active one", action: () => useInterchangeExportPickerStore.getState().setOpen(true) },
        ],
      },
      {
        label: "Import timeline",
        heading: "Bring in a sequence",
        disabled: exporting || applying || playbackLocked,
        children: [
          { label: "Timeline XML…", description: "Premiere/Resolve XML, FCPXML, OpenTimelineIO (.otio) or EDL", action: () => openTimelineImport("xml") },
          { label: "Premiere project (.prproj)…", description: "Sequences, clips, speed, motion, markers and dissolves; media is relinked to the bin by file name, the rest becomes offline placeholders", action: () => openTimelineImport("prproj") },
          { label: "AAF…", description: "Avid / Premiere / Resolve AAF; media is relinked to the bin by file name", action: () => openTimelineImport("aaf") },
        ],
      },
      null,
      {
        label: "Settings & API keys…",
        action: () => useSettingsStore.getState().openSettings(),
      },
      { label: "Back to home", action: () => navigate("welcome") },
    ],
    Edit: [
      {
        label: "Undo",
        action: () => {
          void useProjectStore.getState().undo();
        },
        shortcut: "⌘Z",
      },
      {
        label: "Redo",
        action: () => {
          void useProjectStore.getState().redo();
        },
        shortcut: "⇧⌘Z",
      },
      null,
      { label: "Cut", action: command("editing.cut"), shortcut: "⌘X" },
      { label: "Copy", action: command("editing.copy"), shortcut: "⌘C" },
      { label: "Paste", action: command("editing.paste"), shortcut: "⌘V" },
      {
        label: "Duplicate",
        action: command("editing.duplicate"),
        shortcut: "⌘D",
      },
      { label: "Delete", action: command("editing.delete"), shortcut: "⌫" },
      null,
      {
        label: "Select all",
        action: command("selection.selectAll"),
        shortcut: "⌘A",
      },
      {
        label: "Find a tool or effect…",
        action: () => ui().openModal("search"),
        shortcut: keyboardShortcuts.formatSearchPaletteHint(),
      },
    ],
    Clip: [
      {
        label: "Split at playhead",
        action: command("editing.split"),
        shortcut: "S",
      },
      {
        label: "Trim start to playhead",
        action: command("editing.trimStart"),
        shortcut: "Q",
      },
      {
        label: "Trim end to playhead",
        action: command("editing.trimEnd"),
        shortcut: "W",
      },
      {
        label: "Ripple delete",
        action: command("editing.rippleDelete"),
        shortcut: "⇧⌫",
      },
      null,
      { label: "Insert selected media", action: command("editing.insert"), shortcut: "," },
      { label: "Overwrite with selected media", action: command("editing.overwrite"), shortcut: "." },
      { label: "Replace clip from Source monitor", action: command("editing.replaceEdit"), shortcut: "⇧G" },
      { label: "Fit to Fill from Source monitor", action: command("editing.fitToFill"), shortcut: "⌥⇧F" },
      { label: "Lift In/Out range", action: command("editing.lift"), shortcut: ";" },
      { label: "Extract In/Out range", action: command("editing.extract"), shortcut: "'" },
      { label: "Add edit to all tracks", action: command("editing.addEditAllTracks"), shortcut: "⇧⌘K" },
      { label: "Add edit to targeted tracks", action: command("editing.addEdit"), shortcut: "⇧K" },
      { label: "Group", action: command("editing.group"), shortcut: "⌘G" },
      { label: "Ungroup", action: command("editing.ungroup"), shortcut: "⇧⌘G" },
      { label: "Apply default transition", action: command("editing.applyDefaultTransition"), shortcut: "⇧⌘D" },
      { label: "Paste insert", action: command("editing.pasteInsert"), shortcut: "⇧⌘V" },
      { label: "Toggle track target", action: command("tracks.toggleTarget"), shortcut: "⇧T" },
      { label: "Toggle sync lock", action: command("tracks.toggleSyncLock"), shortcut: "⇧Y" },
      { label: "Extend edit to playhead", action: command("editing.extendEdit"), shortcut: "E" },
      { label: "Extend video edit to playhead", action: command("editing.extendEditVideo"), shortcut: "⇧E" },
      { label: "Extend audio edit to playhead", action: command("editing.extendEditAudio"), shortcut: "⌥E" },
      { label: "J-cut (audio leads)", action: command("editing.jCut"), shortcut: "⌥J" },
      { label: "L-cut (audio trails)", action: command("editing.lCut"), shortcut: "⌥L" },
      { label: "Match frame", action: command("editing.matchFrame"), shortcut: "F" },
      { label: "Reverse match frame", action: command("editing.reverseMatchFrame"), shortcut: "⇧F" },
      null,
      { label: "Audio channels…", description: "Map source channels: left only, swap, mono, stereo, 5.1", action: () => { if (!openAudioChannelsForSelection()) toast.info("Select a clip with audio", "Audio channels applies to the selected clips."); } },
      { label: "Audio: Enhance Speech", description: "Remove noise and room reverb from the selected dialogue, on this device", disabled: exporting || applying || playbackLocked,
        action: () => { const ids = useUIStore.getState().getSelectedClipIds(); if (ids.length === 0) toast.info("Select a clip with audio", "Enhance Speech applies to the selected dialogue clips."); else void runEnhanceSpeechCommand(ids); } },
      { label: "Audio: Reduce Reverb", description: "Remove the late reverb tail from the selected dialogue, on this device", disabled: exporting || applying || playbackLocked,
        action: () => { const ids = useUIStore.getState().getSelectedClipIds(); if (ids.length === 0) toast.info("Select a clip with audio", "Reduce Reverb applies to the selected dialogue clips."); else void import("../../services/reduce-reverb").then((module) => module.runReduceReverbCommand(ids)); } },
      { label: "Speed/Duration…", description: "Speed, duration, reverse and pitch for the selected clips, with ripple", action: command("editing.speedDuration"), shortcut: "⌥⌘R" },
      null,
      { label: "Replace with linked composition", action: command("linked.replace"), shortcut: "⌥⌘L" },
      { label: "Open linked composition", action: command("linked.open"), shortcut: "⌥⌘O" },
      { label: "Render and replace", action: command("linked.render"), shortcut: "⇧⌥⌘R" },
      { label: "Restore unrendered", action: command("linked.restore"), shortcut: "⇧⌥⌘U" },
      null,
      { label: "Reset clip transform", disabled: !canReset || exporting || applying || playbackLocked,
        action: () => { const ids = useUIStore.getState().getSelectedClipIds(); if (ids.length === 1) void resetClipTransform(ids[0]); } },
      { label: "Add text", action: command("tools.addText") },
      { label: "Keyframe editor", action: () => ui().toggleKeyframeEditor() },
    ],
    Sequence: [
      { label: "Project settings", action: section("settings") },
      { label: "Create multi-camera source…", action: () => useEditorWorkspaceStore.getState().setMulticamSourceOpen(true) },
      { label: "Multi-camera monitor", action: () => useSourceMonitorStore.getState().setTab("multicam") },
      { label: "Flatten multi-camera", action: () => { void flattenMulticamCommand(); } },
      { label: "Multi-camera editing…", action: () => useEditorWorkspaceStore.getState().setMultiCameraOpen(true) },
      {
        label: "Add video track",
        action: () => {
          void useProjectStore.getState().addTrack("video");
        },
      },
      {
        label: "Add audio track",
        action: () => {
          void useProjectStore.getState().addTrack("audio");
        },
      },
      {
        label: "Fit timeline",
        action: command("timeline.fitTimeline"),
        shortcut: "⇧Z",
      },
      { label: "Toggle snapping", action: command("timeline.toggleSnap") },
      null,
      { label: "Render Effects In to Out", action: command("sequence.renderEffectsInToOut") },
      { label: "Render In to Out", action: command("sequence.renderInToOut"), shortcut: "↵" },
      { label: "Delete render files", action: () => { void renderCacheService.deleteRenderFiles(); } },
      null,
      {
        label: "Loop playback",
        action: () => {
          const s = useTimelineStore.getState();
          s.setLoopEnabled(!s.loopEnabled);
        },
      },
    ],
    Effects: [
      { label: "Video effects", action: section("effects") },
      { label: "Transitions", action: section("transitions") },
      { label: "Audio mixer", action: () => ui().togglePanel("audioMixer") },
      { label: "Recipes", action: section("recipes") },
      { label: "Markers", action: section("markers") },
      { label: "Media Browser", action: section("browser") },
      { label: "Metadata", action: section("metadata") },
      { label: "Review comments", action: section("comments") },
      { label: "Version history", action: section("versions") },
      { label: "Project templates", action: section("templates") },
      null,
      { label: "Manage plugins…", description: "Install effect plugins (.orplugin)", action: () => usePluginManagerStore.getState().setOpen(true) },
    ],
    View: [
      {
        label: "AI assist",
        action: () => ui().setPanelVisible("agentChat", true),
      },
      { label: "Action history", action: () => ui().openModal("history") },
      {
        label: "Project JSON / comments",
        action: () => ui().openModal("scriptView"),
      },
      {
        label: "Maximize timeline",
        action: () => ui().toggleTimelineMaximized(),
      },
      {
        label: "Keyboard shortcuts",
        action: command("view.showShortcuts"),
        shortcut: "?",
      },
    ],
    Window: [
      {
        label: "Workspaces",
        heading: "Switch layout",
        children: workspaces.map((w) => ({
          label: `${w.id === activeWorkspaceId ? "✓ " : ""}${w.name}${w.id === activeWorkspaceId && layoutChanged ? " (modified)" : ""}`,
          action: () => { useWorkspaceLayoutStore.getState().applyWorkspace(w.id); },
        })),
      },
      { label: "Save as new workspace…", action: () => useWorkspaceLayoutStore.getState().setSaveDialogOpen(true) },
      {
        label: "Reset workspace",
        description: activeWorkspace ? `Back to the saved ${activeWorkspace.name} layout` : undefined,
        disabled: !layoutChanged,
        action: () => useWorkspaceLayoutStore.getState().resetActiveWorkspace(),
      },
      {
        label: "Update saved workspace",
        disabled: !layoutChanged || !!activeWorkspace?.builtIn,
        action: () => { if (activeWorkspace) useWorkspaceLayoutStore.getState().updateWorkspace(activeWorkspace.id); },
      },
      ...(userWorkspaces.length
        ? [{
            label: "Delete workspace",
            heading: "Delete a saved workspace",
            children: userWorkspaces.map((w) => ({
              label: w.name,
              action: () => { useWorkspaceLayoutStore.getState().deleteWorkspace(w.id); },
            })),
          }]
        : []),
      null,
      { label: "Maximize timeline", action: () => ui().toggleTimelineMaximized() },
    ],
    Help: [
      {
        label: "Keyboard shortcuts",
        action: command("view.showShortcuts"),
        shortcut: "?",
      },
      { label: "Editor tour", action: launchEditorTour },
      { label: "Animation & effects tour", action: launchMoGraphTour },
      // The lessons sheet is hosted by the desktop shell only; the web build has no host for it.
      ...(window.openreel?.platform === "desktop"
        ? [{ label: "Learn OpenReel…", action: () => useOnboardingStore.getState().showSheet("lessons") }]
        : []),
      { label: "Documentation", action: () => { window.open(DOCS_URL, "_blank", "noopener,noreferrer"); } },
      { label: "Report an issue", action: () => { window.open(ISSUES_URL, "_blank", "noopener,noreferrer"); } },
      null,
      { label: "About OpenReel", action: () => setAboutOpen(true) },
      ...(window.openreel?.platform === "desktop"
        ? [
            null,
            {
              label: "Welcome & Setup…",
              action: () => {
                useOnboardingStore.getState().reopenBand();
                window.location.hash = "#/welcome";
              },
            },
            { label: "Connect an AI Agent…", action: () => useOnboardingStore.getState().showSheet("agent") },
            {
              label: "Reset onboarding",
              action: () => {
                useOnboardingStore.getState().reset();
                window.location.hash = "#/welcome";
              },
            },
          ]
        : []),
    ],
  };
  const compactParent = compactPath.length > 1
    ? menus[compactPath[0]]?.find(entry => entry?.label === compactPath[1])
    : undefined;
  const compactEntries = compactParent && "children" in compactParent
    ? compactParent.children : menus[compactPath[0]] ?? [];
  return (
    <>
      <Menubar
        aria-label="Application menu"
        className="workspace-menu h-auto space-x-0 border-0 rounded-none bg-transparent p-0 shadow-none"
      >
        {Object.entries(menus).map(([label, entries]) => (
          <MenubarMenu key={label}>
            <MenubarTrigger className="workspace-menu-trigger font-normal">
              {label}
            </MenubarTrigger>
            <MenubarContent className="min-w-56">
              {entries.map((entry, i) =>
                entry && "children" in entry ? (
                  <MenubarSub key={entry.label}>
                    <MenubarSubTrigger disabled={entry.disabled}>{entry.label}</MenubarSubTrigger>
                    <MenubarSubContent className="min-w-64">
                      <div className="px-2 py-1 text-xs text-fg-muted">{entry.heading ?? "Entire timeline"}</div>
                      {entry.children.map(child => <MenubarItem key={child.label} onSelect={child.action} className="flex-col items-start">
                        <span>{child.label}</span><span className="text-xs text-fg-muted">{child.description}</span>
                      </MenubarItem>)}
                    </MenubarSubContent>
                  </MenubarSub>
                ) : entry ? (
                  <MenubarItem key={entry.label} onSelect={entry.action} disabled={entry.disabled}>
                    {entry.label}
                    {entry.shortcut && (
                      <MenubarShortcut>{entry.shortcut}</MenubarShortcut>
                    )}
                  </MenubarItem>
                ) : (
                  <MenubarSeparator key={i} />
                ),
              )}
            </MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
      <DropdownMenu onOpenChange={open => { if (!open) setCompactPath([]); }}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="workspace-compact-menu"
            aria-label="Application menu"
          >
            <Menu size={17} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent ref={compactContent} align="start" collisionPadding={8}
          className="w-64 max-w-[calc(100vw-16px)] max-h-[75vh]"
          onKeyDown={event => { if (event.key === "ArrowLeft" && compactPath.length) { event.preventDefault(); setCompactPath(path => path.slice(0, -1)); } }}>
          {compactPath.length === 0 ? Object.keys(menus).map(label => (
            <DropdownMenuItem key={label} className="min-h-11" onSelect={event => { event.preventDefault(); setCompactPath([label]); }}
              onKeyDown={event => { if (event.key === "ArrowRight") { event.preventDefault(); setCompactPath([label]); } }}>
              {label}<ChevronRight className="ml-auto" />
            </DropdownMenuItem>
          )) : <>
            <DropdownMenuItem className="min-h-11" onSelect={event => { event.preventDefault(); setCompactPath(path => path.slice(0, -1)); }}>
              <ArrowLeft />Back to {compactPath.length > 1 ? compactPath[0] : "application menu"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{compactPath.at(-1)}{compactPath.length > 1 ? ` · ${compactParent && "children" in compactParent && compactParent.heading ? compactParent.heading : "Entire timeline"}` : ""}</DropdownMenuLabel>
            {compactEntries.map((entry, index) => entry ? (
              <DropdownMenuItem key={entry.label} disabled={entry.disabled}
                className={`min-h-11 ${"children" in entry || !entry.description ? "" : "flex-col items-start"}`}
                onSelect={event => { if ("children" in entry) { event.preventDefault(); setCompactPath(path => [...path, entry.label]); } else entry.action(); }}
                onKeyDown={event => { if ("children" in entry && event.key === "ArrowRight") { event.preventDefault(); setCompactPath(path => [...path, entry.label]); } }}>
                <span>{entry.label}</span>
                {"children" in entry ? <ChevronRight className="ml-auto" /> : <>
                  {entry.description && <span className="text-xs text-fg-muted">{entry.description}</span>}
                  {entry.shortcut && <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>}
                </>}
              </DropdownMenuItem>
            ) : <DropdownMenuSeparator key={index} />)}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
        </Suspense>
      )}
    </>
  );
}

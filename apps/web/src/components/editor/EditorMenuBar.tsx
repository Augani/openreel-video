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
import { useT } from "@openreel/i18n/react";

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
import { translateNow } from "@openreel/i18n/translate";

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
  const t = useT();
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
      { label: t("New project…"), action: () => navigate("new"), shortcut: "⌘N" },
      {
        label: t("Open project…"),
        action: () => {
          void openEditorProject().then((opened) => {
            if (opened) navigate("editor");
          }).catch((error: unknown) => {
            toast.error(translateNow("Could not open project"), error instanceof Error ? error.message : "Your current project is still open. Please try again.");
          });
        },
      },
      {
        label: t("Import media…"),
        action: openMediaImport,
        shortcut: "⌘I",
      },
      {
        label: t("Record screen or camera…"),
        action: () => ui().openModal("recorder"),
      },
      null,
      { label: t("Save project…"), action: command("file.save"), shortcut: "⌘S" },
      { label: t("Save project as…"), description: t("Write the project to a new file and keep working in it"), action: command("file.saveAs"), shortcut: "⇧⌘S" },
      { label: t("Save version…"), description: t("Keep a named snapshot you can restore later"), action: section("versions") },
      { label: t("Export…"), action: onExport, shortcut: "⌘E", disabled: exporting || applying || playbackLocked },
      ...(onQuickExport ? [{
        label: t("Quick export"),
        disabled: !hasContent || exporting || applying || playbackLocked,
        children: getQuickExportPresets(projectSettings).map(preset => ({
          label: t(preset.label),
          description: preset.description ? t(preset.description, preset.kind === "video" ? { width: preset.settings.width, height: preset.settings.height, fps: preset.settings.frameRate } : undefined) : undefined,
          action: () => onQuickExport(preset.id),
        })),
      }] : []),
      ...(window.openreel?.projectManager ? [{ label: t("Project Manager…"), description: t("Collect or consolidate the project and its media into a new folder"), disabled: exporting || applying, action: () => useProjectManagerStore.getState().setOpen(true) }] : []),
      { label: t("Collaborate…"), description: t("Edit this project live with other people"), action: command("collab.open"), shortcut: "⇧⌘J" },
      { label: t("Compress video…"), action: onCompress },
      { label: t("Import captions…"), description: t("SRT, WebVTT, SBV, TTML / DFXP / iTT, SCC, MCC or EBU-STL as caption cues (one undo step); anything a format carries that OpenReel cannot show is listed"), disabled: exporting || applying || playbackLocked, action: () => { void import("../../services/caption-file-import").then((module) => module.openCaptionImport()); } },
      { label: t("Embed CEA-608 captions…"), description: t("Write the captions into an exported MP4 / MOV video stream (H.264 SEI), no re-encode"), disabled: exporting || applying || playbackLocked, action: () => { void import("../../services/caption-sei").then((module) => module.openCea608Embed()); } },
      {
        label: t("Export timeline"),
        heading: t("Hand off to another editor"),
        disabled: !hasContent || exporting || applying || playbackLocked,
        children: [
          { label: t("Timeline XML (Premiere/Resolve)"), description: t("Final Cut Pro 7 XML (xmeml v5)"), action: () => exportTimelineInterchange("xmeml") },
          { label: t("FCPXML (Final Cut)"), description: t("Final Cut Pro X, FCPXML 1.10"), action: () => exportTimelineInterchange("fcpxml") },
          { label: t("EDL"), description: t("CMX3600, one file per video track"), action: () => exportTimelineInterchange("edl") },
          { label: t("OpenTimelineIO"), description: t("OTIO JSON (Resolve, Avid, Premiere plugins)"), action: () => exportTimelineInterchange("otio") },
          { label: t("AAF (Avid/Premiere/Resolve)"), description: t("Edit only: tracks, speed, dissolves, levels, markers. Media is linked by path, not embedded"), action: () => exportTimelineInterchange("aaf") },
          { label: includeMarkers ? t("Include markers: on") : t("Include markers: off"), description: t("Click to toggle whether exported timelines carry the project's markers"), action: () => useInterchangeExportPickerStore.getState().setIncludeMarkers(!includeMarkers) },
          { label: t("Choose sequence…"), description: t("Export any sequence, not only the active one"), action: () => useInterchangeExportPickerStore.getState().setOpen(true) },
        ],
      },
      {
        label: t("Import timeline"),
        heading: t("Bring in a sequence"),
        disabled: exporting || applying || playbackLocked,
        children: [
          { label: t("Timeline XML…"), description: t("Premiere/Resolve XML, FCPXML, OpenTimelineIO (.otio) or EDL"), action: () => openTimelineImport("xml") },
          { label: t("Premiere project (.prproj)…"), description: t("Sequences, clips, speed, motion, markers and dissolves; media is relinked to the bin by file name, the rest becomes offline placeholders"), action: () => openTimelineImport("prproj") },
          { label: t("AAF…"), description: t("Avid / Premiere / Resolve AAF; media is relinked to the bin by file name"), action: () => openTimelineImport("aaf") },
        ],
      },
      null,
      {
        label: t("Settings & API keys…"),
        action: () => useSettingsStore.getState().openSettings(),
      },
      { label: t("Back to home"), action: () => navigate("welcome") },
    ],
    Edit: [
      {
        label: t("Undo"),
        action: () => {
          void useProjectStore.getState().undo();
        },
        shortcut: "⌘Z",
      },
      {
        label: t("Redo"),
        action: () => {
          void useProjectStore.getState().redo();
        },
        shortcut: "⇧⌘Z",
      },
      null,
      { label: t("Cut"), action: command("editing.cut"), shortcut: "⌘X" },
      { label: t("Copy"), action: command("editing.copy"), shortcut: "⌘C" },
      { label: t("Paste"), action: command("editing.paste"), shortcut: "⌘V" },
      {
        label: t("Duplicate"),
        action: command("editing.duplicate"),
        shortcut: "⌘D",
      },
      { label: t("Delete"), action: command("editing.delete"), shortcut: "⌫" },
      null,
      {
        label: t("Select all"),
        action: command("selection.selectAll"),
        shortcut: "⌘A",
      },
      {
        label: t("Find a tool or effect…"),
        action: () => ui().openModal("search"),
        shortcut: keyboardShortcuts.formatSearchPaletteHint(),
      },
    ],
    Clip: [
      {
        label: t("Split at playhead"),
        action: command("editing.split"),
        shortcut: "S",
      },
      {
        label: t("Trim start to playhead"),
        action: command("editing.trimStart"),
        shortcut: "Q",
      },
      {
        label: t("Trim end to playhead"),
        action: command("editing.trimEnd"),
        shortcut: "W",
      },
      {
        label: t("Ripple delete"),
        action: command("editing.rippleDelete"),
        shortcut: "⇧⌫",
      },
      null,
      { label: t("Insert selected media"), action: command("editing.insert"), shortcut: "," },
      { label: t("Overwrite with selected media"), action: command("editing.overwrite"), shortcut: "." },
      { label: t("Replace clip from Source monitor"), action: command("editing.replaceEdit"), shortcut: "⇧G" },
      { label: t("Fit to Fill from Source monitor"), action: command("editing.fitToFill"), shortcut: "⌥⇧F" },
      { label: t("Lift In/Out range"), action: command("editing.lift"), shortcut: ";" },
      { label: t("Extract In/Out range"), action: command("editing.extract"), shortcut: "'" },
      { label: t("Add edit to all tracks"), action: command("editing.addEditAllTracks"), shortcut: "⇧⌘K" },
      { label: t("Add edit to targeted tracks"), action: command("editing.addEdit"), shortcut: "⇧K" },
      { label: t("Group"), action: command("editing.group"), shortcut: "⌘G" },
      { label: t("Ungroup"), action: command("editing.ungroup"), shortcut: "⇧⌘G" },
      { label: t("Apply default transition"), action: command("editing.applyDefaultTransition"), shortcut: "⇧⌘D" },
      { label: t("Paste insert"), action: command("editing.pasteInsert"), shortcut: "⇧⌘V" },
      { label: t("Toggle track target"), action: command("tracks.toggleTarget"), shortcut: "⇧T" },
      { label: t("Toggle sync lock"), action: command("tracks.toggleSyncLock"), shortcut: "⇧Y" },
      { label: t("Extend edit to playhead"), action: command("editing.extendEdit"), shortcut: "E" },
      { label: t("Extend video edit to playhead"), action: command("editing.extendEditVideo"), shortcut: "⇧E" },
      { label: t("Extend audio edit to playhead"), action: command("editing.extendEditAudio"), shortcut: "⌥E" },
      { label: t("J-cut (audio leads)"), action: command("editing.jCut"), shortcut: "⌥J" },
      { label: t("L-cut (audio trails)"), action: command("editing.lCut"), shortcut: "⌥L" },
      { label: t("Match frame"), action: command("editing.matchFrame"), shortcut: "F" },
      { label: t("Reverse match frame"), action: command("editing.reverseMatchFrame"), shortcut: "⇧F" },
      null,
      { label: t("Audio channels…"), description: t("Map source channels: left only, swap, mono, stereo, 5.1"), action: () => { if (!openAudioChannelsForSelection()) toast.info(translateNow("Select a clip with audio"), "Audio channels applies to the selected clips."); } },
      { label: t("Audio: Enhance Speech"), description: t("Remove noise and room reverb from the selected dialogue, on this device"), disabled: exporting || applying || playbackLocked,
        action: () => { const ids = useUIStore.getState().getSelectedClipIds(); if (ids.length === 0) toast.info(translateNow("Select a clip with audio"), "Enhance Speech applies to the selected dialogue clips."); else void runEnhanceSpeechCommand(ids); } },
      { label: t("Audio: Reduce Reverb"), description: t("Remove the late reverb tail from the selected dialogue, on this device"), disabled: exporting || applying || playbackLocked,
        action: () => { const ids = useUIStore.getState().getSelectedClipIds(); if (ids.length === 0) toast.info(translateNow("Select a clip with audio"), "Reduce Reverb applies to the selected dialogue clips."); else void import("../../services/reduce-reverb").then((module) => module.runReduceReverbCommand(ids)); } },
      { label: t("Speed/Duration…"), description: t("Speed, duration, reverse and pitch for the selected clips, with ripple"), action: command("editing.speedDuration"), shortcut: "⌥⌘R" },
      null,
      { label: t("Replace with linked composition"), action: command("linked.replace"), shortcut: "⌥⌘L" },
      { label: t("Open linked composition"), action: command("linked.open"), shortcut: "⌥⌘O" },
      { label: t("Render and replace"), action: command("linked.render"), shortcut: "⇧⌥⌘R" },
      { label: t("Restore unrendered"), action: command("linked.restore"), shortcut: "⇧⌥⌘U" },
      null,
      { label: t("Reset clip transform"), disabled: !canReset || exporting || applying || playbackLocked,
        action: () => { const ids = useUIStore.getState().getSelectedClipIds(); if (ids.length === 1) void resetClipTransform(ids[0]); } },
      { label: t("Add text"), action: command("tools.addText") },
      { label: t("Keyframe editor"), action: () => ui().toggleKeyframeEditor() },
    ],
    Sequence: [
      { label: t("Project settings"), action: section("settings") },
      { label: t("Create multi-camera source…"), action: () => useEditorWorkspaceStore.getState().setMulticamSourceOpen(true) },
      { label: t("Multi-camera monitor"), action: () => useSourceMonitorStore.getState().setTab("multicam") },
      { label: t("Flatten multi-camera"), action: () => { void flattenMulticamCommand(); } },
      { label: t("Multi-camera editing…"), action: () => useEditorWorkspaceStore.getState().setMultiCameraOpen(true) },
      {
        label: t("Add video track"),
        action: () => {
          void useProjectStore.getState().addTrack("video");
        },
      },
      {
        label: t("Add audio track"),
        action: () => {
          void useProjectStore.getState().addTrack("audio");
        },
      },
      {
        label: t("Fit timeline"),
        action: command("timeline.fitTimeline"),
        shortcut: "⇧Z",
      },
      { label: t("Toggle snapping"), action: command("timeline.toggleSnap") },
      null,
      { label: t("Render Effects In to Out"), action: command("sequence.renderEffectsInToOut") },
      { label: t("Render In to Out"), action: command("sequence.renderInToOut"), shortcut: "↵" },
      { label: t("Delete render files"), action: () => { void renderCacheService.deleteRenderFiles(); } },
      null,
      {
        label: t("Loop playback"),
        action: () => {
          const s = useTimelineStore.getState();
          s.setLoopEnabled(!s.loopEnabled);
        },
      },
    ],
    Effects: [
      { label: t("Video effects"), action: section("effects") },
      { label: t("Transitions"), action: section("transitions") },
      { label: t("Audio mixer"), action: () => ui().togglePanel("audioMixer") },
      { label: t("Recipes"), action: section("recipes") },
      { label: t("Markers"), action: section("markers") },
      { label: t("Media Browser"), action: section("browser") },
      { label: t("Metadata"), action: section("metadata") },
      { label: t("Review comments"), action: section("comments") },
      { label: t("Version history"), action: section("versions") },
      { label: t("Project templates"), action: section("templates") },
      null,
      { label: t("Manage plugins…"), description: t("Install effect plugins (.orplugin)"), action: () => usePluginManagerStore.getState().setOpen(true) },
    ],
    View: [
      {
        label: t("AI assist"),
        action: () => ui().setPanelVisible("agentChat", true),
      },
      { label: t("Action history"), action: () => ui().openModal("history") },
      {
        label: t("Project JSON / comments"),
        action: () => ui().openModal("scriptView"),
      },
      {
        label: t("Maximize timeline"),
        action: () => ui().toggleTimelineMaximized(),
      },
      {
        label: t("Keyboard shortcuts"),
        action: command("view.showShortcuts"),
        shortcut: "?",
      },
    ],
    Window: [
      {
        label: t("Workspaces"),
        heading: t("Switch layout"),
        children: workspaces.map((w) => ({
          label: `${w.id === activeWorkspaceId ? "✓ " : ""}${w.name}${w.id === activeWorkspaceId && layoutChanged ? t(" (modified)") : ""}`,
          action: () => { useWorkspaceLayoutStore.getState().applyWorkspace(w.id); },
        })),
      },
      { label: t("Save as new workspace…"), action: () => useWorkspaceLayoutStore.getState().setSaveDialogOpen(true) },
      {
        label: t("Reset workspace"),
        description: activeWorkspace ? t("Back to the saved {name} layout", { name: activeWorkspace.name }) : undefined,
        disabled: !layoutChanged,
        action: () => useWorkspaceLayoutStore.getState().resetActiveWorkspace(),
      },
      {
        label: t("Update saved workspace"),
        disabled: !layoutChanged || !!activeWorkspace?.builtIn,
        action: () => { if (activeWorkspace) useWorkspaceLayoutStore.getState().updateWorkspace(activeWorkspace.id); },
      },
      ...(userWorkspaces.length
        ? [{
            label: t("Delete workspace"),
            heading: t("Delete a saved workspace"),
            children: userWorkspaces.map((w) => ({
              label: w.name,
              action: () => { useWorkspaceLayoutStore.getState().deleteWorkspace(w.id); },
            })),
          }]
        : []),
      null,
      { label: t("Maximize timeline"), action: () => ui().toggleTimelineMaximized() },
    ],
    Help: [
      {
        label: t("Keyboard shortcuts"),
        action: command("view.showShortcuts"),
        shortcut: "?",
      },
      { label: t("Editor tour"), action: launchEditorTour },
      { label: t("Animation & effects tour"), action: launchMoGraphTour },
      // The lessons sheet is hosted by the desktop shell only; the web build has no host for it.
      ...(window.openreel?.platform === "desktop"
        ? [{ label: t("Learn OpenReel…"), action: () => useOnboardingStore.getState().showSheet("lessons") }]
        : []),
      { label: t("Documentation"), action: () => { window.open(DOCS_URL, "_blank", "noopener,noreferrer"); } },
      { label: t("Report an issue"), action: () => { window.open(ISSUES_URL, "_blank", "noopener,noreferrer"); } },
      null,
      { label: t("About OpenReel"), action: () => setAboutOpen(true) },
      ...(window.openreel?.platform === "desktop"
        ? [
            null,
            {
              label: t("Welcome & Setup…"),
              action: () => {
                useOnboardingStore.getState().reopenBand();
                window.location.hash = "#/welcome";
              },
            },
            { label: t("Connect an AI Agent…"), action: () => useOnboardingStore.getState().showSheet("agent") },
            {
              label: t("Reset onboarding"),
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
        aria-label={t("Application menu")}
        className="workspace-menu h-auto space-x-0 border-0 rounded-none bg-transparent p-0 shadow-none"
      >
        {Object.entries(menus).map(([label, entries]) => (
          <MenubarMenu key={label}>
            <MenubarTrigger className="workspace-menu-trigger font-normal">
              {t(label)}
            </MenubarTrigger>
            <MenubarContent className="min-w-56">
              {entries.map((entry, i) =>
                entry && "children" in entry ? (
                  <MenubarSub key={entry.label}>
                    <MenubarSubTrigger disabled={entry.disabled}>{t(entry.label)}</MenubarSubTrigger>
                    <MenubarSubContent className="min-w-64">
                      <div className="px-2 py-1 text-xs text-fg-muted">{entry.heading ?? t("Entire timeline")}</div>
                      {entry.children.map(child => <MenubarItem key={child.label} onSelect={child.action} className="flex-col items-start">
                        <span>{t(child.label)}</span><span className="text-xs text-fg-muted">{t(child.description ?? "")}</span>
                      </MenubarItem>)}
                    </MenubarSubContent>
                  </MenubarSub>
                ) : entry ? (
                  <MenubarItem key={entry.label} onSelect={entry.action} disabled={entry.disabled}>
                    {t(entry.label)}
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
            aria-label={t("Application menu")}
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
              {t(label)}<ChevronRight className="ml-auto" />
            </DropdownMenuItem>
          )) : <>
            <DropdownMenuItem className="min-h-11" onSelect={event => { event.preventDefault(); setCompactPath(path => path.slice(0, -1)); }}>
              <ArrowLeft />{t("Back to {name}", { name: t(compactPath.length > 1 ? compactPath[0] : "application menu") })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t(compactPath.at(-1) ?? "")}{compactPath.length > 1 ? ` · ${compactParent && "children" in compactParent && compactParent.heading ? compactParent.heading : t("Entire timeline")}` : ""}</DropdownMenuLabel>
            {compactEntries.map((entry, index) => entry ? (
              <DropdownMenuItem key={entry.label} disabled={entry.disabled}
                className={`min-h-11 ${"children" in entry || !entry.description ? "" : "flex-col items-start"}`}
                onSelect={event => { if ("children" in entry) { event.preventDefault(); setCompactPath(path => [...path, entry.label]); } else entry.action(); }}
                onKeyDown={event => { if ("children" in entry && event.key === "ArrowRight") { event.preventDefault(); setCompactPath(path => [...path, entry.label]); } }}>
                <span>{t(entry.label)}</span>
                {"children" in entry ? <ChevronRight className="ml-auto" /> : <>
                  {t(entry.description ?? "") && <span className="text-xs text-fg-muted">{t(entry.description ?? "")}</span>}
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

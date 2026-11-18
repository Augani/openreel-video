import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
  ScrollArea,
} from "@openreel/ui";
import { BookmarkPlus, Trash2 } from "lucide-react";
import { toast } from "../../stores/notification-store";
import type { TextStyle } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { insertTimelineOverlay } from "../../stores/project/insert-timeline-overlay";
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";
import {
  CAPTION_STYLE_PRESETS,
  WHISPER_LANGUAGES,
} from "./inspector/AutoCaptionPanel";
import { CaptionStyleCards } from "./inspector/CaptionStyleCards";
import { CaptionWorkspace } from "./CaptionWorkspace";
import { TranscriptPanel } from "./TranscriptPanel";
import { CaptionQcPanel } from "./CaptionQcPanel";
import { createCaptionSourceSummarySelector } from "../../services/caption-source";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { TextPresetPreview, type PreviewLine } from "./TextPresetPreview";
import {
  addLowerThird,
  LOWER_THIRD_PRESETS,
  type LowerThirdPresetId,
} from "../../services/lower-third-presets";

type TitlePreset = { name: string; text: string; style: Partial<TextStyle> };
const referenceTitles: TitlePreset[] = [
  {
    name: "Bold Title",
    text: "Your Title",
    style: {
      fontSize: 96,
      fontWeight: 800,
      color: "#fff6e6",
      strokeWidth: 0,
      letterSpacing: -2,
    },
  },
  {
    name: "Chapter One",
    text: "Chapter One",
    style: {
      fontFamily: "Fraunces",
      fontSize: 88,
      fontWeight: 600,
      color: "#f2e6d0",
      strokeWidth: 0,
    },
  },
  {
    name: "Minimal",
    text: "MINIMAL",
    style: {
      fontSize: 56,
      fontWeight: 600,
      letterSpacing: 12,
      color: "#e6e7eb",
      strokeWidth: 0,
    },
  },
  {
    name: "Breaking",
    text: "BREAKING",
    style: {
      fontFamily: "Space Grotesk",
      fontSize: 72,
      fontWeight: 700,
      backgroundColor: "#f5d547",
      color: "#111111",
      strokeWidth: 0,
    },
  },
];
export function WorkspaceTextPanel({
  presets,
  defaultStyle,
}: {
  presets: readonly { name: string; text: string; style: Partial<TextStyle> }[];
  defaultStyle: Partial<TextStyle>;
}) {
  const tab = useEditorWorkspaceStore((s) => s.textSource);
  const setTab = useEditorWorkspaceStore((s) => s.setTextSource);
  const [showAll, setShowAll] = useState(false);
  const phone = usePhoneEditor();
  const mobileCaptionsOpen = useEditorWorkspaceStore(s => s.mobileCaptionsOpen);
  const [captionMounted, setCaptionMounted] = useState(tab === "captions" || mobileCaptionsOpen);
  useEffect(() => { if (tab === "captions" || mobileCaptionsOpen) setCaptionMounted(true); }, [tab, mobileCaptionsOpen]);
  const [language, setLanguage] = useState("en");
  const [captionStyle, setCaptionStyle] = useState("pop-words");
  const [addingLowerThird, setAddingLowerThird] = useState(false);
  const projectId = useProjectStore((s) => s.project.id);
  const selected = useUIStore((s) => s.selectedItems);
  const selectedTextId = selected.find((s) => s.type === "text-clip")?.id;
  const selectedText = useProjectStore((s) => selectedTextId ? s.project.textClips?.find(
    (clip) => clip.id === selectedTextId,
  ) : undefined);
  const readCaptionSummary = useMemo(() => createCaptionSourceSummarySelector(selected), [selected]);
  const captionSummary = useProjectStore((s) => readCaptionSummary(s.project));
  const add = async (text: string, style: Partial<TextStyle>) => {
    const time = useTimelineStore.getState().playheadPosition;
    const created = await insertTimelineOverlay(time, 5, (trackId) =>
      useProjectStore.getState().createTextClip(trackId, time, text, 5, style),
    );
    if (created)
      useUIStore.getState().select({
        type: "text-clip",
        id: created.id,
        trackId: created.trackId,
      });
  };
  const addLowerThirdPreset = async (presetId: LowerThirdPresetId) => {
    setAddingLowerThird(true);
    try {
      const [primary] = await addLowerThird(
        presetId,
        useTimelineStore.getState().playheadPosition,
      );
      useUIStore.getState().select({ type: "text-clip", ...primary });
    } catch (error) {
      toast.error(
        "Could not add lower third",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setAddingLowerThird(false);
    }
  };
  return (
    <div className="workspace-text-panel flex flex-col min-h-0 h-full">
      <WorkspaceTabs
        label="Text sections"
        value={tab}
        onChange={value => { setTab(value); if (phone && value === "captions") useEditorWorkspaceStore.getState().setMobileCaptionsOpen(true); }}
        options={[
          { value: "text", label: "Text" },
          { value: "captions", label: "Captions" },
          { value: "transcript", label: "Transcript" },
          { value: "qc", label: <span title="Caption QC: reading speed, rows, durations, gaps">QC</span> },
          { value: "saved", label: "Saved styles" },
        ]}
      />
      <ScrollArea
        {...workspaceTabPanel("Text sections", tab === "captions" ? "text" : tab)}
        className="workspace-text-library flex-1 min-h-0"
        hidden={tab === "captions" || tab === "transcript" || tab === "qc"}
      >
        <div className={tab === "saved" ? "px-2.5 pt-2.5 pb-1.5" : `workspace-text-gallery${showAll ? " is-expanded" : ""}`}>
          {tab === "saved" ? (
            <SavedTextStyles onAdd={add} starters={presets} />
          ) : (
            <>
              <Button
                variant="secondary"
                className="workspace-add-text"
                aria-label="Add plain text"
                onClick={() => {
                  void add("New Title", defaultStyle);
                }}
              >
                <span className="workspace-add-text-icon" aria-hidden="true">T</span>
                <span className="workspace-add-text-label">Add plain text</span>
                <span className="workspace-add-text-shortcut" aria-hidden="true">T</span>
              </Button>
              <div className="workspace-library-label">
                <span>TITLES</span>
                <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
                  {showAll ? "Show less" : "See all"}
                </Button>
              </div>
              <div className="workspace-title-grid">
                {(showAll
                  ? [...referenceTitles, ...presets]
                  : referenceTitles
                ).map((preset) => (
                  <Button
                    key={preset.name}
                    aria-label={preset.name}
                    aria-pressed={selectedText?.text === preset.text}
                    variant="outline"
                    onClick={() => {
                      void add(preset.text, preset.style);
                    }}
                    className={`workspace-title-preset preset-${preset.name.toLowerCase().replaceAll(" ", "-")}`}
                  >
                    <TitlePresetCard preset={preset} />
                  </Button>
                ))}
              </div>
              <div className="workspace-library-label">
                <span>LOWER THIRDS</span>
              </div>
              <div className="workspace-title-grid">
                {LOWER_THIRD_PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    variant="outline"
                    className={`workspace-lower-third ${preset.id === "label" ? "is-label" : ""}`}
                    disabled={addingLowerThird}
                    onClick={() => {
                      void addLowerThirdPreset(preset.id);
                    }}
                    aria-label={preset.name}
                  >
                    <LowerThirdCard preset={preset} />
                  </Button>
                ))}
              </div>
              <div className="workspace-caption-card">
                <div className="workspace-caption-heading">
                  <span className="workspace-caption-icon" aria-hidden="true">CC</span>
                  <div>
                    <strong>Auto captions</strong>
                    <p title={captionSummary}>{captionSummary}</p>
                  </div>
                </div>
                <div className="workspace-caption-options">
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger aria-label="Caption language">
                      <SelectValue />
                      <span className="workspace-caption-caret" aria-hidden="true">▾</span>
                    </SelectTrigger>
                    <SelectContent>
                      {WHISPER_LANGUAGES.map((item) => (
                        <SelectItem key={item.code} value={item.code}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <CaptionStyleCards presets={CAPTION_STYLE_PRESETS} value={captionStyle} onChange={setCaptionStyle} referenceStyles />
                <Button
                  className="workspace-caption-generate w-full h-8"
                  onClick={() => { setTab("captions"); if (phone) useEditorWorkspaceStore.getState().setMobileCaptionsOpen(true); }}
                >
                  Generate captions
                </Button>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
      {tab === "transcript" && <TranscriptPanel />}
      {tab === "qc" && <CaptionQcPanel />}
      {(captionMounted || tab === "captions" || mobileCaptionsOpen) && <CaptionWorkspace key={projectId} active={tab === "captions"} language={language} onLanguageChange={setLanguage} style={captionStyle} onStyleChange={setCaptionStyle}/>}
    </div>
  );
}

const TitlePresetCard = ({ preset }: { preset: TitlePreset }) => {
  const lines = useMemo<PreviewLine[]>(
    () => [{ text: preset.text, style: preset.style, x: 0.5, y: 0.5 }],
    [preset],
  );
  return <TextPresetPreview lines={lines} />;
};

const LowerThirdCard = ({ preset }: { preset: (typeof LOWER_THIRD_PRESETS)[number] }) => {
  const lines = useMemo<PreviewLine[]>(
    () => [
      { text: preset.text, style: { ...preset.style, fontFamily: "Inter", strokeWidth: 0, letterSpacing: 0 }, x: 0.08, y: 0.7, align: "left", boost: 5 },
      { text: preset.subtitle, style: { ...preset.subtitleStyle, fontFamily: "Inter", strokeWidth: 0, letterSpacing: 0 }, x: 0.08, y: 0.84, align: "left", boost: 5 },
    ],
    [preset],
  );
  return <TextPresetPreview lines={lines} />;
};
/** True when a CSS hex colour is too dark to read on the dark panel. */
function isDarkColor(color: string | undefined): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? "");
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const luminance = 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
  return luminance < 70;
}

function SavedTextStyles({
  onAdd,
  starters = [],
}: {
  onAdd: (text: string, style: Partial<TextStyle>) => Promise<void>;
  starters?: readonly TitlePreset[];
}) {
  const selected = useUIStore((s) => s.selectedItems);
  const id = selected.find((s) => s.type === "text-clip")?.id;
  const clip = useProjectStore((s) =>
    id ? s.project.textClips?.find((c) => c.id === id) ?? s.getTextClip(id) : undefined,
  );
  const [visibleCount, setVisibleCount] = useState(20);
  const [styles, setStyles] = useState<TitlePreset[]>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem("openreel-saved-text-styles") ?? "[]",
      );
      return Array.isArray(value)
        ? value
            .filter(
              (entry): entry is TitlePreset =>
                !!entry &&
                typeof entry.name === "string" &&
                typeof entry.text === "string" &&
                !!entry.style &&
                typeof entry.style === "object",
            )
        : [];
    } catch {
      return [];
    }
  });
  const save = (next: TitlePreset[]) => {
    try {
      localStorage.setItem("openreel-saved-text-styles", JSON.stringify(next));
      setStyles(next);
    } catch {
      toast.error("Could not save style", "Local storage is unavailable.");
    }
  };
  return (
    <div className="workspace-saved-text-styles">
      <Button
        variant="secondary"
        className="w-full h-8 text-xs"
        disabled={!clip}
        onClick={() => {
          if (clip)
            save([
              ...styles,
              {
                name: clip.text.slice(0, 40) || "Text style",
                text: clip.text,
                style: clip.style,
              },
            ]);
        }}
      >
        <BookmarkPlus size={14} />
        Save selected text style
      </Button>
      {!clip && (
        <p className="text-[11px] text-fg-muted mt-2">
          Select a title on the timeline to save its style.
        </p>
      )}
      {styles.length === 0 && (
        <div className="mt-3" data-testid="saved-styles-empty">
          <p className="text-[11px] text-fg-muted">
            Styles you save appear here. Until then, start from one of these.
          </p>
          <div className="workspace-library-label">
            <span>STARTER STYLES</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {starters.slice(0, 6).map((preset) => (
              <Button
                key={preset.name}
                variant="outline"
                aria-label={`Add ${preset.name}`}
                className={`workspace-title-preset min-w-0 ${isDarkColor(preset.style.color) ? "bg-fg/90" : ""}`}
                onClick={() => void onAdd(preset.text, preset.style)}
              >
                <span
                  className="truncate"
                  style={{
                    fontFamily: preset.style.fontFamily,
                    fontWeight: preset.style.fontWeight,
                    fontStyle: preset.style.fontStyle,
                    color: preset.style.color,
                  }}
                >
                  {preset.name}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {styles.slice(-visibleCount).reverse().map((preset, i) => (
        <div key={styles.length - 1 - i} className="flex gap-1 mt-3">
          <Button
            variant="outline"
            className="workspace-title-preset flex-1 min-w-0"
            onClick={() => void onAdd(preset.text, preset.style)}
          >
            <span
              style={{
                fontFamily: preset.style.fontFamily,
                fontWeight: preset.style.fontWeight,
              }}
            >
              {preset.name}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete saved style ${preset.name}`}
            onClick={() => save(styles.filter((_, j) => styles.length - 1 - i !== j))}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      {styles.length > visibleCount && (
        <Button
          variant="secondary"
          className="w-full h-8 text-xs mt-3"
          onClick={() => setVisibleCount((count) => count + 20)}
        >
          Load more styles
        </Button>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { Button, ScrollArea } from "@openreel/ui";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useAutoCaptions } from "./inspector/useAutoCaptions";
import { AutoCaptionControlsPanel } from "./inspector/AutoCaptionPanel";
import { workspaceTabPanel } from "./WorkspacePrimitives";
import { CaptionEditorPanel } from "./inspector/CaptionEditorPanel";
import { resolveCaptionSource } from "../../services/caption-source";

const MobileCaptionSheet = React.lazy(() => import("./mobile/MobileCaptionSheet").then(module => ({ default: module.MobileCaptionSheet })));

/** One caption session owns the worker, transcript and editor drafts across presentations. */
export function CaptionWorkspace({ active, language, onLanguageChange, style, onStyleChange }: {
  active: boolean; language: string; onLanguageChange: (value: string) => void;
  style: string; onStyleChange: (value: string) => void;
}) {
  const phone = usePhoneEditor();
  const [mobileMounted, setMobileMounted] = useState(phone);
  useEffect(() => { if (phone) setMobileMounted(true); }, [phone]);
  const project = useProjectStore(s => s.project);
  const selected = useUIStore(s => s.selectedItems);
  const open = useEditorWorkspaceStore(s => s.mobileCaptionsOpen);
  const onOpenChange = useEditorWorkspaceStore(s => s.setMobileCaptionsOpen);
  const [words, setWords] = useState(5);
  const source = useMemo(() => resolveCaptionSource(project, selected), [project, selected]);
  const controls = useAutoCaptions({ clipIds: source.clipIds, sourceTrackId: source.sourceTrackId,
    sourceLabel: source.sourceLabel, maxWordsPerLine: words,
    initialLanguage: language, initialStyle: style, initialHighlightWords: true, initialRemoveFillers: true, referenceStyles: true, onLanguageChange, onStyleChange });
  return <CaptionEditorPanel maxWordsPerLine={words} onMaxWordsPerLineChange={setWords} renderPanel={manual => <>
    {phone && active && <Button variant="secondary" onClick={() => onOpenChange(true)} className="m-3">Open captions</Button>}
    {!phone && <ScrollArea {...workspaceTabPanel("Text sections", "captions")} hidden={!active} className="min-h-0 flex-1"><div className="space-y-4 px-2.5 py-2.5"><AutoCaptionControlsPanel controls={controls}/>{manual}</div></ScrollArea>}
    {(phone || mobileMounted) && <React.Suspense fallback={null}><MobileCaptionSheet open={phone && open} onOpenChange={onOpenChange} controls={controls} manualEditor={manual} words={words} onWordsChange={setWords}/></React.Suspense>}

  </>}/>;
}

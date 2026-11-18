import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Button, Dialog, DialogContent, DialogTitle, Popover, PopoverContent, PopoverTrigger,
  ScrollArea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Switch, ToggleGroup, ToggleGroupItem, Textarea,
} from "@openreel/ui";
import { SUBTITLE_STYLE_PRESETS } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { WHISPER_MODELS } from "../../../workers/whisper-models";
import { CAPTION_STYLE_PRESETS, WHISPER_LANGUAGES, type AutoCaptionControls } from "../inspector/useAutoCaptions";
import { MobileEditorIcon } from "./MobileEditorIcon";
import "./mobile-tools.css";
import "./mobile-captions.css";

const styles = [
  { id: "default", label: "Classic", sample: "Aa" },
  { id: "pop-words", label: "Pop", sample: "Aa" },
  { id: "bold", label: "Bold", sample: "AA" },
  { id: "minimal", label: "Minimal", sample: "aa" },
];
export function MobileCaptionSheet({ open, onOpenChange, controls: c, manualEditor, words, onWordsChange }: {
  open: boolean; onOpenChange: (open: boolean) => void; controls: AutoCaptionControls;
  manualEditor: ReactNode; words: number; onWordsChange: (value: number) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [sheetTop, setSheetTop] = useState(() => 58 + Math.round(window.innerWidth * 9 / 16));
  useEffect(() => {
    const resize = () => setSheetTop(58 + Math.round(window.innerWidth * 9 / 16));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [mode, setMode] = useState("auto");
  const [manualDraft, setManualDraft] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [manualError, setManualError] = useState("");
  const manualBusy = useRef(false);
  const android = /Android/i.test(navigator.userAgent);
  const busy = c.workerState === "loading" || c.isTranscribing || c.isAdding || addingManual;
  const language = WHISPER_LANGUAGES.find(item => item.code === c.selectedLanguage)?.name ?? c.selectedLanguage;
  const addManual = async () => {
    const text = manualDraft.trim(), store = useProjectStore.getState(), timeline = useTimelineStore.getState();
    if (!text || busy || manualBusy.current || timeline.playbackLockedReason || useUIStore.getState().exportState.isExporting) return;
    manualBusy.current = true; setAddingManual(true); setManualError(""); timeline.pause();
    const time = timeline.playheadPosition;
    store.beginHistoryGroup("Add manual caption"); timeline.lockPlayback("Adding caption");
    try {
      const created = await store.addSubtitle({ id: crypto.randomUUID(), text, startTime: time, endTime: time + 3,
        style: SUBTITLE_STYLE_PRESETS[c.selectedStyle === "pop-words" ? "modern" : c.selectedStyle],
        ...(c.highlightWords ? { animationStyle: "word-by-word" as const } : {}),
      }, { captionSource: "manual", captionMaxWordsPerLine: words });
      if (!created) throw new Error("Could not add the caption. Try again.");
      if (c.referenceTextStyle) useProjectStore.getState().updateTextStyle(created.id, c.referenceTextStyle);
      setManualDraft("");
    } catch (error) { setManualError(error instanceof Error ? error.message : "Could not add the caption."); }
    finally { store.endHistoryGroup(); timeline.unlockPlayback(); manualBusy.current = false; setAddingManual(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent ref={contentRef} hideCloseButton aria-describedby={undefined}
      className="mobile-editor-sheet mobile-caption-sheet" overlayClassName="mobile-caption-scrim"
      data-platform={android ? "android" : "ios"}
      style={{ "--mobile-sheet-top": `min(${sheetTop}px, calc(100dvh - 320px))` } as CSSProperties}
      onOpenAutoFocus={event => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}>
      <div className="mobile-sheet-grabber" aria-hidden><span/></div>
      <div className="mobile-sheet-heading"><DialogTitle>Captions</DialogTitle><Button variant="ghost" onClick={() => onOpenChange(false)} aria-label="Close captions">{android ? <MobileEditorIcon name="close" size={20}/> : "Done"}</Button></div>
      <ScrollArea className="mobile-sheet-scroll">
        <div className="mobile-caption-content">
          <ToggleGroup type="single" value={mode} onValueChange={value => { if (value) setMode(value); }} className="mobile-caption-modes" aria-label="Caption mode">
            <ToggleGroupItem value="auto">Auto</ToggleGroupItem><ToggleGroupItem value="manual">Manual</ToggleGroupItem>
          </ToggleGroup>
          {mode === "auto" ? <>
            <Popover><PopoverTrigger asChild><Button variant="secondary" className="mobile-caption-language" aria-label="Caption language and model options"><span>Spoken language</span><span>{language} ›</span></Button></PopoverTrigger>
              <PopoverContent className="mobile-caption-options" align="center" collisionPadding={16}>
                <label>Spoken language<Select value={c.selectedLanguage} onValueChange={c.setSelectedLanguage} disabled={busy}><SelectTrigger aria-label="Caption language"><SelectValue/></SelectTrigger><SelectContent>{WHISPER_LANGUAGES.map(item => <SelectItem key={item.code} value={item.code}>{item.name}</SelectItem>)}</SelectContent></Select></label>
                <label>Local caption model<Select value={c.selectedModel} onValueChange={c.handleModelChange} disabled={busy}><SelectTrigger aria-label="Local caption model"><SelectValue/></SelectTrigger><SelectContent>{Object.entries(WHISPER_MODELS).map(([id, model]) => <SelectItem key={id} value={id}>{model.label}</SelectItem>)}</SelectContent></Select></label>
                <p>{c.modelStatus}</p>
                {c.workerState === "idle" && <Button variant="secondary" disabled={busy} onClick={() => void c.handlePrepareModel()}>Download {WHISPER_MODELS[c.selectedModel].shortLabel}</Button>}
                <label>Maximum words per caption<Select value={String(words)} onValueChange={value => onWordsChange(Number(value))} disabled={busy}><SelectTrigger aria-label="Maximum words per caption"><SelectValue/></SelectTrigger><SelectContent>{Array.from({ length: 10 }, (_, i) => <SelectItem key={i} value={String(i + 2)}>{i + 2}</SelectItem>)}</SelectContent></Select></label>
                <label>All caption styles<Select value={c.selectedStyle} onValueChange={c.setSelectedStyle} disabled={busy}><SelectTrigger aria-label="Caption style"><SelectValue/></SelectTrigger><SelectContent>{CAPTION_STYLE_PRESETS.map(id => <SelectItem key={id} value={id}>{id === "pop-words" ? "Pop" : id === "default" ? "Classic" : id[0].toUpperCase() + id.slice(1)}</SelectItem>)}</SelectContent></Select></label>
                <p>Models run locally. Downloads are cached in this browser. Filler cleanup changes caption text only.</p>
              </PopoverContent>
            </Popover>
            <div className="mobile-caption-styles"><span>Style</span><div>{styles.map(style => <Button variant="outline" key={style.id} className={`mobile-caption-style style-${style.id}`} aria-pressed={c.selectedStyle === style.id} disabled={busy} onClick={() => c.setSelectedStyle(style.id)}><span>{style.sample}</span><span>{style.label}</span></Button>)}</div></div>
            <label className="mobile-caption-toggle"><span>Highlight each word as it’s spoken</span><Switch checked={c.highlightWords} onCheckedChange={c.setHighlightWords} disabled={busy} aria-label="Highlight each word as it’s spoken"/></label>
            <label className="mobile-caption-toggle" title="Remove um and uh from caption text; source audio stays unchanged"><span>Remove filler words (um, uh)</span><Switch checked={c.removeFillers} onCheckedChange={c.setRemoveFillers} disabled={busy} aria-describedby="caption-filler-help" aria-label="Remove filler words (um, uh)"/></label>
            <span id="caption-filler-help" className="sr-only">Changes caption text only. Source audio and caption timing stay unchanged.</span>
            {c.error && <p role="alert" className="mobile-caption-error">{c.error}</p>}
            {c.segments.length > 0 && <div className="mobile-caption-review" aria-label="Generated caption review"><p>Review captions · {c.sourceName}</p><div>{c.segments.map((segment, i) => <p key={`${segment.startTime}-${i}`}><span>{segment.startTime.toFixed(1)}s</span> {segment.text}</p>)}</div></div>}
            <Button className="mobile-caption-primary" disabled={busy || c.mutationBlocked || (!c.segments.length && !c.canTranscribe)} onClick={() => void (c.segments.length ? c.handleAddToTimeline() : c.handleTranscribe())}>{c.isAdding ? "Adding captions…" : c.isTranscribing || c.workerState === "loading" ? "Generating captions…" : c.segments.length ? "Add captions to timeline" : "Generate captions"}</Button>
            {(c.isTranscribing || c.workerState === "loading") && <Button variant="secondary" className="mobile-caption-secondary" onClick={c.cancel}>Cancel</Button>}
            {c.progressMessage && <p role="status" className="mobile-caption-status">{c.progressMessage}</p>}
            {!c.canTranscribe && !c.segments.length && !busy && <p className="mobile-caption-status">Select a connected video or audio clip to generate captions.</p>}
          </> : <div className="mobile-manual-captions">
            <label>New caption<Textarea aria-label="Manual caption text" placeholder="Type a caption…" value={manualDraft} onChange={event => setManualDraft(event.currentTarget.value)} disabled={busy}/></label>
            <Button className="mobile-caption-primary" disabled={!manualDraft.trim() || busy || c.mutationBlocked} onClick={() => void addManual()}>{addingManual ? "Adding caption…" : "Add caption at playhead"}</Button>
            {manualError && <p role="alert" className="mobile-caption-error">{manualError}</p>}
            {manualEditor}
          </div>}
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>;
}

import { useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, Input, ScrollArea } from "@openreel/ui";
import { MobileEditorIcon } from "./MobileEditorIcon";
import { MOBILE_QUICK_TOOLS, MOBILE_TOOL_GROUPS, type MobileTool, type MobileToolId } from "./mobile-tools";

export function MobileToolsSheet({ open, onOpenChange, onTool, unavailable = [], recent = [] }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTool: (id: MobileToolId) => void;
  unavailable?: readonly MobileToolId[];
  recent?: readonly MobileToolId[];
}) {
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return MOBILE_TOOL_GROUPS.map(group => ({...group, items: group.items.filter(tool => {
      const text = `${tool.label} ${tool.keywords ?? ""} ${group.title}`.toLowerCase();
      return terms.every(term => text.includes(term));
    })})).filter(group => group.items.length);
  }, [query]);
  const shortcuts = recent.length
    ? recent.map(id => MOBILE_TOOL_GROUPS.flatMap(group => group.items).find(tool => tool.id === id)).filter((tool): tool is MobileTool => !!tool).slice(0, 4)
    : MOBILE_QUICK_TOOLS;
  const choose = (id: MobileToolId) => { onOpenChange(false); onTool(id); };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent ref={contentRef} hideCloseButton aria-describedby={undefined} className="mobile-editor-sheet mobile-tools-sheet" overlayClassName="mobile-editor-sheet-scrim"
      data-platform={/Android/i.test(navigator.userAgent) ? "android" : "ios"} onOpenAutoFocus={event => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}>
      <div className="mobile-sheet-grabber" aria-hidden><span/></div>
      <div className="mobile-sheet-heading"><DialogTitle>All tools</DialogTitle><Button variant="ghost" onClick={() => onOpenChange(false)} aria-label="Close all tools">{/Android/i.test(navigator.userAgent) ? <MobileEditorIcon name="close" size={20}/> : "Done"}</Button></div>
      <ScrollArea className="mobile-sheet-scroll">
        <div className="mobile-tools-content">
          <label className="mobile-tools-search"><MobileEditorIcon name="search" size={18}/><Input aria-label="Search tools" placeholder="Search tools, e.g. “remove background”" value={query} onChange={event => setQuery(event.currentTarget.value)}/></label>
          {!query.trim() && <div className="mobile-recent-tools"><span>{recent.length ? "Recent" : "Quick access"}</span>{shortcuts.map(tool => <Button variant="ghost" key={tool.id} disabled={unavailable.includes(tool.id)} onClick={() => choose(tool.id)}>{tool.label}</Button>)}</div>}
          {groups.map(group => <section key={group.title} aria-label={group.title} className="mobile-tool-group"><h3>{group.title}</h3><div className="mobile-tool-grid">{group.items.map(tool => <Button
            key={tool.id} variant="ghost" className={`mobile-tool-tile ${tool.ai ? "is-ai" : ""} ${tool.danger ? "is-danger" : ""}`}
            disabled={unavailable.includes(tool.id)} onClick={() => choose(tool.id)}
          ><span className="mobile-tool-tile-icon"><MobileEditorIcon name={tool.icon}/></span><span>{tool.label}</span></Button>)}</div></section>)}
          {!groups.length && <p className="mobile-tools-empty" role="status">No tools found. Try another name, such as captions, shaders or audio.</p>}
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>;
}

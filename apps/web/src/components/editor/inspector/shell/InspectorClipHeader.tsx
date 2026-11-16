import type { ReactNode } from "react";
import { Button } from "@openreel/ui";
import { Film, Shapes } from "lucide-react";

interface InspectorClipHeaderProps {
  name: string;
  durationSeconds: number;
  typeLabel: string;
  thumbnailUrl?: string | null;
  timeRange?: string;
  /** Source timecode of the clip's In and Out in its file (media with an embedded start timecode). */
  sourceRange?: string;
  trackBadge?: string;
  onReset?: () => void;
}
export function InspectorClipHeader({name,durationSeconds,typeLabel,thumbnailUrl,timeRange,sourceRange,trackBadge,onReset}:InspectorClipHeaderProps) {
  const audioIcon = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M21 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0"/></svg>;
  const icons:Record<string,ReactNode>={video:<Film />,image:<Film />,audio:audioIcon,text:"T"};
  return <div className="workspace-clip-header" data-clip-type={typeLabel}>
    <div className={`workspace-clip-thumbnail is-${typeLabel}`}>{thumbnailUrl?<img src={thumbnailUrl} alt="" />:icons[typeLabel]??<Shapes />}</div>
    <div className="flex-1 min-w-0"><strong title={name}>{name}</strong><span>{trackBadge && `${trackBadge} · `}{timeRange??`${durationSeconds.toFixed(2)}s · ${typeLabel}`}</span>{sourceRange&&<span data-testid="inspector-source-timecode" title="Source timecode of this clip's In and Out, from the file's embedded start timecode">{`SRC ${sourceRange}`}</span>}</div>
    {onReset&&<Button variant="ghost" size="icon-sm" aria-label="Reset clip transform" onClick={onReset}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg></Button>}
  </div>;
}

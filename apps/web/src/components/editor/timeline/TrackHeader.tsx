import React, { useState, useRef, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { MoreHorizontal, Trash2, Pencil, AlignLeft, Link2, Unlink, RefreshCw } from "@/icons/lucide-compat";
import {
  Button, Input, ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuCheckboxItem, ContextMenuLabel, ContextMenuSeparator,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@openreel/ui";
import type { Track } from "@openreel/core";
import {
  getTrackItems,
  isSyncLocked,
  trackHasAudioItems,
  trackHasVisualItems,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useCompactEditor } from "../../../hooks/useCompactEditor";
import { getTrackInfo } from "./utils";
import { getTrackBadge } from "./track-badge";

interface TrackHeaderProps {
  track: Track;
  index: number;
  onDragStart: (e: React.DragEvent, trackId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTrackId: string) => void;
  onDragEnd: () => void;
  keyframeCount?: number;
  active?: boolean;
  audioDivider?: boolean;
}

export const TrackHeader: React.FC<TrackHeaderProps> = React.memo(function TrackHeader({
  track,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  active = false,
  audioDivider = false,
}) {
  const compact = useCompactEditor();
  const {
    lockTrack,
    hideTrack,
    muteTrack,
    soloTrack,
    setTrackSoloSafe,
    removeTrack,
    consolidateTrack,
    groupTracks,
    setTrackSyncLock,
    project,
  } = useProjectStore(useShallow((state) => ({
    lockTrack: state.lockTrack,
    hideTrack: state.hideTrack,
    muteTrack: state.muteTrack,
    soloTrack: state.soloTrack,
    setTrackSoloSafe: state.setTrackSoloSafe,
    removeTrack: state.removeTrack,
    consolidateTrack: state.consolidateTrack,
    groupTracks: state.groupTracks,
    setTrackSyncLock: state.setTrackSyncLock,
    project: state.project,
  })));
  const trackHeight = useTimelineStore((state) => {
    const height = state.getTrackHeight(track.id, track.type, track.name);
    return compact ? Math.max(48, height) : height;
  });

  // Premiere-style source patching: which track Insert/Overwrite place onto.
  const targetKind = track.type === "audio" ? "audio" : track.type === "video" || track.type === "image" ? "video" : null;
  const isTarget = useEditorWorkspaceStore((state) => targetKind !== null && state.targetTracks[targetKind] === track.id);
  const setTargetTrack = useEditorWorkspaceStore((state) => state.setTargetTrack);
  const toggleTarget = () => { if (targetKind) setTargetTrack(targetKind, isTarget ? null : track.id); };
  // Premiere track targeting (the V1/A1 toggles): Extract, Lift, Add Edit, Paste
  // and Match Frame act on the targeted tracks.
  const isTargeted = useEditorWorkspaceStore((state) => state.targetedTrackIds.includes(track.id));
  const toggleTrackTargeted = useEditorWorkspaceStore((state) => state.toggleTrackTargeted);
  const showGainLine = useTimelineStore((state) => state.gainLineTracks[track.id] === true);
  const setGainLineVisible = useTimelineStore((state) => state.setGainLineVisible);
  const showAutomationLanes = useTimelineStore((state) => state.automationLaneTracks[track.id] === true);
  const setAutomationLanesVisible = useTimelineStore((state) => state.setAutomationLanesVisible);
  const syncLocked = isSyncLocked(track);
  const toggleSyncLock = () => void setTrackSyncLock(track.id, !syncLocked);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(track.name);
  const renameSession = useRef<{ projectId: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Audio Track Mixer routing: a track playing into a bus shows where its signal goes.
  const outputBus = track.output ? project.timeline.audioBuses?.find((bus) => bus.id === track.output) : undefined;
  const sendCount = track.sends?.length ?? 0;

  const trackInfo = getTrackInfo(track, index);
  const badge = getTrackBadge(project.timeline.tracks, track.id);
  const isVisual = track.type !== "audio" || trackHasVisualItems(project, track.id);
  const isAudio = track.type === "audio" || trackHasAudioItems(project, track.id);
  const hasSoloedAudioTrack = project.timeline.tracks.some(
    (candidate) =>
      trackHasAudioItems(project, candidate.id) && candidate.solo,
  );
  const effectivelyMuted =
    isAudio && (track.muted || (hasSoloedAudioTrack && !track.solo));
  const groupCandidates = project.timeline.tracks.filter(
    (candidate) =>
      candidate.id !== track.id &&
      (!track.groupId || candidate.groupId !== track.groupId),
  );

  const handleRemoveTrack = async () => {
    await removeTrack(track.id);
  };

  const handleRemoveGaps = async () => {
    const result = await consolidateTrack(track.id);
    if (!result.success) toast.warning("Remove Gaps", result.error?.message ?? "The gaps could not be removed.");
  };

  // Only enable "Remove Gaps" if there's actually a gap on this track.
  const hasGaps = React.useMemo(() => {
    const sorted = getTrackItems(project, track.id);
    if (sorted.length === 0) return false;
    if (sorted[0].startTime > 0.0001) return true;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].startTime + sorted[i - 1].duration;
      if (sorted[i].startTime - prevEnd > 0.0001) return true;
    }
    return false;
  }, [project, track.id]);

  const startRename = () => {
    renameSession.current = { projectId: project.id, name: track.name };
    setRenameValue(track.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const session = renameSession.current;
    renameSession.current = null;
    setIsRenaming(false);
    const name = renameValue.trim();
    const state = useProjectStore.getState();
    const current = state.project.timeline.tracks.find(item => item.id === track.id);
    if (session && state.project.id === session.projectId && current?.name === session.name
      && name && name !== current.name) void state.renameTrack(track.id, name);
  };

  const cancelRename = () => {
    renameSession.current = null;
    setRenameValue(track.name);
    setIsRenaming(false);
  };

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const trackActions = (kind: "context" | "dropdown") => {
    const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
    const Label = kind === "context" ? ContextMenuLabel : DropdownMenuLabel;
    const Separator = kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
    return <>
      {kind === "context" && isAudio && <>
        <ContextMenuCheckboxItem checked={track.muted} onCheckedChange={checked => void muteTrack(track.id, checked === true)}>{`Mute ${track.name}`}</ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={track.solo} onCheckedChange={checked => void soloTrack(track.id, checked === true)}>{`Solo ${track.name}`}</ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={track.soloSafe === true} onCheckedChange={checked => void setTrackSoloSafe(track.id, checked === true)}>{`Solo Safe ${track.name}`}</ContextMenuCheckboxItem>
        <Separator />
      </>}
      <Item onSelect={startRename}><Pencil size={14} aria-hidden />Rename Track</Item>
      <Item disabled={!hasGaps} onSelect={() => void handleRemoveGaps()}><AlignLeft size={14} aria-hidden />Remove Gaps</Item>
      {track.groupId && <Item onSelect={() => void groupTracks(track.id)}><Unlink size={14} aria-hidden />Ungroup Track</Item>}
      {groupCandidates.length > 0 && <>
        <Separator /><Label className="text-xs">Move &amp; trim together</Label>
        {groupCandidates.map(candidate => <Item key={candidate.id} onSelect={() => void groupTracks(track.id, candidate.id)}><Link2 size={14} aria-hidden />Group with {candidate.name}</Item>)}
      </>}
      <Separator />
      {kind === "context" && <>
        {targetKind && <ContextMenuCheckboxItem checked={isTargeted} onCheckedChange={() => toggleTrackTargeted(track.id)}>Track Target (Shift+T)</ContextMenuCheckboxItem>}
        <ContextMenuCheckboxItem checked={syncLocked} onCheckedChange={toggleSyncLock}>Sync Lock (Shift+Y)</ContextMenuCheckboxItem>
        <Separator />
      </>}
      {isAudio && (kind === "context"
        ? <ContextMenuCheckboxItem checked={showGainLine} onCheckedChange={() => setGainLineVisible(track.id, !showGainLine)}>Show Clip Keyframes</ContextMenuCheckboxItem>
        : <DropdownMenuItem onSelect={() => setGainLineVisible(track.id, !showGainLine)}>{showGainLine ? "Hide Clip Keyframes" : "Show Clip Keyframes"}</DropdownMenuItem>)}
      {isAudio && (kind === "context"
        ? <ContextMenuCheckboxItem checked={showAutomationLanes} onCheckedChange={() => setAutomationLanesVisible(track.id, !showAutomationLanes)}>Show Volume and Pan Automation</ContextMenuCheckboxItem>
        : <DropdownMenuItem onSelect={() => setAutomationLanesVisible(track.id, !showAutomationLanes)}>{showAutomationLanes ? "Hide Volume and Pan Automation" : "Show Volume and Pan Automation"}</DropdownMenuItem>)}
      <Item onSelect={() => void handleRemoveTrack()}><Trash2 size={14} aria-hidden />Delete Track</Item>
    </>;
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
      <div
        data-timeline-track-header
        role="group"
        aria-label={`${track.name || trackInfo.label} track`}
        tabIndex={isRenaming ? -1 : 0}
        data-header-audio={track.type === "audio" ? "true" : undefined}
        data-audio-divider={audioDivider ? "true" : undefined}
        data-active={active ? "true" : undefined}
        draggable={!compact && !isRenaming}
        onDragStart={(e) => onDragStart(e, track.id)}
        onDragOver={onDragOver}
        onDrop={(e) => onDrop(e, track.id)}
        onDragEnd={onDragEnd}
        style={{ height: trackHeight }}
        className={`workspace-track-header border-b border-border flex items-center gap-2.5 px-4 relative group transition-colors cursor-grab active:cursor-grabbing ${
          track.hidden || effectivelyMuted ? "opacity-60" : ""
        } ${
          track.locked ? "bg-bg-2/50" : "bg-bg-1"
        }`}
      >
          {targetKind ? (
            <button
              type="button"
              className="workspace-track-badge"
              data-track-targeted={isTargeted ? "true" : undefined}
              aria-label={`Track target ${track.name || trackInfo.label}`}
              aria-pressed={isTargeted}
              title={isTargeted ? "Track targeted: Extract, Lift, Add Edit and Paste act on it. Click to untarget (Shift+T)" : "Target this track for Extract, Lift, Add Edit and Paste (Shift+T)"}
              onClick={(e) => {
                e.stopPropagation();
                toggleTrackTargeted(track.id);
              }}
            >{badge}</button>
          ) : (
            <span className="workspace-track-badge">{badge}</span>
          )}
          <div className="workspace-track-label min-w-0 flex-1">
            {isRenaming ? (
              <Input
                ref={inputRef}
                aria-label="Track name"
                className="h-7 w-full text-xs"
                value={renameValue}
                onChange={event => setRenameValue(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="workspace-track-name block truncate cursor-grab active:cursor-grabbing"
                onDoubleClick={startRename}
              >
                {track.name || trackInfo.label}
              </span>
            )}
            {(outputBus || sendCount > 0) && (
              <span
                className="block truncate text-[10px] leading-tight text-fg-muted"
                data-testid={`track-output-badge-${track.id}`}
                title={`Output: ${outputBus?.name ?? "Master"}${sendCount ? `, ${sendCount} send${sendCount === 1 ? "" : "s"}` : ""}`}
              >
                {"\u2192 "}{outputBus?.name ?? "Master"}{sendCount ? ` +${sendCount}` : ""}
              </span>
            )}
          </div>

          {compact && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Options for ${track.name || trackInfo.label}`}><MoreHorizontal size={18} aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-[220px] [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:text-xs" onCloseAutoFocus={event => { if (renameSession.current) event.preventDefault(); }}>
              {targetKind && <DropdownMenuItem onSelect={toggleTarget}>{isTarget ? "Clear source patch" : "Patch source to this track"}</DropdownMenuItem>}
              {targetKind && <DropdownMenuItem onSelect={() => toggleTrackTargeted(track.id)}>{isTargeted ? "Untarget track" : "Target track"}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={toggleSyncLock}>{syncLocked ? "Turn off Sync Lock" : "Turn on Sync Lock"}</DropdownMenuItem>
              {isVisual && <DropdownMenuItem onSelect={() => void hideTrack(track.id, !track.hidden)}>{track.hidden ? "Show track" : "Hide track"}</DropdownMenuItem>}
              {isAudio && <>
                <DropdownMenuItem onSelect={() => void muteTrack(track.id, !track.muted)}>{track.muted ? "Unmute track" : "Mute track"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void soloTrack(track.id, !track.solo)}>{track.solo ? "Clear solo" : "Solo track"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void setTrackSoloSafe(track.id, track.soloSafe !== true)}>{track.soloSafe === true ? "Turn off Solo Safe" : "Turn on Solo Safe"}</DropdownMenuItem>
              </>}
              <DropdownMenuItem onSelect={() => void lockTrack(track.id, !track.locked)}>{track.locked ? "Unlock track" : "Lock track"}</DropdownMenuItem>
              <DropdownMenuSeparator />{trackActions("dropdown")}
            </DropdownMenuContent>
          </DropdownMenu>}
          <div hidden={compact} className="workspace-track-controls flex items-center gap-2.5 shrink-0">
            {track.groupId && (
              <Link2
                size={13}
                className="text-accent"
                aria-label="Track is grouped"
              />
            )}
            {targetKind && (
              <Button variant="ghost" size="sm"
                type="button"
                data-track-target={isTarget ? "true" : undefined}
                aria-label={isTarget ? `Untarget ${track.name}` : `Target ${track.name}`}
                aria-pressed={isTarget}
                title={isTarget ? "Source patch: the Source monitor's " + targetKind + " goes to this track. Click to clear" : "Patch the Source monitor's " + targetKind + " to this track"}
                className={`flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 py-0 text-[9px] leading-[1.4] font-black transition-colors ${
                  isTarget ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-hover hover:text-fg-2"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTarget();
                }}
              >
                {targetKind === "audio" ? "A" : "V"}
              </Button>
            )}
            {isVisual && (
              <Button variant="ghost" size="sm"
                type="button"
                aria-label={track.hidden ? "Show track" : "Hide track"}
                className="h-auto w-auto p-0 text-xs font-normal leading-[1.4] text-fg-muted hover:text-fg-2 transition-colors [&_svg]:size-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  hideTrack(track.id, !track.hidden);
                }}
              >
                <span aria-hidden>{track.hidden ? "○" : "◉"}</span>
              </Button>
            )}
            {track.type === "audio" && (
              <>
                <Button variant="ghost" size="sm"
                  type="button"
                  aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                  aria-pressed={track.muted}
                  title={track.muted ? "Unmute track" : "Mute track"}
                  className={`h-auto w-auto p-0 text-xs font-normal leading-[1.4] transition-colors ${
                    track.muted ? "text-destructive" : "text-fg-muted hover:text-fg-2"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    muteTrack(track.id, !track.muted);
                  }}
                >
                  M
                </Button>
                <Button variant="ghost" size="sm"
                  type="button"
                  aria-label={track.solo ? `Clear solo ${track.name}` : `Solo ${track.name}`}
                  aria-pressed={track.solo}
                  title={track.solo ? "Clear solo" : "Solo track"}
                  className={`flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 py-0 text-[9px] leading-[1.4] font-black transition-colors ${
                    track.solo
                      ? "bg-status-warning text-black"
                      : "text-fg-muted hover:bg-hover hover:text-fg-2"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    soloTrack(track.id, !track.solo);
                  }}
                >
                  S
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm"
              type="button"
              data-sync-lock={syncLocked ? "on" : "off"}
              aria-label={`Sync lock ${track.name}`}
              aria-pressed={syncLocked}
              title={syncLocked ? "Sync Lock on: ripple edits keep this track in sync. Click to turn off (Shift+Y)" : "Sync Lock off: ripple edits leave this track in place. Click to turn on (Shift+Y)"}
              className={`h-auto w-auto p-0 text-xs font-normal leading-[1.4] transition-colors ${
                syncLocked ? "text-accent" : "text-fg-muted opacity-60 hover:text-fg-2"
              } [&_svg]:size-[11px]`}
              onClick={(e) => {
                e.stopPropagation();
                toggleSyncLock();
              }}
            >
              <RefreshCw aria-hidden />
            </Button>
            <Button variant="ghost" size="sm"
              type="button"
              aria-label={track.locked ? "Unlock" : "Lock"}
              className={`h-auto w-auto p-0 text-xs font-normal leading-[1.4] transition-colors ${
                track.locked ? "text-fg-2" : "text-fg-muted hover:text-fg-2"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                lockTrack(track.id, !track.locked);
              }}
            >
              <span aria-hidden>L</span>
            </Button>
          </div>
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-[220px] [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:text-xs"
        onCloseAutoFocus={event => { if (renameSession.current) event.preventDefault(); }}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        {trackActions("context")}
      </ContextMenuContent>
    </ContextMenu>
  );
});

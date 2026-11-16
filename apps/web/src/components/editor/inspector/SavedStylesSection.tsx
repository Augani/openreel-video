import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Button, Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

/**
 * Save the selected text clip's or caption cue's look under a name and apply
 * saved looks to it. Every change is an undoable `style/*` action.
 */
export function SavedStylesSection({ kind, targetId }: { kind: "text" | "caption"; targetId: string }) {
  const library = useProjectStore((state) => state.project.savedStyles);
  const list = (kind === "text" ? library?.text : library?.caption) ?? [];
  const [name, setName] = useState("");

  const run = (type: string, params: Record<string, unknown>) =>
    useProjectStore.getState().executeAction({ type, id: uuidv4(), timestamp: Date.now(), params });

  const save = async () => {
    const state = useProjectStore.getState();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (kind === "text") {
      const clip = state.project.textClips?.find((c) => c.id === targetId) ?? state.getTextClip(targetId);
      if (!clip) return;
      await run("style/save", { kind, id: uuidv4(), name: trimmed, style: clip.style, ...(clip.scroll ? { scroll: clip.scroll } : {}) });
    } else {
      const cue = state.getSubtitle(targetId);
      if (!cue) return;
      await run("style/save", {
        kind,
        id: uuidv4(),
        name: trimmed,
        style: cue.style ?? { fontFamily: "Inter", fontSize: 24, color: "#ffffff", backgroundColor: "rgba(0, 0, 0, 0.7)", position: "bottom" },
        ...(cue.cueSettings ? { cueSettings: cue.cueSettings } : {}),
      });
    }
    setName("");
    toast.success("Style saved", `"${trimmed}" is ready to apply.`);
  };

  const apply = (styleId: string) =>
    kind === "text"
      ? run("style/applyText", { clipIds: [targetId], styleId })
      : run("style/applyCaption", { subtitleIds: [targetId], styleId });

  return (
    <div className="space-y-2" data-saved-styles={kind}>
      <div className="flex gap-2">
        <Input aria-label={`Name for new ${kind} style`} placeholder="Style name" value={name}
          className="h-7 min-w-0 flex-1 rounded-[5px] bg-bg-2 px-2 py-1 text-xs"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} />
        <Button type="button" variant="outline" className="h-7 px-2 text-xs" disabled={!name.trim()} onClick={() => void save()}>Save</Button>
      </div>
      {list.length === 0 ? (
        <p className="text-[10px] text-fg-3">No saved {kind} styles yet.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-fg">{entry.name}</span>
              <span className="flex shrink-0 gap-1">
                <Button type="button" variant="outline" className="h-6 px-2 text-[10px]" aria-label={`Apply style ${entry.name}`}
                  onClick={() => void apply(entry.id)}>Apply</Button>
                <Button type="button" variant="ghost" className="h-6 px-2 text-[10px]" aria-label={`Delete style ${entry.name}`}
                  onClick={() => void run("style/delete", { kind, styleId: entry.id })}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

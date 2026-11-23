import { useEffect, useMemo, useState } from "react";
import type { MediaItem } from "@openreel/core";
import { normalizeKeywords } from "@openreel/core";
import { Button, Input } from "@openreel/ui";
import { Tag, X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { setMediaMetadata, type MediaMetadataEdit } from "../../services/media-metadata-commands";
import { desktopBrowserBridge, rereadXmpForItem, writeSidecarForItem } from "../../services/media-browser";

const FIELD = "w-full rounded-md border border-border bg-bg-2 px-2 py-1 text-[12px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SYNC_KEY = "openreel-xmp-sidecar-sync";

function readSync(): boolean {
  try {
    return localStorage.getItem(SYNC_KEY) === "1";
  } catch {
    return false;
  }
}

type TextField = "description" | "scene" | "shot" | "take" | "reel" | "logComment";

/** The value all items share, or null when they differ. */
function shared<T>(items: readonly MediaItem[], read: (item: MediaItem) => T): T | null {
  if (!items.length) return null;
  const first = JSON.stringify(read(items[0]));
  return items.every((i) => JSON.stringify(read(i)) === first) ? read(items[0]) : null;
}

/** Metadata panel: Dublin Core and xmpDM logging fields of the selected project media, stored in the project. */
export function MetadataPanel() {
  const library = useProjectStore((s) => s.project.mediaLibrary.items);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const items = useMemo(() => {
    const ids = new Set(selectedItems.map((s) => s.id));
    return library.filter((i) => ids.has(i.id));
  }, [library, selectedItems]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const [sync, setSync] = useState(readSync);
  const [keywordDraft, setKeywordDraft] = useState("");
  const desktop = !!desktopBrowserBridge();

  const [drafts, setDrafts] = useState<Record<TextField, string>>({ description: "", scene: "", shot: "", take: "", reel: "", logComment: "" });
  const key = items.map((i) => `${i.id}:${i.description ?? ""}|${i.scene ?? ""}|${i.shot ?? ""}|${i.take ?? ""}|${i.reel ?? ""}|${i.logComment ?? ""}`).join(";");
  useEffect(() => {
    const read = (field: TextField): string => shared(items, (i) => i[field] ?? "") ?? "";
    setDrafts({ description: read("description"), scene: read("scene"), shot: read("shot"), take: read("take"), reel: read("reel"), logComment: read("logComment") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const mixed = (field: TextField): boolean => items.length > 1 && shared(items, (i) => i[field] ?? "") === null;
  const keywordsShared = shared(items, (i) => i.keywords ?? []);
  const keywords = keywordsShared ?? normalizeKeywords(items.flatMap((i) => i.keywords ?? []));
  const goodShared = shared(items, (i) => !!i.goodTake);

  const commit = async (edit: MediaMetadataEdit): Promise<void> => {
    if (!ids.length) return;
    const outcome = await setMediaMetadata(ids, edit);
    if (!outcome.success) {
      toast.warning("Metadata", outcome.message ?? "The change failed.");
      return;
    }
    if (sync && desktop) for (const id of ids) await writeSidecarForItem(id);
  };

  const commitText = (field: TextField): void => {
    const value = drafts[field];
    const current = shared(items, (i) => i[field] ?? "");
    // An untouched "mixed" field stays as it is.
    if (current === null && value === "") return;
    if (current === value) return;
    void commit({ [field]: value });
  };

  const addKeywords = (text: string): void => {
    const added = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!added.length) return;
    setKeywordDraft("");
    // On a multi-selection keywords are added to every item, not replaced.
    if (items.length > 1) {
      void (async () => {
        for (const item of items) await setMediaMetadata([item.id], { keywords: [...(item.keywords ?? []), ...added] }, "Add keywords");
        if (sync && desktop) for (const id of ids) await writeSidecarForItem(id);
      })();
    } else void commit({ keywords: [...keywords, ...added] });
  };
  const removeKeyword = (word: string): void => {
    void (async () => {
      for (const item of items) await setMediaMetadata([item.id], { keywords: (item.keywords ?? []).filter((k) => k.toLowerCase() !== word.toLowerCase()) }, "Remove keyword");
      if (sync && desktop) for (const id of ids) await writeSidecarForItem(id);
    })();
  };

  if (!items.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-fg-3" data-testid="metadata-empty">
        <Tag size={20} aria-hidden="true" />
        <p>Select a clip in the Project panel to edit its description, keywords, scene, shot, take and reel.</p>
      </div>
    );
  }

  const text = (field: TextField, label: string, multiline = false) => (
    <label className="flex flex-col gap-1 text-[11px] text-fg-3" key={field}>
      {label}
      {multiline ? (
        <textarea
          className={`${FIELD} min-h-[56px] resize-y`}
          data-testid={`metadata-${field}`}
          placeholder={mixed(field) ? "Multiple values" : ""}
          value={drafts[field]}
          onChange={(event) => setDrafts({ ...drafts, [field]: event.target.value })}
          onBlur={() => commitText(field)}
        />
      ) : (
        <Input
          className="h-7 text-[12px]"
          data-testid={`metadata-${field}`}
          placeholder={mixed(field) ? "Multiple values" : ""}
          value={drafts[field]}
          onChange={(event) => setDrafts({ ...drafts, [field]: event.target.value })}
          onBlur={() => commitText(field)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitText(field);
          }}
        />
      )}
    </label>
  );

  const first = items[0];
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-bg-1 p-3" data-testid="metadata-panel">
      <div className="mb-2 min-w-0">
        <p className="truncate text-[12px] font-medium text-fg" data-testid="metadata-title" title={first.name}>{items.length > 1 ? `${items.length} clips selected` : first.name}</p>
        {items.length === 1 && first.xmpSource && (
          <p className="text-[10.5px] text-fg-3" data-testid="metadata-source">Read from {first.xmpSource === "sidecar" ? "a sidecar .xmp" : "XMP embedded in the file"}</p>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        {text("description", "Description", true)}
        <div className="flex flex-col gap-1 text-[11px] text-fg-3">
          Keywords
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-bg-2 p-1" data-testid="metadata-keywords">
            {keywords.map((word) => (
              <span key={word} className="flex items-center gap-1 rounded bg-bg-3 px-1.5 py-0.5 text-[11px] text-fg-2" data-testid="metadata-keyword">
                {word}
                <button type="button" aria-label={`Remove keyword ${word}`} className="text-fg-3 hover:text-fg" onClick={() => removeKeyword(word)}><X size={10} aria-hidden="true" /></button>
              </span>
            ))}
            <input
              aria-label="Add keywords"
              data-testid="metadata-keyword-input"
              className="h-6 min-w-[80px] flex-1 bg-transparent px-1 text-[12px] text-fg outline-none"
              placeholder={keywords.length ? "" : items.length > 1 && keywordsShared === null ? "Add to all (comma separated)" : "Add keywords (comma separated)"}
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addKeywords(keywordDraft);
                }
              }}
              onBlur={() => addKeywords(keywordDraft)}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {text("scene", "Scene")}
          {text("shot", "Shot")}
          {text("take", "Take")}
        </div>
        <label className="flex items-center gap-2 text-[12px] text-fg-2">
          <input
            type="checkbox"
            data-testid="metadata-good"
            checked={goodShared === true}
            ref={(el) => {
              if (el) el.indeterminate = goodShared === null;
            }}
            onChange={(event) => void commit({ goodTake: event.target.checked })}
          />
          Good take
        </label>
        {text("reel", "Reel")}
        {text("logComment", "Log comment", true)}
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-[11px] text-fg-3">Edits are saved in the project. The media file is never rewritten.</p>
        {desktop ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" data-testid="metadata-read-xmp" disabled={items.length !== 1} onClick={() => void rereadXmpForItem(first.id)}>Read XMP from file</Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="metadata-write-sidecar"
                disabled={items.length !== 1}
                onClick={() =>
                  void writeSidecarForItem(first.id).then((p) => p && toast.success("Sidecar written", p))
                }
              >
                Write sidecar .xmp
              </Button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-fg-3">
              <input
                type="checkbox"
                data-testid="metadata-sync"
                checked={sync}
                onChange={(event) => {
                  setSync(event.target.checked);
                  try {
                    localStorage.setItem(SYNC_KEY, event.target.checked ? "1" : "0");
                  } catch {
                    /* the choice lasts for this session */
                  }
                }}
              />
              Keep a sidecar .xmp next to each edited clip
            </label>
          </>
        ) : (
          <p className="text-[11px] text-fg-3">Sidecar .xmp files are written by the desktop app.</p>
        )}
      </div>
    </div>
  );
}

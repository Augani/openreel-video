import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, HardDrive, Loader2, Search, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@openreel/ui";
import { FONT_CATEGORIES, useCustomFonts } from "./font-options";
import { ensureFontFamily } from "../../../services/project-fonts";
import {
  downloadGoogleFont,
  hideSystemFonts,
  isSystemFontAccessSupported,
  loadSystemFonts,
  useSystemFonts,
} from "../../../services/system-fonts";
import { useFavorites, useFavoritesStore, useRecents } from "../../../stores/favorites-store";
import { toast } from "../../../stores/notification-store";

interface FontSection {
  title: string;
  fonts: readonly string[];
}

const previewRequested = new Set<string>();

const SHORTCUT_TAGS: Record<string, string | undefined> = {
  Favourites: "favourite",
  Recent: "recent",
  Suggested: "suggested",
};

/** Load a catalog font only once its row scrolls into view. */
function useLazyFontPreview(family: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    // Without an observer (tests, old engines) rows fall back to the system face.
    if (!node || previewRequested.has(family) || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      if (previewRequested.has(family)) return;
      previewRequested.add(family);
      void ensureFontFamily(family, 400, family).catch(() => previewRequested.delete(family));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [family]);
  return ref;
}

const FontRow: React.FC<{
  family: string;
  /** Shortcut sections repeat families listed below them; tag their options so names stay unique. */
  tag?: string;
  selected: boolean;
  favorite: boolean;
  onSelect: (family: string) => void;
  onToggleFavorite: (family: string) => void;
}> = ({ family, tag, selected, favorite, onSelect, onToggleFavorite }) => {
  const ref = useLazyFontPreview(family);
  return (
    <div
      ref={ref}
      role="option"
      aria-label={tag ? `${family}, ${tag}` : family}
      aria-selected={selected}
      className={cn(
        "group flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-fg-2 hover:bg-bg-3 hover:text-fg",
        selected && "bg-accent/15 text-fg",
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "32px" }}
      onClick={() => onSelect(family)}
    >
      <span
        className="min-w-0 flex-1 truncate text-[15px] leading-none"
        style={{ fontFamily: `${JSON.stringify(family)}, system-ui, sans-serif` }}
        title={family}
      >
        {family}
      </span>
      <button
        type="button"
        aria-label={favorite ? `Unpin ${family}` : `Pin ${family} to favourites`}
        aria-pressed={favorite}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
          favorite ? "text-amber-400 hover:text-amber-300" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite(family);
        }}
      >
        <Star size={13} fill={favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
};

export interface FontPickerProps {
  value: string;
  onChange: (family: string) => void;
  ariaLabel?: string;
  triggerClassName?: string;
  /** Trigger content; defaults to the family name rendered in its own font. */
  triggerContent?: React.ReactNode;
  disabled?: boolean;
  /** Families listed first, e.g. the fonts a graphic template was designed with. */
  suggestedFonts?: readonly string[];
  id?: string;
}

/**
 * Searchable font list with live previews, pinned favourites, recent picks,
 * installed system fonts and a Google Fonts downloader.
 */
export const FontPicker: React.FC<FontPickerProps> = ({
  value,
  onChange,
  ariaLabel = "Font",
  triggerClassName,
  triggerContent,
  disabled,
  suggestedFonts,
  id,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [downloadName, setDownloadName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [loadingSystem, setLoadingSystem] = useState(false);
  const customFonts = useCustomFonts();
  const systemFonts = useSystemFonts();
  const favorites = useFavorites("font");
  const recents = useRecents("font");
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);
  const pushRecent = useFavoritesStore((state) => state.pushRecent);
  const systemSupported = useMemo(() => isSystemFontAccessSupported(), []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const sections = useMemo<FontSection[]>(() => {
    const builtIn = new Set<string>(Object.values(FONT_CATEGORIES).flat());
    const custom = new Set(customFonts);
    const installed = systemFonts.filter((font) => !builtIn.has(font) && !custom.has(font));
    const list: FontSection[] = [
      { title: "Favourites", fonts: favorites },
      { title: "Recent", fonts: recents.filter((font) => !favorites.includes(font)) },
      { title: "Suggested", fonts: suggestedFonts ?? [] },
      ...Object.entries(FONT_CATEGORIES).map(([title, fonts]) => ({ title, fonts })),
      { title: "Custom & downloaded", fonts: customFonts },
      { title: "Installed on this computer", fonts: installed },
    ];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? list
          .filter((section) => section.title !== "Recent")
          .map((section) => ({ ...section, fonts: section.fonts.filter((font) => font.toLowerCase().includes(needle)) }))
      : list;
    return filtered.filter((section) => section.fonts.length > 0);
  }, [customFonts, systemFonts, favorites, recents, query, suggestedFonts]);

  const firstMatch = sections[0]?.fonts[0];

  const select = useCallback(
    (family: string) => {
      pushRecent("font", family);
      onChange(family);
      setOpen(false);
    },
    [onChange, pushRecent],
  );

  const handleFavorite = useCallback((family: string) => toggleFavorite("font", family), [toggleFavorite]);

  const handleSystemFonts = useCallback(async () => {
    setLoadingSystem(true);
    try {
      const fonts = await loadSystemFonts();
      toast.success("Installed fonts added", `${fonts.length} font families are now listed.`);
    } catch (error) {
      toast.error("Could not list installed fonts", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoadingSystem(false);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    const name = downloadName.trim() || query.trim();
    if (!name || downloading) return;
    setDownloading(true);
    try {
      const family = await downloadGoogleFont(name);
      toast.success("Font downloaded", `${family} is saved and ready to use offline.`);
      setDownloadName("");
      select(family);
    } catch (error) {
      toast.error("Font download failed", error instanceof Error ? error.message : "Check the name and your connection.");
    } finally {
      setDownloading(false);
    }
  }, [downloadName, downloading, query, select]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-[7px] border border-border bg-bg-1 px-2.5 text-[12px] font-medium text-fg-2 outline-none transition-colors hover:border-fg-muted focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50",
            triggerClassName,
          )}
        >
          <span className="min-w-0 truncate" style={triggerContent ? undefined : { fontFamily: `${JSON.stringify(value)}, system-ui, sans-serif` }}>
            {triggerContent ?? value}
          </span>
          <span aria-hidden="true" className="text-fg-muted">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[280px] flex-col gap-2 border-border bg-bg-1 p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>("input")?.focus();
        }}
      >
        <div className="flex h-8 items-center gap-1.5 rounded-[7px] border border-border bg-bg-2 px-2 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-fg-muted" aria-hidden="true" />
          <input
            aria-label="Search fonts"
            placeholder="Search fonts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && firstMatch) {
                event.preventDefault();
                select(firstMatch);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-muted"
          />
        </div>
        <div role="listbox" aria-label={ariaLabel} className="max-h-[320px] overflow-y-auto pr-0.5">
          {sections.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-fg-muted">
              No font matches “{query}”. Download it from Google Fonts below.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.title} role="group" aria-label={section.title} className="mb-1">
                <div className="sticky top-0 z-[1] flex items-center gap-1 bg-bg-1 px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  {section.title === "Favourites" && <Star size={10} fill="currentColor" aria-hidden="true" />}
                  {section.title}
                </div>
                {section.fonts.map((family) => (
                  <FontRow
                    key={`${section.title}:${family}`}
                    family={family}
                    tag={SHORTCUT_TAGS[section.title]}
                    selected={family === value}
                    favorite={favorites.includes(family)}
                    onSelect={select}
                    onToggleFavorite={handleFavorite}
                  />
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleDownload();
            }}
          >
            <input
              aria-label="Google Fonts family to download"
              placeholder={query.trim() ? `Download “${query.trim()}”` : "Google Fonts name…"}
              value={downloadName}
              onChange={(event) => setDownloadName(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-[7px] border border-border bg-bg-2 px-2 text-[12px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
            />
            <button
              type="submit"
              disabled={downloading || !(downloadName.trim() || query.trim())}
              aria-label="Download from Google Fonts"
              title="Download from Google Fonts"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg disabled:opacity-50"
            >
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            </button>
          </form>
          {systemSupported && (
            <button
              type="button"
              disabled={loadingSystem}
              onClick={() => (systemFonts.length ? hideSystemFonts() : void handleSystemFonts())}
              className="flex h-7 items-center justify-center gap-1.5 rounded-[7px] border border-border bg-bg-2 text-[11px] font-medium text-fg-2 hover:bg-bg-3 hover:text-fg disabled:opacity-50"
            >
              {loadingSystem ? <Loader2 size={12} className="animate-spin" /> : <HardDrive size={12} />}
              {systemFonts.length ? `Hide installed fonts (${systemFonts.length})` : "Show installed system fonts"}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

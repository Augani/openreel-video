import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  getPopularFonts,
  filterFonts,
  loadGoogleFont,
  isFontLoaded,
  FONT_CATEGORIES,
  type GoogleFont,
} from '../../services/fonts-service';

interface FontPickerProps {
  value: string;
  onChange: (fontFamily: string) => void;
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [loadingFont, setLoadingFont] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fonts = useMemo(() => getPopularFonts(), []);
  const filteredFonts = useMemo(() => filterFonts(fonts, category, search), [fonts, category, search]);

  useEffect(() => {
    loadGoogleFont(value);
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && listRef.current) {
      filteredFonts.slice(0, 10).forEach((font) => {
        if (!isFontLoaded(font.family)) {
          loadGoogleFont(font.family, ['400']);
        }
      });
    }
  }, [isOpen, filteredFonts]);

  const handleSelect = async (font: GoogleFont) => {
    setLoadingFont(font.family);
    try {
      await loadGoogleFont(font.family, font.variants.slice(0, 4));
      onChange(font.family);
      setIsOpen(false);
      setSearch('');
    } finally {
      setLoadingFont(null);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    if (scrollBottom < 200) {
      const startIndex = Math.floor(container.scrollTop / 40);
      const endIndex = Math.min(startIndex + 15, filteredFonts.length);
      filteredFonts.slice(startIndex, endIndex).forEach((font) => {
        if (!isFontLoaded(font.family)) {
          loadGoogleFont(font.family, ['400']);
        }
      });
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs bg-background border border-input rounded-md hover:border-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
      >
        <span style={{ fontFamily: value }} className="truncate">
          {value}
        </span>
        <ChevronDown size={12} className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fonts..."
                className="w-full pl-7 pr-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1 p-2 border-b border-border">
            {FONT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                  category === cat.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-accent'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div
            ref={listRef}
            onScroll={handleScroll}
            className="max-h-64 overflow-y-auto"
          >
            {filteredFonts.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No fonts found
              </div>
            ) : (
              filteredFonts.map((font) => (
                <button
                  key={font.family}
                  onClick={() => handleSelect(font)}
                  disabled={loadingFont === font.family}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent transition-colors ${
                    value === font.family ? 'bg-accent/50' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <span
                      style={{ fontFamily: font.family }}
                      className="block text-sm truncate"
                    >
                      {font.family}
                    </span>
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {font.category}
                    </span>
                  </div>
                  {loadingFont === font.family ? (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : value === font.family ? (
                    <Check size={14} className="text-primary" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

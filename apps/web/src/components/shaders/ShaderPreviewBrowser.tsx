import { useMemo, useState, type JSX } from "react";
import { Button, Input } from "@openreel/ui";
import type { MotionShaderDef, TextStyle, Transform } from "@openreel/core";
import {
  EffectLivePreview,
  EffectPreviewProvider,
  useLivePreviewActivity,
} from "../editor/panels/effect-previews/EffectLivePreview";
import {
  DEFAULT_PREVIEW_TEXT,
  shaderPreviewDef,
  type PreviewTextSource,
  type ShaderPreviewSample,
} from "../editor/panels/effect-previews/kind-defs";

function shaderAccessibleName(
  def: MotionShaderDef,
  duplicateNames: ReadonlySet<string>,
  sample: ShaderPreviewSample,
): string {
  const suffix = duplicateNames.has(def.name)
    ? `, ${def.collection ?? "Built-in"} ${def.category}`
    : "";
  const action = sample === "effect" ? "apply" : "select";
  return `Preview and ${action} ${def.name}${suffix}`;
}

function ShaderPreviewCanvas({
  def,
  sample,
  text,
  source,
  active,
}: {
  def: MotionShaderDef;
  sample: ShaderPreviewSample;
  text: string;
  source: PreviewTextSource | undefined;
  active: boolean;
}): JSX.Element {
  const previewDef = useMemo(() => shaderPreviewDef(def, sample, text, source), [def, sample, text, source]);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[7px] bg-bg-3">
      <EffectLivePreview def={previewDef} active={active} />
    </div>
  );
}

function ShaderTile({
  def,
  sample,
  text,
  source,
  name,
  selected,
  pressed,
  onSelect,
}: {
  def: MotionShaderDef;
  sample: ShaderPreviewSample;
  text: string;
  source: PreviewTextSource | undefined;
  name: string;
  selected: boolean;
  pressed: boolean | undefined;
  onSelect: (shaderId: string) => void;
}): JSX.Element {
  const { active, handlers } = useLivePreviewActivity();
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={name}
      aria-pressed={pressed}
      onClick={() => onSelect(def.id)}
      {...handlers}
      className={`block h-auto w-full min-w-0 whitespace-normal rounded-[9px] border p-1.5 text-left text-[length:inherit] font-normal leading-[inherit] transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-border bg-bg-2 hover:border-accent/50 hover:bg-bg-3"
      }`}
    >
      <ShaderPreviewCanvas def={def} sample={sample} text={text} source={source} active={active} />
      <span className="mt-1.5 block truncate text-[11px] font-medium text-fg-2">
        {def.name}
      </span>
      <span className="block truncate text-[9px] text-fg-4">
        {def.collection ?? "Built-in"} · {def.category}
      </span>
    </Button>
  );
}

export function ShaderPreviewBrowser({
  defs,
  selectedId,
  onSelect,
  sample = "text",
  label = "Material previews",
  text = DEFAULT_PREVIEW_TEXT,
  textStyle,
  textTransform,
}: {
  defs: readonly MotionShaderDef[];
  selectedId?: string;
  onSelect: (shaderId: string) => void;
  sample?: ShaderPreviewSample;
  label?: string;
  /** Text a material is shown on (the selected text clip's own string). */
  text?: string;
  /** The selected text clip's style and transform: text materials are drawn on the clip as it is. */
  textStyle?: TextStyle;
  textTransform?: Transform;
}): JSX.Element {
  const textSource = useMemo<PreviewTextSource | undefined>(
    // The shader already on the clip is left out so picking a material does not re-key every tile.
    () => (textStyle ? { text, style: { ...textStyle, shader: undefined }, transform: textTransform } : undefined),
    [text, textStyle, textTransform],
  );
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("All");
  const collections = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(defs.map((def) => def.collection ?? "Built-in")),
      ).sort(),
    ],
    [defs],
  );
  const visibleDefs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return defs.filter((def) => {
      const defCollection = def.collection ?? "Built-in";
      if (collection !== "All" && defCollection !== collection) return false;
      return (
        !normalized ||
        `${def.name} ${defCollection} ${def.category}`
          .toLowerCase()
          .includes(normalized)
      );
    });
  }, [collection, defs, query]);
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const def of defs)
      counts.set(def.name, (counts.get(def.name) ?? 0) + 1);
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name),
    );
  }, [defs]);

  return (
    <div className="space-y-2" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-fg-2">{label}</span>
        <span className="text-[10px] tabular-nums text-fg-4">
          {visibleDefs.length}/{defs.length}
        </span>
      </div>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={
          sample === "effect" ? "Search effects" : "Search materials"
        }
        aria-label={`Search ${label.toLowerCase()}`}
        className="h-8 w-full rounded-[7px] border border-border bg-bg-2 px-2.5 py-0 text-xs text-fg outline-none transition-colors placeholder:text-fg-4 focus:border-accent md:text-xs"
      />
      {collections.length > 2 ? (
        <div
          className="flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label={`${label} collections`}
        >
          {collections.map((entry) => {
            const count =
              entry === "All"
                ? defs.length
                : defs.filter((def) => (def.collection ?? "Built-in") === entry)
                    .length;
            return (
              <Button
                variant="ghost"
                size="sm"
                key={entry}
                type="button"
                aria-pressed={collection === entry}
                onClick={() => setCollection(entry)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[10px] font-medium transition-colors ${
                  collection === entry
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-bg-2 text-fg-3 hover:border-accent/50 hover:text-fg"
                }`}
              >
                {entry} · {count}
              </Button>
            );
          })}
        </div>
      ) : null}
      <EffectPreviewProvider>
        <div className="grid max-h-[260px] grid-cols-2 gap-2 overflow-y-auto pr-1">
          {visibleDefs.map((def) => (
            <ShaderTile
              key={def.id}
              def={def}
              sample={sample}
              text={text}
              source={textSource}
              name={shaderAccessibleName(def, duplicateNames, sample)}
              selected={def.id === selectedId}
              pressed={selectedId === undefined ? undefined : def.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </EffectPreviewProvider>
      {visibleDefs.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-border px-3 py-5 text-center text-[11px] text-fg-4">
          No {sample === "effect" ? "effects" : "materials"} match “{query}”.
        </div>
      ) : null}
    </div>
  );
}
